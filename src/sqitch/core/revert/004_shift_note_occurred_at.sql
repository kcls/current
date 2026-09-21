-- Revert current:004_shift_note_occurred_at from pg

BEGIN;

-- Dropping the column takes its indexes with it.
ALTER TABLE incidents.shift_note
    DROP COLUMN IF EXISTS occurred_at;

COMMIT;
