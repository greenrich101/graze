-- Movement RPCs migration
-- Run AFTER supabase-schema-v2.sql has been applied
--
-- Fixes: movements table doesn't support plan-then-execute flow,
--        plan_movement() and execute_movement() RPCs are missing.

-- ============================================================
-- 1. Alter movements table for planned moves
-- ============================================================

-- Allow planned moves (actual_move_in_date = NULL until executed)
ALTER TABLE movements ALTER COLUMN actual_move_in_date DROP NOT NULL;

-- Add planned_move_in_date column
ALTER TABLE movements ADD COLUMN IF NOT EXISTS planned_move_in_date DATE;

-- ============================================================
-- 2. Replace unique indexes to support active + planned per mob
-- ============================================================

-- Drop old indexes that block having both active and planned moves
DROP INDEX IF EXISTS idx_one_open_move_per_mob;
DROP INDEX IF EXISTS idx_one_open_move_per_paddock;

-- One active movement per mob (actual_move_in_date set, not yet moved out)
DROP INDEX IF EXISTS idx_one_active_move_per_mob;
CREATE UNIQUE INDEX idx_one_active_move_per_mob
  ON movements (mob_name)
  WHERE actual_move_in_date IS NOT NULL AND actual_move_out_date IS NULL;

-- One planned movement per mob (actual_move_in_date not yet set)
DROP INDEX IF EXISTS idx_one_planned_move_per_mob;
CREATE UNIQUE INDEX idx_one_planned_move_per_mob
  ON movements (mob_name)
  WHERE actual_move_in_date IS NULL;

-- One active movement per paddock
DROP INDEX IF EXISTS idx_one_active_move_per_paddock;
CREATE UNIQUE INDEX idx_one_active_move_per_paddock
  ON movements (paddock_name)
  WHERE actual_move_in_date IS NOT NULL AND actual_move_out_date IS NULL;

-- ============================================================
-- 3. plan_movement() — create or replace a planned movement
-- ============================================================

CREATE OR REPLACE FUNCTION plan_movement(
  p_mob_name TEXT,
  p_to_paddock TEXT,
  p_planned_move_date DATE,
  p_notes TEXT DEFAULT NULL,
  p_requirements JSONB DEFAULT '[]'
)
RETURNS UUID AS $$
DECLARE
  new_record_key UUID;
  req JSONB;
BEGIN
  -- Delete any existing planned movement for this mob
  DELETE FROM movements
  WHERE mob_name = p_mob_name AND actual_move_in_date IS NULL;

  -- Insert planned movement (actual_move_in_date left NULL)
  INSERT INTO movements (mob_name, paddock_name, planned_move_in_date, notes)
  VALUES (p_mob_name, p_to_paddock, p_planned_move_date, p_notes)
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

-- ============================================================
-- 4. execute_movement() — convert planned move to active
-- ============================================================

CREATE OR REPLACE FUNCTION execute_movement(
  p_mob_name TEXT
)
RETURNS UUID AS $$
DECLARE
  planned RECORD;
BEGIN
  -- Find the planned movement
  SELECT * INTO planned
  FROM movements
  WHERE mob_name = p_mob_name AND actual_move_in_date IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No planned movement found for mob "%"', p_mob_name;
  END IF;

  -- Close the current active movement for this mob
  UPDATE movements
  SET actual_move_out_date = CURRENT_DATE
  WHERE mob_name = p_mob_name
    AND actual_move_in_date IS NOT NULL
    AND actual_move_out_date IS NULL;

  -- Activate the planned movement
  UPDATE movements
  SET actual_move_in_date = CURRENT_DATE
  WHERE record_key = planned.record_key;

  RETURN planned.record_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
