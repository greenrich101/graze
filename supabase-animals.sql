-- Individual Animal Tracking System (safe re-run version)
-- This version drops existing objects first, so it can be run multiple times

-- ============================================================
-- 1. Drop existing policies if they exist
-- ============================================================

DROP POLICY IF EXISTS "Property members can view animals" ON animals;
DROP POLICY IF EXISTS "Property members can create animals" ON animals;
DROP POLICY IF EXISTS "Property members can update animals" ON animals;
DROP POLICY IF EXISTS "Property members can delete animals" ON animals;

-- ============================================================
-- 2. Create animals table (with IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS animals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mob_name TEXT NOT NULL REFERENCES mobs(name) ON DELETE CASCADE,
  nlis_tag TEXT UNIQUE,  -- electronic tag (nullable, added later)
  management_tag TEXT,   -- visual tag (nullable, added later)
  cattle_type TEXT NOT NULL CHECK (cattle_type IN ('cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other')),
  breed TEXT,            -- genetics/breed info
  birth_date DATE,       -- when born (nullable for existing stock)
  status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'sold', 'deceased')),
  description TEXT,      -- notes
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 3. Enable RLS
-- ============================================================

ALTER TABLE animals ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Create RLS Policies (fresh)
-- ============================================================

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

-- ============================================================
-- 5. Drop and recreate updated_at trigger
-- ============================================================

DROP TRIGGER IF EXISTS update_animals_updated_at ON animals;

CREATE TRIGGER update_animals_updated_at
  BEFORE UPDATE ON animals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 6. Create indexes for common queries
-- ============================================================

CREATE INDEX IF NOT EXISTS animals_mob_name_idx
  ON animals(mob_name);

CREATE INDEX IF NOT EXISTS animals_nlis_tag_idx
  ON animals(nlis_tag) WHERE nlis_tag IS NOT NULL;

CREATE INDEX IF NOT EXISTS animals_management_tag_idx
  ON animals(management_tag) WHERE management_tag IS NOT NULL;

CREATE INDEX IF NOT EXISTS animals_status_idx
  ON animals(status);

CREATE INDEX IF NOT EXISTS animals_cattle_type_idx
  ON animals(cattle_type);

-- ============================================================
-- 7. RPC: Add individual animal
-- ============================================================

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
  -- Validate mob exists
  IF NOT EXISTS (SELECT 1 FROM mobs WHERE name = p_mob_name) THEN
    RAISE EXCEPTION 'Mob "%" does not exist', p_mob_name;
  END IF;

  -- Validate cattle_type
  IF p_cattle_type NOT IN ('cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other') THEN
    RAISE EXCEPTION 'Invalid cattle_type: %', p_cattle_type;
  END IF;

  -- Check NLIS tag uniqueness if provided
  IF p_nlis_tag IS NOT NULL AND EXISTS (SELECT 1 FROM animals WHERE nlis_tag = p_nlis_tag) THEN
    RAISE EXCEPTION 'NLIS tag "%" already exists', p_nlis_tag;
  END IF;

  -- Insert animal
  INSERT INTO animals (mob_name, cattle_type, nlis_tag, management_tag, breed, birth_date, description, status)
  VALUES (p_mob_name, p_cattle_type, p_nlis_tag, p_management_tag, p_breed, p_birth_date, p_description, 'alive')
  RETURNING id INTO new_animal_id;

  RETURN new_animal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. RPC: Add multiple untagged animals (bulk)
-- ============================================================

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
  -- Validate mob exists
  IF NOT EXISTS (SELECT 1 FROM mobs WHERE name = p_mob_name) THEN
    RAISE EXCEPTION 'Mob "%" does not exist', p_mob_name;
  END IF;

  -- Validate cattle_type
  IF p_cattle_type NOT IN ('cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other') THEN
    RAISE EXCEPTION 'Invalid cattle_type: %', p_cattle_type;
  END IF;

  -- Validate count
  IF p_count <= 0 THEN
    RAISE EXCEPTION 'Count must be positive';
  END IF;

  -- Insert animals (all untagged)
  FOR i IN 1..p_count LOOP
    INSERT INTO animals (mob_name, cattle_type, breed, birth_date, description, status)
    VALUES (p_mob_name, p_cattle_type, p_breed, p_birth_date, p_description, 'alive');
  END LOOP;

  RETURN p_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 9. RPC: Tag an existing animal
