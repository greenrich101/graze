-- ============================================================
-- HEALTH EVENTS: Animal Treatment Tracking
-- Run this in Supabase SQL Editor
-- Safe to re-run (idempotent)
-- ============================================================

-- ============================================================
-- PART 1: Create health_events table
-- ============================================================

-- Create health_events table
CREATE TABLE IF NOT EXISTS health_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  treatment_type TEXT NOT NULL CHECK (treatment_type IN ('5-in-1', 'B12', 'Fly', 'Lice', 'Worm', 'Anti-venom', 'Penicillin', 'Foot', 'Eye')),
  treatment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  mob_name TEXT NOT NULL REFERENCES mobs(name),  -- mob at time of treatment
  movement_id UUID REFERENCES movements(record_key) ON DELETE SET NULL,  -- optional link to movement
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE health_events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (must be after table creation)
DROP POLICY IF EXISTS "Property members can view health events" ON health_events;
DROP POLICY IF EXISTS "Property members can create health events" ON health_events;
DROP POLICY IF EXISTS "Property members can update health events" ON health_events;
DROP POLICY IF EXISTS "Property members can delete health events" ON health_events;

-- Create RLS Policies
CREATE POLICY "Property members can view health events"
  ON health_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = health_events.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE POLICY "Property members can create health events"
  ON health_events FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = health_events.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE POLICY "Property members can update health events"
  ON health_events FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = health_events.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE POLICY "Property members can delete health events"
  ON health_events FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = health_events.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

-- Create trigger
DROP TRIGGER IF EXISTS update_health_events_updated_at ON health_events;
CREATE TRIGGER update_health_events_updated_at
  BEFORE UPDATE ON health_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create indexes
CREATE INDEX IF NOT EXISTS health_events_animal_id_idx ON health_events(animal_id);
CREATE INDEX IF NOT EXISTS health_events_mob_name_idx ON health_events(mob_name);
CREATE INDEX IF NOT EXISTS health_events_treatment_type_idx ON health_events(treatment_type);
CREATE INDEX IF NOT EXISTS health_events_treatment_date_idx ON health_events(treatment_date);
CREATE INDEX IF NOT EXISTS health_events_movement_id_idx ON health_events(movement_id) WHERE movement_id IS NOT NULL;

-- ============================================================
-- PART 2: Create RPC Functions
-- ============================================================

-- Log bulk health treatment (treats all or selected animals in mob)
CREATE OR REPLACE FUNCTION log_health_treatment(
  p_mob_name TEXT,
  p_treatment_type TEXT,
  p_cattle_type TEXT DEFAULT NULL,  -- NULL = all animals, or filter by type
  p_treatment_date DATE DEFAULT CURRENT_DATE,
  p_movement_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  treated_count INTEGER := 0;
  animal_record RECORD;
BEGIN
  -- Validate treatment type
  IF p_treatment_type NOT IN ('5-in-1', 'B12', 'Fly', 'Lice', 'Worm', 'Anti-venom', 'Penicillin', 'Foot', 'Eye') THEN
    RAISE EXCEPTION 'Invalid treatment_type: %. Must be one of: 5-in-1, B12, Fly, Lice, Worm, Anti-venom, Penicillin, Foot, Eye', p_treatment_type;
  END IF;

  -- Validate mob exists
  IF NOT EXISTS (SELECT 1 FROM mobs WHERE name = p_mob_name) THEN
    RAISE EXCEPTION 'Mob "%" does not exist', p_mob_name;
  END IF;

  -- Insert health event for each matching animal
  FOR animal_record IN
    SELECT id FROM animals
    WHERE mob_name = p_mob_name
      AND status = 'alive'
      AND (p_cattle_type IS NULL OR cattle_type = p_cattle_type)
  LOOP
    INSERT INTO health_events (animal_id, treatment_type, treatment_date, mob_name, movement_id, notes)
    VALUES (animal_record.id, p_treatment_type, p_treatment_date, p_mob_name, p_movement_id, p_notes);

    treated_count := treated_count + 1;
  END LOOP;

  RETURN treated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get health history for a mob (all animals currently in mob)
CREATE OR REPLACE FUNCTION get_mob_health_history(
  p_mob_name TEXT,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(
  event_id UUID,
  animal_id UUID,
  nlis_tag TEXT,
  management_tag TEXT,
  cattle_type TEXT,
  treatment_type TEXT,
  treatment_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    he.id,
    he.animal_id,
    a.nlis_tag,
    a.management_tag,
    a.cattle_type,
    he.treatment_type,
    he.treatment_date,
    he.notes,
    he.created_at
  FROM health_events he
  JOIN animals a ON a.id = he.animal_id
  WHERE a.mob_name = p_mob_name
  ORDER BY he.treatment_date DESC, he.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get health history for a specific animal
CREATE OR REPLACE FUNCTION get_animal_health_history(
  p_animal_id UUID
)
RETURNS TABLE(
  event_id UUID,
  treatment_type TEXT,
  treatment_date DATE,
  mob_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    he.id,
    he.treatment_type,
    he.treatment_date,
    he.mob_name,
    he.notes,
    he.created_at
  FROM health_events he
  WHERE he.animal_id = p_animal_id
  ORDER BY he.treatment_date DESC, he.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Log treatment for a single animal
CREATE OR REPLACE FUNCTION log_animal_treatment(
  p_animal_id UUID,
  p_treatment_type TEXT,
  p_treatment_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_mob_name TEXT;
  v_event_id UUID;
BEGIN
  -- Validate treatment type
  IF p_treatment_type NOT IN ('5-in-1', 'B12', 'Fly', 'Lice', 'Worm', 'Anti-venom', 'Penicillin', 'Foot', 'Eye') THEN
    RAISE EXCEPTION 'Invalid treatment_type: %. Must be one of: 5-in-1, B12, Fly, Lice, Worm, Anti-venom, Penicillin, Foot, Eye', p_treatment_type;
  END IF;

  -- Get mob_name from animal (required for health_events table)
  SELECT mob_name INTO v_mob_name
  FROM animals
  WHERE id = p_animal_id AND status = 'alive';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Animal with id % not found or not alive', p_animal_id;
  END IF;

  -- Insert health event
  INSERT INTO health_events (animal_id, treatment_type, treatment_date, mob_name, notes)
  VALUES (p_animal_id, p_treatment_type, p_treatment_date, v_mob_name, p_notes)
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Success!
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Health events system installed successfully!';
  RAISE NOTICE 'Treatment types: 5-in-1, B12, Fly, Lice, Worm, Anti-venom, Penicillin, Foot, Eye';
END $$;
