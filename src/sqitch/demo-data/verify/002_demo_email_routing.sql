-- Verify current-demo:002_demo_email_routing on pg

BEGIN;

DO $$
DECLARE
    n INTEGER;
BEGIN
    SELECT COUNT(*) INTO n FROM incidents.notification_email_routing
     WHERE email_group::text LIKE '5eed0000-0000-4000-a000-0000000003%'
       AND is_active;
    IF n <> 14 THEN
        RAISE EXCEPTION 'expected 14 demo routing rows, found %', n;
    END IF;
END $$;

ROLLBACK;
