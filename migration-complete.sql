-- ============================================================
-- COMPLETE MIGRATION: Individual Animal Tracking System
-- Run this ONCE in Supabase SQL Editor
-- Safe to re-run (idempotent)
-- ============================================================

-- ============================================================
-- PART 1: Create animals table
-- ============================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Property members can view animals" ON animals;
DROP POLICY IF EXISTS "Property members can create animals" ON animals;
DROP POLICY IF EXISTS "Property members can update animals" ON animals;
DROP POLICY IF EXISTS "Property members can delete animals" ON animals;

-- Create animals table
CREATE TABLE IF NOT EXISTS animals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mob_name TEXT NOT NULL REFERENCES mobs(name) ON DELETE CASCADE,
  nlis_tag TEXT UNIQUE,
  management_tag TEXT,
  cattle_type TEXT NOT NULL CHECK (cattle_type IN ('cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other')),
  breed TEXT,
  birth_date DATE,
  status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'sold', 'deceased')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE animals ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies
CREATE POLICY "Property members can view animals"
  ON animals FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = animals.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE POLICY "Property members can create animals"
  ON animals FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = animals.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE POLICY "Property members can update animals"
  ON animals FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = animals.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE POLICY "Property members can delete animals"
  ON animals FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM mobs
    WHERE mobs.name = animals.mob_name
      AND user_belongs_to_property(mobs.property_id)
  ));

-- Create trigger
DROP TRIGGER IF EXISTS update_animals_updated_at ON animals;
CREATE TRIGGER update_animals_updated_at
  BEFORE UPDATE ON animals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create indexes
CREATE INDEX IF NOT EXISTS animals_mob_name_idx ON animals(mob_name);
CREATE INDEX IF NOT EXISTS animals_nlis_tag_idx ON animals(nlis_tag) WHERE nlis_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS animals_management_tag_idx ON animals(management_tag) WHERE management_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS animals_status_idx ON animals(status);
CREATE INDEX IF NOT EXISTS animals_cattle_type_idx ON animals(cattle_type);

-- ============================================================
-- PART 2: Update animal_events table
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Property members can view animal events" ON animal_events;
DROP POLICY IF EXISTS "Property members can create animal events" ON animal_events;
DROP POLICY IF EXISTS "Property members can update animal events" ON animal_events;
DROP POLICY IF EXISTS "Property members can delete animal events" ON animal_events;

-- Add new columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='animal_events' AND column_name='animal_id') THEN
    ALTER TABLE animal_events ADD COLUMN animal_id UUID REFERENCES animals(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='animal_events' AND column_name='animal_ids') THEN
    ALTER TABLE animal_events ADD COLUMN animal_ids JSONB;
  END IF;
END $$;

-- Recreate RLS policies
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

-- Create indexes
CREATE INDEX IF NOT EXISTS animal_events_animal_id_idx ON animal_events(animal_id) WHERE animal_id IS NOT NULL;

-- ============================================================
-- PART 3: Create/Update RPC Functions
-- ============================================================

-- Add individual animal
-- Sync mob_composition from animals table
CREATE OR REPLACE FUNCTION sync_mob_composition(p_mob_name TEXT)
RETURNS void AS $$
BEGIN
  DELETE FROM mob_composition WHERE mob_name = p_mob_name;

  INSERT INTO mob_composition (mob_name, cattle_type, count)
  SELECT mob_name, cattle_type, COUNT(*)
  FROM animals
  WHERE mob_name = p_mob_name AND status = 'alive'
  GROUP BY mob_name, cattle_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION add_animal(
  p_mob_name TEXT,
  p_cattle_type TEXT,
  p_nlis_tag TEXT DEFAULT NULL,
  p_management_tag TEXT DEFAULT NULL,
  p_breed TEXT DEFAULT NULL,
  p_birth_date DATE DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  new_animal_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM mobs WHERE name = p_mob_name) THEN
    RAISE EXCEPTION 'Mob "%" does not exist', p_mob_name;
  END IF;

  IF p_cattle_type NOT IN ('cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other') THEN
    RAISE EXCEPTION 'Invalid cattle_type: %', p_cattle_type;
  END IF;

  IF p_nlis_tag IS NOT NULL AND EXISTS (SELECT 1 FROM animals WHERE nlis_tag = p_nlis_tag) THEN
    RAISE EXCEPTION 'NLIS tag "%" already exists', p_nlis_tag;
  END IF;

  INSERT INTO animals (mob_name, cattle_type, nlis_tag, management_tag, breed, birth_date, description, status)
  VALUES (p_mob_name, p_cattle_type, p_nlis_tag, p_management_tag, p_breed, p_birth_date, p_description, 'alive')
  RETURNING id INTO new_animal_id;

  PERFORM sync_mob_composition(p_mob_name);

  RETURN new_animal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add multiple untagged animals (bulk)
