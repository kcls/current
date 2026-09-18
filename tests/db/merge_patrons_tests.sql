-- Tests for incidents.merge_patrons(INTEGER, INTEGER, UUID)
-- Covers: data transfer, same-incident dedup, photo demotion, soft delete, timeline event
--
-- Post-split: Current's database holds only the incidents schema, and
-- cross-database references (created_by, org_unit, file_upload, merged_by)
-- are plain uuids with no FK constraints — they need no backing rows in the
-- odo database. Staff (…9300), org unit (…9010), and file upload
-- (…9301/…9302) uuids are pinned literals below.

BEGIN;

SELECT plan(26);

-- =============================================================================
-- SETUP: two patrons, incidents, bans, photos, notes
-- =============================================================================

-- Primary patron (id=9300)
INSERT INTO incidents.patrons (id, first_name, last_name, display_name, created_by) VALUES
    (9300, 'Alice', 'Primary', 'Alice Primary', 'a0000000-0000-4000-a000-000000009300');

-- Secondary patron (id=9301)
INSERT INTO incidents.patrons (id, first_name, last_name, display_name, created_by) VALUES
    (9301, 'Bob', 'Secondary', 'Bob Secondary', 'a0000000-0000-4000-a000-000000009300');

-- Extra patron for negative tests (id=9302)
INSERT INTO incidents.patrons (id, first_name, last_name, display_name, created_by, deleted_at) VALUES
    (9302, 'Deleted', 'Patron', 'Deleted Patron', 'a0000000-0000-4000-a000-000000009300', NOW());

-- Empty patron for zero-data edge case (id=9303)
INSERT INTO incidents.patrons (id, first_name, last_name, display_name, created_by) VALUES
    (9303, 'Empty', 'Patron', 'Empty Patron', 'a0000000-0000-4000-a000-000000009300');

-- Incidents: 3 total (inc A belongs to primary, inc B to secondary, inc C to BOTH)
INSERT INTO incidents.incidents (id, title, org_unit, created_by) VALUES
    (9300, 'Incident A', 'a0000000-0000-4000-a000-000000009010', 'a0000000-0000-4000-a000-000000009300'),
    (9301, 'Incident B', 'a0000000-0000-4000-a000-000000009010', 'a0000000-0000-4000-a000-000000009300'),
    (9302, 'Incident C (shared)', 'a0000000-0000-4000-a000-000000009010', 'a0000000-0000-4000-a000-000000009300');

-- Involved parties
INSERT INTO incidents.involved_parties (id, incident_id, patron_id, party_type, role) VALUES
    (9300, 9300, 9300, 'patron', 'witness'),     -- primary in A
    (9301, 9301, 9301, 'patron', 'suspect'),      -- secondary in B
    (9302, 9302, 9300, 'patron', 'witness'),      -- primary in C
    (9303, 9302, 9301, 'patron', 'suspect');       -- secondary in C (same incident!)

-- Bans: 2 for secondary
INSERT INTO incidents.patron_ban (id, patron, incident, org_unit, is_trespass, created_by, updated_by) VALUES
    (9300, 9301, 9301, 'a0000000-0000-4000-a000-000000009010', false,
     'a0000000-0000-4000-a000-000000009300', 'a0000000-0000-4000-a000-000000009300'),
    (9301, 9301, 9301, 'a0000000-0000-4000-a000-000000009010', true,
     'a0000000-0000-4000-a000-000000009300', 'a0000000-0000-4000-a000-000000009300');

-- Photos: primary has 1 primary photo, secondary has 1 primary photo
INSERT INTO incidents.patron_photo (id, patron, file_upload, is_primary) VALUES
    (9300, 9300, 'a0000000-0000-4000-a000-000000009301', true),
    (9301, 9301, 'a0000000-0000-4000-a000-000000009302', true);

