-- Tests for incidents.visible_patron_ban and incidents.active_patron_ban
--
-- visible: not archived (explicitly, or by a passed archives_at); a lifted
--          ban is still visible.
-- active:  visible AND lifts_at in the future.
--
-- Cross-database references (org_unit, created_by, ...) are plain uuids
-- with no FK constraints, so pinned literals suffice.

BEGIN;

SELECT plan(9);

INSERT INTO incidents.patrons (id, first_name, last_name, display_name, created_by) VALUES
    (9400, 'Ban', 'Views', 'Ban Views', 'a0000000-0000-4000-a000-000000009400');

INSERT INTO incidents.incidents (id, title, org_unit, created_by) VALUES
    (9400, 'Ban view fixture', 'a0000000-0000-4000-a000-000000009410', 'a0000000-0000-4000-a000-000000009400');

INSERT INTO incidents.patron_ban
    (id, patron, incident, org_unit, starts_at, lifts_at, is_trespass, archived_by, archives_at, created_by, updated_by, comments)
VALUES
    -- current ban: lifts in the future
    (9400, 9400, 9400, 'a0000000-0000-4000-a000-000000009410', now() - interval '1 day', now() + interval '30 days', false, NULL, NULL,
     'a0000000-0000-4000-a000-000000009400', 'a0000000-0000-4000-a000-000000009400', 'active'),
    -- lifted ban: visible, not active
    (9401, 9400, 9400, 'a0000000-0000-4000-a000-000000009410', now() - interval '30 days', now() - interval '1 day', false, NULL, NULL,
     'a0000000-0000-4000-a000-000000009400', 'a0000000-0000-4000-a000-000000009400', 'lifted'),
    -- explicitly archived: neither
    (9402, 9400, 9400, 'a0000000-0000-4000-a000-000000009410', now() - interval '1 day', now() + interval '30 days', false,
     'a0000000-0000-4000-a000-000000009400', NULL,
     'a0000000-0000-4000-a000-000000009400', 'a0000000-0000-4000-a000-000000009400', 'archived_by'),
    -- archives_at has passed: neither
    (9403, 9400, 9400, 'a0000000-0000-4000-a000-000000009410', now() - interval '1 day', now() + interval '30 days', false, NULL,
     now() - interval '1 hour',
     'a0000000-0000-4000-a000-000000009400', 'a0000000-0000-4000-a000-000000009400', 'archives_at'),
    -- expired trespass: visible, not active
    (9404, 9400, 9400, 'a0000000-0000-4000-a000-000000009410', now() - interval '400 days', now() - interval '1 day', true, NULL, NULL,
     'a0000000-0000-4000-a000-000000009400', 'a0000000-0000-4000-a000-000000009400', 'expired trespass');

SELECT set_eq(
    'SELECT id FROM incidents.visible_patron_ban WHERE patron = 9400',
    ARRAY[9400, 9401, 9404],
    'visible: current, lifted, and expired-trespass bans; not archived ones'
);

SELECT set_eq(
    'SELECT id FROM incidents.active_patron_ban WHERE patron = 9400',
    ARRAY[9400],
    'active: only the ban that has not lifted'
);

SELECT ok(
    NOT EXISTS (SELECT 1 FROM incidents.active_patron_ban WHERE lifts_at <= now()),
    'active never contains a lifted ban'
);

SELECT ok(
    EXISTS (SELECT 1 FROM incidents.visible_patron_ban WHERE id = 9401 AND lifts_at <= now()),
    'visible keeps a lifted ban'
);

SELECT ok(
    NOT EXISTS (SELECT 1 FROM incidents.visible_patron_ban WHERE archived_by IS NOT NULL),
    'visible drops explicitly archived bans'
);

SELECT ok(
    NOT EXISTS (SELECT 1 FROM incidents.visible_patron_ban WHERE archives_at <= now()),
    'visible drops bans whose archives_at has passed'
);

-- patron_search_summary reads visible_patron_ban and depends on lifted
-- trespasses staying visible.
SELECT is(
    (SELECT active_trespass_count FROM incidents.patron_search_summary
      WHERE patron_id = 9400 AND org_unit = 'a0000000-0000-4000-a000-000000009410'),
    1::bigint,
    'search summary counts a trespass after it has lifted'
);

SELECT is(
    (SELECT active_ban_count FROM incidents.patron_search_summary
      WHERE patron_id = 9400 AND org_unit = 'a0000000-0000-4000-a000-000000009410'),
    1::bigint,
    'search summary counts only the unlifted non-trespass ban'
);

SELECT is(
    (SELECT trespass_max_lifts_at FROM incidents.patron_search_summary
      WHERE patron_id = 9400 AND org_unit = 'a0000000-0000-4000-a000-000000009410'),
    (SELECT lifts_at FROM incidents.patron_ban WHERE id = 9404),
    'search summary reports the lifted trespass''s lift date'
);

SELECT * FROM finish();

ROLLBACK;
