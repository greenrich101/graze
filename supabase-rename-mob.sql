-- Migration: Enable mob renaming by adding ON UPDATE CASCADE to mob_name foreign keys.
-- Run this once in your Supabase SQL Editor.

-- animals.mob_name → mobs.name
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT kcu.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'animals'
      AND kcu.column_name = 'mob_name'
      AND tc.constraint_type = 'FOREIGN KEY'
  LOOP
    EXECUTE format('ALTER TABLE animals DROP CONSTRAINT %I', r.constraint_name);
  END LOOP;
END $$;

ALTER TABLE animals
  ADD CONSTRAINT animals_mob_name_fkey
  FOREIGN KEY (mob_name) REFERENCES mobs(name) ON DELETE CASCADE ON UPDATE CASCADE;

-- animal_events.mob_name → mobs.name
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT kcu.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'animal_events'
      AND kcu.column_name = 'mob_name'
      AND tc.constraint_type = 'FOREIGN KEY'
  LOOP
    EXECUTE format('ALTER TABLE animal_events DROP CONSTRAINT %I', r.constraint_name);
  END LOOP;
END $$;

ALTER TABLE animal_events
  ADD CONSTRAINT animal_events_mob_name_fkey
  FOREIGN KEY (mob_name) REFERENCES mobs(name) ON DELETE CASCADE ON UPDATE CASCADE;

-- health_events.mob_name → mobs.name
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT kcu.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'health_events'
      AND kcu.column_name = 'mob_name'
      AND tc.constraint_type = 'FOREIGN KEY'
  LOOP
    EXECUTE format('ALTER TABLE health_events DROP CONSTRAINT %I', r.constraint_name);
  END LOOP;
END $$;

ALTER TABLE health_events
  ADD CONSTRAINT health_events_mob_name_fkey
  FOREIGN KEY (mob_name) REFERENCES mobs(name) ON UPDATE CASCADE;
