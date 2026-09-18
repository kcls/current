-- Verify current:002_current_seed on pg
--
-- Sub-locations are deliberately not checked: they moved to the
-- current-demo project, and an installation that skips it still has a
-- correct seed.

BEGIN;

SELECT 1/COUNT(*) FROM incidents.templates;
SELECT 1/COUNT(*) FROM incidents.ban_letter_template;

ROLLBACK;
