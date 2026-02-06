-- ============================================================
-- Test Script: Individual Animal Tracking
-- Run this in Supabase SQL Editor to test the new system
-- ============================================================

-- 1. Check existing mobs
SELECT 'Existing mobs:' as step;
SELECT name, description FROM mobs LIMIT 5;

-- 2. Add 5 untagged calves (change mob name to match your data)
SELECT 'Adding 5 untagged calves...' as step;
SELECT add_animals_bulk(
  (SELECT name FROM mobs LIMIT 1),  -- Use first mob
  'calf',
  5,
  'Angus',
  '2026-01-15',
  'Test calves - born in January'
);

-- 3. Add a tagged cow
SELECT 'Adding tagged cow...' as step;
SELECT add_animal(
  (SELECT name FROM mobs LIMIT 1),
  'cow',
  '982000123456789',
  'TAG-001',
  'Hereford',
  '2023-05-20',
  'Test breeding cow'
);

-- 4. View all animals in the mob
SELECT 'All animals in mob:' as step;
SELECT
  id,
  cattle_type,
  nlis_tag,
  management_tag,
  breed,
  status,
  birth_date,
  created_at
FROM animals
WHERE mob_name = (SELECT name FROM mobs LIMIT 1)
ORDER BY cattle_type, created_at;

-- 5. Get mob composition (grouped counts)
SELECT 'Mob composition (grouped):' as step;
SELECT * FROM get_mob_composition((SELECT name FROM mobs LIMIT 1));

-- 6. Test NLIS tag validation
SELECT 'NLIS tag validation tests:' as step;
SELECT 'Valid tag:' as test, * FROM validate_nlis_tag('982000123456789');
SELECT 'Invalid tag:' as test, * FROM validate_nlis_tag('ABC123');

-- 7. Log 2 calves sold (bulk event)
SELECT 'Logging 2 calves sold...' as step;
SELECT log_animal_event(
  (SELECT name FROM mobs LIMIT 1),
  'sold',
  NULL,
  'calf',
  2,
  CURRENT_DATE,
  'Test sale at market'
);

-- 8. Check composition after sale (should show 3 calves now)
SELECT 'Composition after sale:' as step;
SELECT * FROM get_mob_composition((SELECT name FROM mobs LIMIT 1));

-- 9. Check animal statuses
SELECT 'Animal statuses:' as step;
SELECT
  cattle_type,
  status,
  COUNT(*) as count
FROM animals
WHERE mob_name = (SELECT name FROM mobs LIMIT 1)
GROUP BY cattle_type, status
ORDER BY cattle_type, status;

-- 10. View the sold event
SELECT 'Sold event details:' as step;
SELECT
  id,
  event_type,
  cattle_type,
  count,
  animal_ids,
  event_date,
  notes
FROM animal_events
WHERE mob_name = (SELECT name FROM mobs LIMIT 1)
  AND event_type = 'sold'
ORDER BY created_at DESC
LIMIT 1;

-- ============================================================
-- OPTIONAL: Cleanup test data
-- ============================================================
-- Uncomment these lines to clean up test data:

-- DELETE FROM animal_events WHERE mob_name = (SELECT name FROM mobs LIMIT 1);
-- DELETE FROM animals WHERE mob_name = (SELECT name FROM mobs LIMIT 1);
