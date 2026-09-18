-- Verify current:001_incidents_baseline on pg

BEGIN;

SELECT 1/COUNT(*) FROM information_schema.schemata WHERE schema_name = 'incidents';
SELECT id FROM incidents.incidents WHERE FALSE;
SELECT id FROM incidents.patrons WHERE FALSE;

ROLLBACK;
