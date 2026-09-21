-- Verify current:004_shift_note_occurred_at on pg

BEGIN;

DO $$
BEGIN
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema='incidents' AND table_name='shift_note'
           AND column_name='occurred_at') <> 'timestamp with time zone' THEN
        RAISE EXCEPTION 'shift_note.occurred_at missing or not timestamptz';
    END IF;

    IF (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema='incidents' AND table_name='shift_note'
           AND column_name='occurred_at') <> 'NO' THEN
        RAISE EXCEPTION 'shift_note.occurred_at is nullable';
    END IF;

    -- A default matters: inserts that predate this column must still work.
    IF (SELECT column_default FROM information_schema.columns
         WHERE table_schema='incidents' AND table_name='shift_note'
           AND column_name='occurred_at') IS NULL THEN
        RAISE EXCEPTION 'shift_note.occurred_at has no default';
    END IF;

    -- The backfill left nothing behind.
    IF EXISTS (SELECT 1 FROM incidents.shift_note WHERE occurred_at IS NULL) THEN
        RAISE EXCEPTION 'shift_note.occurred_at not fully backfilled';
    END IF;

    IF to_regclass('incidents.idx_shift_note_occurred') IS NULL
       OR to_regclass('incidents.idx_shift_note_org_unit_occurred') IS NULL THEN
        RAISE EXCEPTION 'shift_note occurred_at indexes missing';
    END IF;
END $$;

ROLLBACK;
