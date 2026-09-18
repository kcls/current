-- Revert current:001_incidents_baseline from pg

BEGIN;

DROP SCHEMA IF EXISTS incidents CASCADE;
DROP SCHEMA IF EXISTS audit CASCADE;

COMMIT;
