-- Deploy current:004_shift_note_occurred_at to pg
-- requires: 003_shift_notes_and_trespass_procedures

-- When the thing being recorded actually happened, as distinct from when
-- someone got round to writing it down.
--
-- Shift notes are filed at the end of a shift as often as during it, so
-- created_at routinely lags the event by hours. Incidents already draw
-- this distinction (incidents.occurred_at, in the baseline); the
-- Communication Log now does too, and sorts and filters on it.
--
-- Backfilled from created_at: historical occurrence time was never
-- captured, and "when it was written down" is the best approximation
-- available for existing rows.

BEGIN;

ALTER TABLE incidents.shift_note
    ADD COLUMN occurred_at TIMESTAMPTZ;

UPDATE incidents.shift_note
   SET occurred_at = created_at
 WHERE occurred_at IS NULL;

ALTER TABLE incidents.shift_note
    ALTER COLUMN occurred_at SET NOT NULL,
    ALTER COLUMN occurred_at SET DEFAULT CURRENT_TIMESTAMP;

-- The list query's default ordering moves to occurred_at, so it needs the
-- same index shape created_at has. Partial on deleted_at IS NULL, matching
-- every other shift_note index: the list never reads soft-deleted rows.
CREATE INDEX idx_shift_note_occurred
    ON incidents.shift_note (occurred_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_shift_note_org_unit_occurred
    ON incidents.shift_note (org_unit, occurred_at DESC)
    WHERE deleted_at IS NULL;

COMMIT;
