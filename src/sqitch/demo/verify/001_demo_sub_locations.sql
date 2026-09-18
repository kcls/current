-- Verify current-demo:001_demo_sub_locations on pg

BEGIN;

DO $$
DECLARE
    n INTEGER;
BEGIN
    SELECT COUNT(*) INTO n FROM incidents.sub_locations
     WHERE org_unit = '5eed0000-0000-4000-a000-000000000201'
       AND deleted_at IS NULL;
    IF n < 7 THEN
        RAISE EXCEPTION 'expected the demo sub-locations on the demo root, found %', n;
    END IF;
END $$;

ROLLBACK;
