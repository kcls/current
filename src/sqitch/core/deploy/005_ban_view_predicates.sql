-- Deploy current:005_ban_view_predicates to pg
-- requires: 004_shift_note_occurred_at

-- The baseline carried the two ban views with their predicates swapped:
-- active_patron_ban had no lifts_at filter and visible_patron_ban had
-- one. The names, every consumer, and the pre-split definitions all mean
-- the opposite:
--
--   visible_patron_ban  not archived (explicitly or by archives_at);
--                       lifted bans are still visible
--   active_patron_ban   visible AND not yet lifted
--
-- patron_search_summary reads visible_patron_ban expecting lifted
-- trespasses to remain in it ("ALL non-archived trespasses"), so with the
-- swap an expired trespass dropped out of the summary the moment it
-- lifted.

BEGIN;

CREATE OR REPLACE VIEW incidents.visible_patron_ban AS
SELECT id, patron, incident, org_unit, starts_at, comments, created_by,
       created_at, updated_by, updated_at, lifted_by, is_trespass,
       archived_by, archives_at, lifts_at
  FROM incidents.patron_ban
 WHERE archived_by IS NULL
   AND (archives_at IS NULL OR archives_at > now());

CREATE OR REPLACE VIEW incidents.active_patron_ban AS
SELECT id, patron, incident, org_unit, starts_at, comments, created_by,
       created_at, updated_by, updated_at, lifted_by, is_trespass,
       archived_by, archives_at, lifts_at
  FROM incidents.patron_ban
 WHERE archived_by IS NULL
   AND (archives_at IS NULL OR archives_at > now())
   AND lifts_at > now();

COMMIT;