-- ============================================================

CREATE OR REPLACE FUNCTION tag_animal(
  p_animal_id UUID,
  p_nlis_tag TEXT DEFAULT NULL,
  p_management_tag TEXT DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
  -- Validate animal exists
  IF NOT EXISTS (SELECT 1 FROM animals WHERE id = p_animal_id) THEN
    RAISE EXCEPTION 'Animal with ID % does not exist', p_animal_id;
  END IF;

  -- Check NLIS tag uniqueness if provided
  IF p_nlis_tag IS NOT NULL AND EXISTS (
    SELECT 1 FROM animals WHERE nlis_tag = p_nlis_tag AND id != p_animal_id
  ) THEN
    RAISE EXCEPTION 'NLIS tag "%" already exists', p_nlis_tag;
  END IF;

  -- Update tags (NULL values won't update)
  UPDATE animals
  SET
    nlis_tag = COALESCE(p_nlis_tag, nlis_tag),
    management_tag = COALESCE(p_management_tag, management_tag),
    updated_at = NOW()
  WHERE id = p_animal_id;

  RETURN p_animal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 10. RPC: Validate NLIS tag format
-- ============================================================

CREATE OR REPLACE FUNCTION validate_nlis_tag(p_tag TEXT)
RETURNS TABLE(
  is_valid BOOLEAN,
  warning TEXT
) AS $$
DECLARE
  tag_clean TEXT;
  tag_length INTEGER;
BEGIN
  -- Remove spaces and common separators
  tag_clean := REGEXP_REPLACE(p_tag, '[\s\-\.]', '', 'g');
  tag_length := LENGTH(tag_clean);

  -- NLIS standard: 15 characters (3-letter country code + 12 digits)
  -- Example: 982000123456789 (Australia)

  IF tag_length = 15 AND tag_clean ~ '^[0-9]{15}$' THEN
    -- Valid NLIS format
    RETURN QUERY SELECT TRUE, NULL::TEXT;
  ELSIF tag_length = 16 AND tag_clean ~ '^[A-Z]{3}[0-9]{12}$' THEN
    -- Alternative format with letter prefix
    RETURN QUERY SELECT TRUE, NULL::TEXT;
  ELSE
    -- Doesn't match NLIS spec, return warning
    RETURN QUERY SELECT FALSE,
      'Tag does not match NLIS format (expected 15 digits or 3-letter code + 12 digits). Actual length: ' || tag_length;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 11. RPC: Get mob composition (derived from live animals)
-- ============================================================

CREATE OR REPLACE FUNCTION get_mob_composition(p_mob_name TEXT)
RETURNS TABLE(
  cattle_type TEXT,
  count BIGINT,
  tagged_count BIGINT,
  untagged_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.cattle_type,
    COUNT(*) as count,
    COUNT(a.nlis_tag) as tagged_count,
    COUNT(*) FILTER (WHERE a.nlis_tag IS NULL) as untagged_count
  FROM animals a
  WHERE a.mob_name = p_mob_name
    AND a.status = 'alive'
  GROUP BY a.cattle_type
  ORDER BY a.cattle_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. Migration RPC: Convert mob_composition to individual animals
-- ============================================================

CREATE OR REPLACE FUNCTION migrate_composition_to_animals()
RETURNS TABLE(
  mob_name TEXT,
  cattle_type TEXT,
  animals_created INTEGER
) AS $$
DECLARE
  comp_record RECORD;
  i INTEGER;
  total_created INTEGER;
BEGIN
  -- Iterate through all mob_composition records
  FOR comp_record IN
    SELECT mc.mob_name, mc.cattle_type, mc.count
    FROM mob_composition mc
  LOOP
    -- Create individual animals for each count
    FOR i IN 1..comp_record.count LOOP
      INSERT INTO animals (mob_name, cattle_type, status)
      VALUES (comp_record.mob_name, comp_record.cattle_type, 'alive');
    END LOOP;

    -- Return summary for this mob/type
    RETURN QUERY SELECT comp_record.mob_name, comp_record.cattle_type, comp_record.count;

    RAISE NOTICE 'Created % untagged % animals in mob "%"',
      comp_record.count, comp_record.cattle_type, comp_record.mob_name;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Success message
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'Animals table created successfully!';
  RAISE NOTICE 'To migrate existing mob_composition data, run: SELECT * FROM migrate_composition_to_animals();';
END $$;