-- Notes: 1 active note for secondary, 1 deleted note (should not count)
INSERT INTO incidents.patron_notes (id, patron_id, note_type, content, created_by) VALUES
    (9300, 9301, 'general', 'Active note', 'a0000000-0000-4000-a000-000000009300');
INSERT INTO incidents.patron_notes (id, patron_id, note_type, content, created_by, deleted_at) VALUES
    (9301, 9301, 'general', 'Deleted note', 'a0000000-0000-4000-a000-000000009300', NOW());

-- Timeline events: 1 for secondary
INSERT INTO incidents.patron_timeline_events (id, patron_id, event_type) VALUES
    (9300, 9301, 'note_added');

-- =============================================================================
-- TEST SUITE 1: Validation — error on missing/deleted patrons
-- =============================================================================

SELECT throws_ok(
    $$SELECT * FROM incidents.merge_patrons(99999, 9301, 'a0000000-0000-4000-a000-000000009300')$$,
    'Primary patron 99999 not found or deleted'
);

SELECT throws_ok(
    $$SELECT * FROM incidents.merge_patrons(9300, 99999, 'a0000000-0000-4000-a000-000000009300')$$,
    'Secondary patron 99999 not found or deleted'
);

SELECT throws_ok(
    $$SELECT * FROM incidents.merge_patrons(9302, 9301, 'a0000000-0000-4000-a000-000000009300')$$,
    'Primary patron 9302 not found or deleted'
);

SELECT throws_ok(
    $$SELECT * FROM incidents.merge_patrons(9300, 9302, 'a0000000-0000-4000-a000-000000009300')$$,
    'Secondary patron 9302 not found or deleted'
);

-- =============================================================================
-- TEST SUITE 2: Execute merge and verify returned counts
-- =============================================================================

-- Run the merge
SELECT results_eq(
    $$SELECT incidents_transferred, photos_transferred, bans_transferred, notes_transferred
      FROM incidents.merge_patrons(9300, 9301, 'a0000000-0000-4000-a000-000000009300')$$,
    $$VALUES (1, 1, 2, 1)$$,
    'Merge returns correct transfer counts (1 incident, 1 photo, 2 bans, 1 active note)'
);

-- =============================================================================
-- TEST SUITE 3: Involved parties — transferred and deduped
-- =============================================================================

-- Secondary's solo incident (B) should now belong to primary
SELECT is(
    (SELECT patron_id FROM incidents.involved_parties WHERE id = 9301),
    9300,
    'Secondary solo incident transferred to primary'
);

-- Shared incident (C): primary's row stays, secondary's row should be deleted
SELECT ok(
    EXISTS (SELECT 1 FROM incidents.involved_parties WHERE incident_id = 9302 AND patron_id = 9300),
    'Primary still linked to shared incident'
);

SELECT ok(
    NOT EXISTS (SELECT 1 FROM incidents.involved_parties WHERE patron_id = 9301),
    'No involved_parties rows remain for secondary patron'
);

-- incidents_transferred = 1 because incident C was skipped (both patrons present)
-- incident B was transferred

-- =============================================================================
-- TEST SUITE 4: Bans transferred
-- =============================================================================

SELECT is(
    (SELECT COUNT(*)::INTEGER FROM incidents.patron_ban WHERE patron = 9300),
    2,
    'Both bans now belong to primary patron'
);

SELECT ok(
    NOT EXISTS (SELECT 1 FROM incidents.patron_ban WHERE patron = 9301),
    'No bans remain for secondary patron'
);

-- =============================================================================
-- TEST SUITE 5: Photos transferred and primary demoted
-- =============================================================================

SELECT is(
    (SELECT COUNT(*)::INTEGER FROM incidents.patron_photo WHERE patron = 9300),
    2,
    'Both photos now belong to primary patron'
);

-- Secondary's photo should have is_primary=false after demotion
SELECT is(
    (SELECT is_primary FROM incidents.patron_photo WHERE id = 9301),
    false,
    'Secondary primary photo demoted to non-primary'
);

