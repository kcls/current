-- Revert current-demo:001_demo_sub_locations from pg
--
-- Deletes by the pinned ids this change created. Incidents reference
-- sub_locations, so a revert after real use will fail on the foreign
-- key -- correctly: demo rows that incidents now point at are no longer
-- disposable.

BEGIN;

DELETE FROM incidents.sub_locations WHERE id BETWEEN 58 AND 64;

COMMIT;