CREATE OR REPLACE FUNCTION add_animals_bulk(
  p_mob_name TEXT,
  p_cattle_type TEXT,
  p_count INTEGER,
  p_breed TEXT DEFAULT NULL,
  p_birth_date DATE DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  i INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM mobs WHERE name = p_mob_name) THEN
    RAISE EXCEPTION 'Mob "%" does not exist', p_mob_name;
  END IF;

  IF p_cattle_type NOT IN ('cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other') THEN
    RAISE EXCEPTION 'Invalid cattle_type: %', p_cattle_type;
  END IF;

  IF p_count <= 0 THEN
    RAISE EXCEPTION 'Count must be positive';
  END IF;

  FOR i IN 1..p_count LOOP
    INSERT INTO animals (mob_name, cattle_type, breed, birth_date, description, status)
    VALUES (p_mob_name, p_cattle_type, p_breed, p_birth_date, p_description, 'alive');
  END LOOP;

  PERFORM sync_mob_composition(p_mob_name);

  RETURN p_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Tag an existing animal
CREATE OR REPLACE FUNCTION tag_animal(
  p_animal_id UUID,
  p_nlis_tag TEXT DEFAULT NULL,
  p_management_tag TEXT DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM animals WHERE id = p_animal_id) THEN
    RAISE EXCEPTION 'Animal with ID % does not exist', p_animal_id;
  END IF;

  IF p_nlis_tag IS NOT NULL AND EXISTS (
    SELECT 1 FROM animals WHERE nlis_tag = p_nlis_tag AND id != p_animal_id
  ) THEN
    RAISE EXCEPTION 'NLIS tag "%" already exists', p_nlis_tag;
  END IF;

  UPDATE animals
  SET
    nlis_tag = COALESCE(p_nlis_tag, nlis_tag),
    management_tag = COALESCE(p_management_tag, management_tag),
    updated_at = NOW()
  WHERE id = p_animal_id;

  RETURN p_animal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Validate NLIS tag format
CREATE OR REPLACE FUNCTION validate_nlis_tag(p_tag TEXT)
RETURNS TABLE(is_valid BOOLEAN, warning TEXT) AS $$
DECLARE
  tag_clean TEXT;
  tag_length INTEGER;
BEGIN
  tag_clean := REGEXP_REPLACE(p_tag, '[\s\-\.]', '', 'g');
  tag_length := LENGTH(tag_clean);

  IF tag_length = 15 AND tag_clean ~ '^[0-9]{15}$' THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT;
  ELSIF tag_length = 16 AND tag_clean ~ '^[A-Z]{3}[0-9]{12}$' THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE,
      'Tag does not match NLIS format (expected 15 digits or 3-letter code + 12 digits). Actual length: ' || tag_length;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get mob composition (derived from live animals)
