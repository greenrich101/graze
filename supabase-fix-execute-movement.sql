-- Fix execute_movement function overloading conflict
-- This resolves: "Could not choose the best candidate function"
--
-- Problem: Multiple versions of execute_movement exist in the database
-- Solution: Drop all versions and create a single function with optional date parameter

-- ============================================================
-- Drop existing execute_movement function(s)
-- ============================================================

-- Drop all versions of the function (handles overloaded variants)
DROP FUNCTION IF EXISTS execute_movement(TEXT);
DROP FUNCTION IF EXISTS execute_movement(TEXT, DATE);

-- ============================================================
-- Create unified execute_movement with optional date
-- ============================================================

CREATE OR REPLACE FUNCTION execute_movement(
  p_mob_name TEXT,
  p_move_date DATE DEFAULT CURRENT_DATE
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

  -- Close the current active movement for this mob (use provided date for move-out)
  UPDATE movements
  SET actual_move_out_date = p_move_date
  WHERE mob_name = p_mob_name
    AND actual_move_in_date IS NOT NULL
    AND actual_move_out_date IS NULL;

  -- Activate the planned movement (use provided date for move-in)
  UPDATE movements
  SET actual_move_in_date = p_move_date
  WHERE record_key = planned.record_key;

  RETURN planned.record_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Usage examples:
-- ============================================================
-- Execute move today:        SELECT execute_movement('Mob A');
-- Execute move on past date: SELECT execute_movement('Mob A', '2026-01-15');
-- Execute move on future date: SELECT execute_movement('Mob A', '2026-03-01');
