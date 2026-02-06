-- Animal Events: sold/deceased tracking (safe re-run version)
-- This version drops existing objects first, so it can be run multiple times

-- ============================================================
-- 1. Drop existing policies if they exist
-- ============================================================

DROP POLICY IF EXISTS "Property members can view animal events" ON animal_events;
DROP POLICY IF EXISTS "Property members can create animal events" ON animal_events;
DROP POLICY IF EXISTS "Property members can update animal events" ON animal_events;
DROP POLICY IF EXISTS "Property members can delete animal events" ON animal_events;

-- ============================================================
-- 2. Create animal_events table (with IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS animal_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mob_name TEXT NOT NULL REFERENCES mobs(name) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('sold', 'deceased')),
  cattle_type TEXT NOT NULL CHECK (cattle_type IN ('cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other')),
  count INTEGER NOT NULL CHECK (count > 0),
  event_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 3. Enable RLS
-- ============================================================

ALTER TABLE animal_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Create RLS Policies (fresh)
-- ============================================================

CREATE POLICY "Property members can view animal events"
  ON animal_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = animal_events.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE POLICY "Property members can create animal events"
  ON animal_events FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = animal_events.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE POLICY "Property members can update animal events"
  ON animal_events FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = animal_events.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE POLICY "Property members can delete animal events"
  ON animal_events FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = animal_events.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

-- ============================================================
-- 5. Drop and recreate updated_at trigger
-- ============================================================

DROP TRIGGER IF EXISTS update_animal_events_updated_at ON animal_events;

CREATE TRIGGER update_animal_events_updated_at
  BEFORE UPDATE ON animal_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 6. Create indexes for common queries
-- ============================================================

CREATE INDEX IF NOT EXISTS animal_events_mob_name_idx
  ON animal_events(mob_name);

CREATE INDEX IF NOT EXISTS animal_events_event_date_idx
  ON animal_events(event_date DESC);

-- ============================================================
-- 7. Create RPC function for atomic log + composition update
-- ============================================================

CREATE OR REPLACE FUNCTION log_animal_event(
  p_mob_name TEXT,
  p_event_type TEXT,
  p_cattle_type TEXT,
  p_count INTEGER,
  p_event_date DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  new_event_id UUID;
  current_count INTEGER;
  new_count INTEGER;
BEGIN
  -- Validate event_type
  IF p_event_type NOT IN ('sold', 'deceased') THEN
    RAISE EXCEPTION 'Invalid event_type: %. Must be ''sold'' or ''deceased''', p_event_type;
  END IF;

  -- Validate count is positive
  IF p_count <= 0 THEN
    RAISE EXCEPTION 'Count must be positive';
  END IF;

  -- Get current count for this cattle type
  SELECT count INTO current_count
  FROM mob_composition
  WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type;

  -- Check if enough animals available
  IF current_count IS NULL OR current_count = 0 THEN
    RAISE EXCEPTION 'No % in mob "%"', p_cattle_type, p_mob_name;
  END IF;

  IF current_count < p_count THEN
    RAISE EXCEPTION 'Cannot log % % - only % available', p_count, p_cattle_type, current_count;
  END IF;

  -- Calculate new count
  new_count := current_count - p_count;

  -- Insert event record
  INSERT INTO animal_events (mob_name, event_type, cattle_type, count, event_date, notes)
  VALUES (p_mob_name, p_event_type, p_cattle_type, p_count, p_event_date, p_notes)
  RETURNING id INTO new_event_id;

  -- Update mob_composition
  IF new_count > 0 THEN
    UPDATE mob_composition
    SET count = new_count
    WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type;
  ELSE
    -- Delete if count reaches zero (follows split mob pattern)
    DELETE FROM mob_composition
    WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type;
  END IF;

  RETURN new_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Success message
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'Animal events migration completed successfully!';
END $$;