CREATE OR REPLACE FUNCTION get_mob_composition(p_mob_name TEXT)
RETURNS TABLE(cattle_type TEXT, count BIGINT, tagged_count BIGINT, untagged_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.cattle_type,
    COUNT(*) as count,
    COUNT(a.nlis_tag) as tagged_count,
    COUNT(*) FILTER (WHERE a.nlis_tag IS NULL) as untagged_count
  FROM animals a
  WHERE a.mob_name = p_mob_name AND a.status = 'alive'
  GROUP BY a.cattle_type
  ORDER BY a.cattle_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Log animal event (individual or bulk)
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
  IF p_event_type NOT IN ('sold', 'deceased') THEN
    RAISE EXCEPTION 'Invalid event_type: %. Must be ''sold'' or ''deceased''', p_event_type;
  END IF;

  IF p_animal_id IS NULL AND (p_cattle_type IS NULL OR p_count IS NULL) THEN
    RAISE EXCEPTION 'Must provide either animal_id OR (cattle_type + count)';
  END IF;

  IF p_animal_id IS NOT NULL AND (p_cattle_type IS NOT NULL OR p_count IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot provide both animal_id AND (cattle_type + count)';
  END IF;

  -- INDIVIDUAL ANIMAL EVENT
  IF p_animal_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM animals WHERE id = p_animal_id AND mob_name = p_mob_name AND status = 'alive') THEN
      RAISE EXCEPTION 'Animal not found or already sold/deceased';
    END IF;

    INSERT INTO animal_events (mob_name, event_type, animal_id, event_date, notes)
    VALUES (p_mob_name, p_event_type, p_animal_id, p_event_date, p_notes)
    RETURNING id INTO new_event_id;

    UPDATE animals SET status = p_event_type WHERE id = p_animal_id;

  -- BULK EVENT
  ELSE
    IF p_count <= 0 THEN
      RAISE EXCEPTION 'Count must be positive';
    END IF;

    SELECT ARRAY_AGG(id ORDER BY (nlis_tag IS NULL) DESC, created_at ASC)
    INTO animal_ids
    FROM animals
    WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type AND status = 'alive'
    LIMIT p_count;

    IF animal_ids IS NULL OR array_length(animal_ids, 1) < p_count THEN
      RAISE EXCEPTION 'Cannot log % % - only % alive in mob "%"',
        p_count, p_cattle_type, COALESCE(array_length(animal_ids, 1), 0), p_mob_name;
    END IF;

    INSERT INTO animal_events (mob_name, event_type, cattle_type, count, animal_ids, event_date, notes)
    VALUES (p_mob_name, p_event_type, p_cattle_type, p_count, to_jsonb(animal_ids), p_event_date, p_notes)
    RETURNING id INTO new_event_id;

    FOREACH aid IN ARRAY animal_ids LOOP
      UPDATE animals SET status = p_event_type WHERE id = aid;
    END LOOP;

    -- LEGACY: Update mob_composition if it exists
    SELECT count INTO current_count FROM mob_composition
    WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type;

    IF current_count IS NOT NULL THEN
      new_count := current_count - p_count;
      IF new_count > 0 THEN
        UPDATE mob_composition SET count = new_count
        WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type;
      ELSE
        DELETE FROM mob_composition WHERE mob_name = p_mob_name AND cattle_type = p_cattle_type;
      END IF;
    END IF;
  END IF;

  RETURN new_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reverse animal event on deletion
CREATE OR REPLACE FUNCTION reverse_animal_event()
RETURNS TRIGGER AS $$
DECLARE
  current_count INTEGER;
  aid UUID;
  animal_id_array UUID[];
BEGIN
  IF OLD.animal_id IS NOT NULL THEN
    UPDATE animals SET status = 'alive' WHERE id = OLD.animal_id;
  ELSIF OLD.animal_ids IS NOT NULL THEN
    SELECT ARRAY(SELECT jsonb_array_elements_text(OLD.animal_ids)::UUID) INTO animal_id_array;
    FOREACH aid IN ARRAY animal_id_array LOOP
      UPDATE animals SET status = 'alive' WHERE id = aid;
    END LOOP;

    SELECT count INTO current_count FROM mob_composition
    WHERE mob_name = OLD.mob_name AND cattle_type = OLD.cattle_type;

    IF current_count IS NOT NULL THEN
      UPDATE mob_composition SET count = count + OLD.count
      WHERE mob_name = OLD.mob_name AND cattle_type = OLD.cattle_type;
    ELSE
      INSERT INTO mob_composition (mob_name, cattle_type, count)
      VALUES (OLD.mob_name, OLD.cattle_type, OLD.count)
      ON CONFLICT (mob_name, cattle_type)
      DO UPDATE SET count = mob_composition.count + OLD.count;
    END IF;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS reverse_animal_event_on_delete ON animal_events;
CREATE TRIGGER reverse_animal_event_on_delete
  BEFORE DELETE ON animal_events
  FOR EACH ROW
  EXECUTE FUNCTION reverse_animal_event();

-- Migration function
CREATE OR REPLACE FUNCTION migrate_composition_to_animals()
RETURNS TABLE(mob_name TEXT, cattle_type TEXT, animals_created INTEGER) AS $$
DECLARE
  comp_record RECORD;
  i INTEGER;
BEGIN
  FOR comp_record IN SELECT mc.mob_name, mc.cattle_type, mc.count FROM mob_composition mc LOOP
    FOR i IN 1..comp_record.count LOOP
      INSERT INTO animals (mob_name, cattle_type, status)
      VALUES (comp_record.mob_name, comp_record.cattle_type, 'alive');
    END LOOP;
    RETURN QUERY SELECT comp_record.mob_name, comp_record.cattle_type, comp_record.count;
    RAISE NOTICE 'Created % untagged % animals in mob "%"',
      comp_record.count, comp_record.cattle_type, comp_record.mob_name;
  END LOOP;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Success!
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Individual animal tracking system installed successfully!';
  RAISE NOTICE 'Next step: Run this to migrate existing data: SELECT * FROM migrate_composition_to_animals();';
END $$;
