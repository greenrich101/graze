-- ============================================================
-- INDIVIDUAL ANIMAL TREATMENT LOGGING
-- Add RPC function for logging treatments on single animals
-- Run this in Supabase SQL Editor
-- Safe to re-run (idempotent)
-- ============================================================

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
  RAISE NOTICE '✅ Individual animal treatment logging installed successfully!';
  RAISE NOTICE 'You can now log treatments on individual animals in the AnimalList component.';
END $$;
