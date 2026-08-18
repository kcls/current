-- Verify current:002_current_seed on pg

BEGIN;

SELECT 1/COUNT(*) FROM incidents.templates;
SELECT 1/COUNT(*) FROM incidents.sub_locations;
SELECT 1/COUNT(*) FROM incidents.ban_letter_template;

ROLLBACK;