-- Primary's original photo stays primary
SELECT is(
    (SELECT is_primary FROM incidents.patron_photo WHERE id = 9300),
    true,
    'Primary original photo still marked as primary'
);

-- =============================================================================
-- TEST SUITE 6: Notes transferred
-- =============================================================================

SELECT is(
    (SELECT COUNT(*)::INTEGER FROM incidents.patron_notes WHERE patron_id = 9300),
    2,
    'Both notes (active + deleted) re-pointed to primary'
);

SELECT ok(
    NOT EXISTS (SELECT 1 FROM incidents.patron_notes WHERE patron_id = 9301),
    'No notes remain for secondary patron'
);

-- =============================================================================
-- TEST SUITE 7: Timeline events transferred + merge event created
-- =============================================================================

-- Original timeline event moved to primary
SELECT is(
    (SELECT patron_id FROM incidents.patron_timeline_events WHERE id = 9300),
    9300,
    'Secondary timeline event transferred to primary'
);

-- Merge event created on primary
SELECT ok(
    EXISTS (
        SELECT 1 FROM incidents.patron_timeline_events
        WHERE patron_id = 9300
          AND event_type = 'patron_merged'
          AND (event_data->>'merged_patron_id')::INTEGER = 9301
    ),
    'patron_merged timeline event created on primary'
);

SELECT is(
    (SELECT event_data->>'merged_patron_name'
     FROM incidents.patron_timeline_events
     WHERE patron_id = 9300 AND event_type = 'patron_merged'),
    'Bob Secondary',
    'Merge event records secondary patron name'
);

SELECT is(
    (SELECT created_by FROM incidents.patron_timeline_events
     WHERE patron_id = 9300 AND event_type = 'patron_merged'),
    'a0000000-0000-4000-a000-000000009300'::uuid,
    'Merge event created_by matches the staff who merged'
);

-- =============================================================================
-- TEST SUITE 8: Secondary patron soft-deleted
-- =============================================================================

SELECT ok(
    (SELECT deleted_at IS NOT NULL FROM incidents.patrons WHERE id = 9301),
    'Secondary patron is soft-deleted after merge'
);

SELECT ok(
    (SELECT deleted_at IS NULL FROM incidents.patrons WHERE id = 9300),
    'Primary patron is NOT deleted after merge'
);

-- =============================================================================
-- TEST SUITE 9: Cannot merge into/from a now-deleted patron
-- =============================================================================

SELECT throws_ok(
    $$SELECT * FROM incidents.merge_patrons(9301, 9300, 'a0000000-0000-4000-a000-000000009300')$$,
    'Primary patron 9301 not found or deleted'
);

SELECT throws_ok(
    $$SELECT * FROM incidents.merge_patrons(9300, 9301, 'a0000000-0000-4000-a000-000000009300')$$,
    'Secondary patron 9301 not found or deleted'
);

-- =============================================================================
-- TEST SUITE 10: Self-merge guard
-- =============================================================================

SELECT throws_ok(
    $$SELECT * FROM incidents.merge_patrons(9300, 9300, 'a0000000-0000-4000-a000-000000009300')$$,
    'Cannot merge a patron with itself'
);

-- =============================================================================
-- TEST SUITE 11: Zero-data secondary (no incidents, bans, photos, notes)
-- =============================================================================

SELECT results_eq(
    $$SELECT incidents_transferred, photos_transferred, bans_transferred, notes_transferred
      FROM incidents.merge_patrons(9300, 9303, 'a0000000-0000-4000-a000-000000009300')$$,
    $$VALUES (0, 0, 0, 0)$$,
    'Merge with empty secondary returns all zeros'
);

SELECT ok(
    (SELECT deleted_at IS NOT NULL FROM incidents.patrons WHERE id = 9303),
    'Empty secondary is soft-deleted after merge'
);

SELECT * FROM finish();

ROLLBACK;
