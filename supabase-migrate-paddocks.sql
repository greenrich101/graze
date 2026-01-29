-- Paddocks Migration: old schema → V1 schema
-- Run this in Supabase SQL Editor BEFORE running supabase-schema-v2.sql
--
-- Old: paddocks (id UUID PK, user_id, name, acres, created_at, updated_at)
-- New: paddocks (name TEXT PK, property_id, area_acres, created_at, updated_at)

BEGIN;

-- 1. Ensure properties + user_properties exist
CREATE TABLE IF NOT EXISTS properties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS user_properties (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, property_id)
);

-- 2. RLS helper function
CREATE OR REPLACE FUNCTION user_belongs_to_property(p_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_properties
    WHERE user_id = auth.uid() AND property_id = p_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 3. Create a property for each distinct user_id that owns paddocks
DO $$
DECLARE
  r RECORD;
  new_prop_id UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id FROM paddocks
    WHERE user_id NOT IN (SELECT user_id FROM user_properties)
  LOOP
    INSERT INTO properties (name) VALUES ('My Property') RETURNING id INTO new_prop_id;
    INSERT INTO user_properties (user_id, property_id, role) VALUES (r.user_id, new_prop_id, 'owner');
  END LOOP;
END $$;

-- 4. Rename old table
ALTER TABLE paddocks RENAME TO paddocks_old;

-- 5. Drop old RLS policies (they reference the old table, now renamed)
DROP POLICY IF EXISTS "Users can view their own paddocks" ON paddocks_old;
DROP POLICY IF EXISTS "Users can create their own paddocks" ON paddocks_old;
DROP POLICY IF EXISTS "Users can update their own paddocks" ON paddocks_old;
DROP POLICY IF EXISTS "Users can delete their own paddocks" ON paddocks_old;

-- 6. Drop old trigger
DROP TRIGGER IF EXISTS update_paddocks_updated_at ON paddocks_old;

-- 7. Create new paddocks table with V1 schema
CREATE TABLE paddocks (
  name TEXT PRIMARY KEY,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  area_acres DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 8. Copy data from old table (trim names, resolve property_id via user_properties)
INSERT INTO paddocks (name, property_id, area_acres, created_at, updated_at)
SELECT
  TRIM(po.name),
  up.property_id,
  po.acres,
  po.created_at,
  po.updated_at
FROM paddocks_old po
JOIN user_properties up ON up.user_id = po.user_id
ON CONFLICT (name) DO NOTHING;  -- skip duplicates after trim

-- 9. Enable RLS on new table
ALTER TABLE paddocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Property members can view paddocks"
  ON paddocks FOR SELECT
  USING (user_belongs_to_property(property_id));

CREATE POLICY "Property members can create paddocks"
  ON paddocks FOR INSERT
  WITH CHECK (user_belongs_to_property(property_id));

CREATE POLICY "Property members can update paddocks"
  ON paddocks FOR UPDATE
  USING (user_belongs_to_property(property_id));

CREATE POLICY "Property members can delete paddocks"
  ON paddocks FOR DELETE
  USING (user_belongs_to_property(property_id));

-- 10. Recreate updated_at trigger on new table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_paddocks_updated_at
  BEFORE UPDATE ON paddocks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 11. RLS on properties + user_properties
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their properties"
  ON properties FOR SELECT USING (user_belongs_to_property(id));
CREATE POLICY "Users can create properties"
  ON properties FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their properties"
  ON properties FOR UPDATE USING (user_belongs_to_property(id));

CREATE POLICY "Users can view their own memberships"
  ON user_properties FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create memberships for themselves"
  ON user_properties FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 12. Drop old table
DROP TABLE paddocks_old;

COMMIT;

-- 13. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- Verify afterward:
--   SELECT * FROM paddocks;
--   SELECT * FROM properties;
--   SELECT * FROM user_properties;
