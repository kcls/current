-- Revert current:005_ban_view_predicates from pg

-- Restores the baseline's (swapped) definitions, so a revert lands on
-- exactly the state 004 left behind.

BEGIN;

CREATE OR REPLACE VIEW incidents.active_patron_ban AS
SELECT id, patron, incident, org_unit, starts_at, comments, created_by,
       created_at, updated_by, updated_at, lifted_by, is_trespass,
       archived_by, archives_at, lifts_at
  FROM incidents.patron_ban
 WHERE archived_by IS NULL
   AND (archives_at IS NULL OR archives_at > now());

CREATE OR REPLACE VIEW incidents.visible_patron_ban AS
SELECT id, patron, incident, org_unit, starts_at, comments, created_by,
       created_at, updated_by, updated_at, lifted_by, is_trespass,
       archived_by, archives_at, lifts_at
  FROM incidents.patron_ban
 WHERE archived_by IS NULL
   AND (archives_at IS NULL OR archives_at > now())
   AND lifts_at > now();

COMMIT;
