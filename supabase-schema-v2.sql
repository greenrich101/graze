-- Graze Schema V2 — Phase 2+ objects
-- Run this AFTER supabase-migrate-paddocks.sql has been applied
--
-- Prerequisites: properties, user_properties, paddocks (name PK, area_acres)
--                user_belongs_to_property() function, update_updated_at_column() trigger

-- ============================================================
-- PHASE 2: Mobs + Mob Composition
-- ============================================================

CREATE TABLE IF NOT EXISTS mobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  next_paddock_name TEXT REFERENCES paddocks(name) ON DELETE SET NULL,
  next_move_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE mobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Property members can view mobs"
  ON mobs FOR SELECT USING (user_belongs_to_property(property_id));
CREATE POLICY "Property members can create mobs"
  ON mobs FOR INSERT WITH CHECK (user_belongs_to_property(property_id));
CREATE POLICY "Property members can update mobs"
  ON mobs FOR UPDATE USING (user_belongs_to_property(property_id));
CREATE POLICY "Property members can delete mobs"
  ON mobs FOR DELETE USING (user_belongs_to_property(property_id));

CREATE INDEX IF NOT EXISTS mobs_property_id_idx ON mobs(property_id);

CREATE TRIGGER update_mobs_updated_at
  BEFORE UPDATE ON mobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS mob_composition (
  mob_name TEXT NOT NULL REFERENCES mobs(name) ON DELETE CASCADE,
  cattle_type TEXT NOT NULL CHECK (cattle_type IN ('cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other')),
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (mob_name, cattle_type)
);

ALTER TABLE mob_composition ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Property members can view mob composition"
  ON mob_composition FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM mobs WHERE mobs.name = mob_composition.mob_name AND user_belongs_to_property(mobs.property_id)
  ));
CREATE POLICY "Property members can create mob composition"
  ON mob_composition FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM mobs WHERE mobs.name = mob_composition.mob_name AND user_belongs_to_property(mobs.property_id)
  ));
CREATE POLICY "Property members can update mob composition"
  ON mob_composition FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM mobs WHERE mobs.name = mob_composition.mob_name AND user_belongs_to_property(mobs.property_id)
  ));
CREATE POLICY "Property members can delete mob composition"
  ON mob_composition FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM mobs WHERE mobs.name = mob_composition.mob_name AND user_belongs_to_property(mobs.property_id)
  ));

-- ============================================================
-- PHASE 3: Movements + Requirements
-- ============================================================

CREATE TABLE IF NOT EXISTS movements (
  record_key UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mob_name TEXT NOT NULL REFERENCES mobs(name) ON DELETE CASCADE,
  paddock_name TEXT NOT NULL REFERENCES paddocks(name) ON DELETE CASCADE,
  actual_move_in_date DATE NOT NULL,
  actual_move_out_date DATE,
  planned_graze_days INT,
  planned_move_out_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Property members can view movements"
  ON movements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM mobs WHERE mobs.name = movements.mob_name AND user_belongs_to_property(mobs.property_id)
  ));
CREATE POLICY "Property members can create movements"
  ON movements FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM mobs WHERE mobs.name = movements.mob_name AND user_belongs_to_property(mobs.property_id)
  ));
CREATE POLICY "Property members can update movements"
  ON movements FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM mobs WHERE mobs.name = movements.mob_name AND user_belongs_to_property(mobs.property_id)
  ));

CREATE INDEX IF NOT EXISTS movements_mob_name_idx ON movements(mob_name);
CREATE INDEX IF NOT EXISTS movements_paddock_name_idx ON movements(paddock_name);

-- One open movement per mob
CREATE UNIQUE INDEX idx_one_open_move_per_mob
  ON movements (mob_name)
  WHERE actual_move_out_date IS NULL;

-- One open movement per paddock
CREATE UNIQUE INDEX idx_one_open_move_per_paddock
  ON movements (paddock_name)
  WHERE actual_move_out_date IS NULL;

-- Requirement types (reference data)
CREATE TABLE IF NOT EXISTS requirement_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

INSERT INTO requirement_types (name) VALUES
  ('Lick required'),
  ('Tub required'),
  ('Check water'),
  ('Check fences'),
  ('Supplement feed')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE requirement_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view requirement types"
  ON requirement_types FOR SELECT USING (true);

-- Movement requirements
CREATE TABLE IF NOT EXISTS movement_requirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  movement_record_key UUID REFERENCES movements(record_key) ON DELETE CASCADE NOT NULL,
  requirement_type_id UUID REFERENCES requirement_types(id) ON DELETE CASCADE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE movement_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Property members can view movement requirements"
  ON movement_requirements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM movements
    JOIN mobs ON mobs.name = movements.mob_name
    WHERE movements.record_key = movement_requirements.movement_record_key
      AND user_belongs_to_property(mobs.property_id)
  ));
CREATE POLICY "Property members can create movement requirements"
  ON movement_requirements FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM movements
    JOIN mobs ON mobs.name = movements.mob_name
    WHERE movements.record_key = movement_requirements.movement_record_key
      AND user_belongs_to_property(mobs.property_id)
  ));

CREATE INDEX IF NOT EXISTS movement_requirements_record_key_idx ON movement_requirements(movement_record_key);

-- record_movement: atomically close previous open movement, insert new with requirements
CREATE OR REPLACE FUNCTION record_movement(
  p_mob_name TEXT,
  p_to_paddock TEXT,
  p_move_date DATE,
  p_notes TEXT DEFAULT NULL,
  p_planned_graze_days INT DEFAULT NULL,
  p_requirements JSONB DEFAULT '[]'
)
RETURNS UUID AS $$
DECLARE
  new_record_key UUID;
  req JSONB;
BEGIN
  -- Close any open movement for this mob
  UPDATE movements
  SET actual_move_out_date = p_move_date
  WHERE mob_name = p_mob_name AND actual_move_out_date IS NULL;

  -- Insert new open movement
  INSERT INTO movements (mob_name, paddock_name, actual_move_in_date, planned_graze_days, planned_move_out_date, notes)
  VALUES (
    p_mob_name,
    p_to_paddock,
    p_move_date,
    p_planned_graze_days,
    CASE WHEN p_planned_graze_days IS NOT NULL THEN p_move_date + p_planned_graze_days ELSE NULL END,
    p_notes
  )
  RETURNING record_key INTO new_record_key;

  -- Insert requirements
  FOR req IN SELECT * FROM jsonb_array_elements(p_requirements)
  LOOP
    INSERT INTO movement_requirements (movement_record_key, requirement_type_id, notes)
    VALUES (new_record_key, (req->>'requirement_type_id')::UUID, req->>'notes');
  END LOOP;

  RETURN new_record_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
