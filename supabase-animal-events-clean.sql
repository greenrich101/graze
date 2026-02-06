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
  animal_id UUID REFERENCES animals(id) ON DELETE SET NULL,  -- NULL for bulk events
  animal_ids JSONB,  -- For bulk events, stores array of affected animal UUIDs
  cattle_type TEXT CHECK (cattle_type IN ('cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other')),  -- NULL if animal_id is set
  count INTEGER CHECK (count > 0),  -- NULL if animal_id is set, otherwise required
  event_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- Either animal_id OR (cattle_type + count) must be specified
  CONSTRAINT event_type_check CHECK (
    (animal_id IS NOT NULL AND cattle_type IS NULL AND count IS NULL) OR
    (animal_id IS NULL AND cattle_type IS NOT NULL AND count IS NOT NULL)
  )
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

CREATE INDEX IF NOT EXISTS animal_events_animal_id_idx
  ON animal_events(animal_id) WHERE animal_id IS NOT NULL;

-- ============================================================
-- 7. Create RPC function for atomic log + composition update
-- ============================================================

CREATE OR REPLACE FUNCTION log_animal_event(
  p_mob_name TEXT,
  p_event_type TEXT,
  p_animal_id UUID DEFAULT NULL,
  p_cattle_type TEXT DEFAULT NULL,
  p_count INTEGER DEFAULT NULL,
  p_event_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  new_event_id UUID;
  current_count INTEGER;
  new_count INTEGER;
  animal_ids UUID[];
  aid UUID;
BEGIN
  -- Validate event_type
  IF p_event_type NOT IN ('sold', 'deceased') THEN
    RAISE EXCEPTION 'Invalid event_type: %. Must be ''sold'' or ''deceased''', p_event_type;
  END IF;

  -- Validate either animal_id OR (cattle_type + count) is provided
  IF p_animal_id IS NULL AND (p_cattle_type IS NULL OR p_count IS NULL) THEN
    RAISE EXCEPTION 'Must provide either animal_id OR (cattle_type + count)';
  END IF;

  IF p_animal_id IS NOT NULL AND (p_cattle_type IS NOT NULL OR p_count IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot provide both animal_id AND (cattle_type + count)';
  END IF;

  -- INDIVIDUAL ANIMAL EVENT
  IF p_animal_id IS NOT NULL THEN
    -- Verify animal exists and is alive
    IF NOT EXISTS (SELECT 1 FROM animals WHERE id = p_animal_id AND mob_name = p_mob_name AND status = 'alive') THEN
      RAISE EXCEPTION 'Animal not found or already sold/deceased';
    END IF;

    -- Insert event record
    INSERT INTO animal_events (mob_name, event_type, animal_id, event_date, notes)
    VALUES (p_mob_name, p_event_type, p_animal_id, p_event_date, p_notes)
    RETURNING id INTO new_event_id;

    -- Update animal status
    UPDATE animals
    SET status = p_event_type
    WHERE id = p_animal_id;

  -- BULK EVENT (backwards compatible with old behavior)
  ELSE
    -- Validate count is positive
    IF p_count <= 0 THEN
      RAISE EXCEPTION 'Count must be positive';
    END IF;

    -- Get alive animals of this type (prefer untagged)
    SELECT ARRAY_AGG(id ORDER BY (nlis_tag IS NULL) DESC, created_at ASC)
    INTO animal_ids
    FROM animals
    WHERE mob_name = p_mob_name
      AND cattle_type = p_cattle_type
      AND status = 'alive'
    LIMIT p_count;

    -- Check if enough animals available
    IF animal_ids IS NULL OR array_length(animal_ids, 1) < p_count THEN
      RAISE EXCEPTION 'Cannot log % % - only % alive in mob "%"',
        p_count, p_cattle_type, COALESCE(array_length(animal_ids, 1), 0), p_mob_name;
    END IF;

    -- Insert event record (bulk) with affected animal IDs
    INSERT INTO animal_events (mob_name, event_type, cattle_type, count, animal_ids, event_date, notes)
    VALUES (p_mob_name, p_event_type, p_cattle_type, p_count, to_jsonb(animal_ids), p_event_date, p_notes)
    RETURNING id INTO new_event_id;

    -- Update status for all selected animals
    FOREACH aid IN ARRAY animal_ids
    LOOP
      UPDATE animals
      SET status = p_event_type
      WHERE id = aid;
    END LOOP;

    -- LEGACY: Update mob_composition if it exists (backwards compatibility)
    SELECT count INTO current_count
    FROM mob_composition
    WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type;

    IF current_count IS NOT NULL THEN
      new_count := current_count - p_count;
      IF new_count > 0 THEN
        UPDATE mob_composition
        SET count = new_count
        WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type;
      ELSE
        DELETE FROM mob_composition
        WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type;
      END IF;
    END IF;
  END IF;

  RETURN new_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. Create trigger function to reverse events on deletion
-- ============================================================

CREATE OR REPLACE FUNCTION reverse_animal_event()
RETURNS TRIGGER AS $$
DECLARE
  current_count INTEGER;
  aid UUID;
  animal_id_array UUID[];
BEGIN
  -- INDIVIDUAL ANIMAL EVENT REVERSAL
  IF OLD.animal_id IS NOT NULL THEN
    -- Restore animal status to 'alive'
    UPDATE animals
    SET status = 'alive'
    WHERE id = OLD.animal_id;

  -- BULK EVENT REVERSAL
  ELSIF OLD.animal_ids IS NOT NULL THEN
    -- Extract animal IDs from JSONB array
    SELECT ARRAY(SELECT jsonb_array_elements_text(OLD.animal_ids)::UUID)
    INTO animal_id_array;

    -- Restore status for all affected animals
    FOREACH aid IN ARRAY animal_id_array
    LOOP
      UPDATE animals
      SET status = 'alive'
      WHERE id = aid;
    END LOOP;

    -- LEGACY: Update mob_composition if it exists (backwards compatibility)
    SELECT count INTO current_count
    FROM mob_composition
    WHERE mob_name = OLD.mob_name AND cattle_type = OLD.cattle_type;

    IF current_count IS NOT NULL THEN
      UPDATE mob_composition
      SET count = count + OLD.count
      WHERE mob_name = OLD.mob_name AND cattle_type = OLD.cattle_type;
    ELSE
      -- Re-insert if deleted
      INSERT INTO mob_composition (mob_name, cattle_type, count)
      VALUES (OLD.mob_name, OLD.cattle_type, OLD.count)
      ON CONFLICT (mob_name, cattle_type)
      DO UPDATE SET count = mob_composition.count + OLD.count;
    END IF;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 9. Create trigger to auto-reverse on event deletion
-- ============================================================

DROP TRIGGER IF EXISTS reverse_animal_event_on_delete ON animal_events;

CREATE TRIGGER reverse_animal_event_on_delete
  BEFORE DELETE ON animal_events
  FOR EACH ROW
  EXECUTE FUNCTION reverse_animal_event();

-- ============================================================
-- Success message
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'Animal events migration completed successfully!';
END $$;
