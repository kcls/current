-- Verify current:003_shift_notes_and_trespass_procedures on pg

BEGIN;

DO $$
BEGIN
    -- Tables.
    IF to_regclass('incidents.shift_note') IS NULL
       OR to_regclass('incidents.shift_note_conduct_area') IS NULL
       OR to_regclass('incidents.shift_note_attachment') IS NULL
       OR to_regclass('incidents.config_shift_note_type') IS NULL
       OR to_regclass('incidents.config_shift_note_conduct_area') IS NULL
       OR to_regclass('incidents.config_shift_note_setting') IS NULL
       OR to_regclass('incidents.trespass_procedure_item') IS NULL THEN
        RAISE EXCEPTION 'shift-note / trespass-procedure tables missing';
    END IF;

    -- Odo references are uuids, not integer ids: this database cannot
    -- resolve odo's primary keys.
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema='incidents' AND table_name='shift_note'
           AND column_name='org_unit') <> 'uuid' THEN
        RAISE EXCEPTION 'shift_note.org_unit is not uuid';
    END IF;
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema='incidents' AND table_name='shift_note'
           AND column_name='created_by') <> 'uuid' THEN
        RAISE EXCEPTION 'shift_note.created_by is not uuid';
    END IF;
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema='incidents' AND table_name='shift_note_attachment'
           AND column_name='file_upload') <> 'uuid' THEN
        RAISE EXCEPTION 'shift_note_attachment.file_upload is not uuid';
    END IF;

    -- No cross-schema FK may creep in: this schema stands alone.
    IF EXISTS (
        SELECT 1 FROM pg_constraint con
          JOIN pg_class cl ON cl.oid = con.confrelid
         WHERE con.contype = 'f'
           AND con.connamespace = 'incidents'::regnamespace
           AND cl.relnamespace <> 'incidents'::regnamespace
    ) THEN
        RAISE EXCEPTION 'cross-schema FK on incidents.*';
    END IF;

    -- The frozen per-trespass snapshot.
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema='incidents' AND table_name='patron_ban'
           AND column_name='trespass_procedures') <> 'jsonb' THEN
        RAISE EXCEPTION 'patron_ban.trespass_procedures missing or not jsonb';
    END IF;

    -- Reference data seeded.
    IF (SELECT COUNT(*) FROM incidents.config_shift_note_type) = 0
       OR (SELECT COUNT(*) FROM incidents.config_shift_note_conduct_area) = 0
       OR (SELECT COUNT(*) FROM incidents.trespass_procedure_item) = 0 THEN
        RAISE EXCEPTION 'shift-note / trespass reference data not seeded';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM incidents.config_shift_note_setting WHERE id = 1) THEN
        RAISE EXCEPTION 'retention setting row missing';
    END IF;

    -- A trespass counts until archived, not until it lifts.
    IF pg_get_viewdef('incidents.patron_search_summary'::regclass, true)
       ~ 'is_trespass = true AND vpb\.lifts_at > now\(\)' THEN
        RAISE EXCEPTION 'patron_search_summary gates trespass aggregates on lifts_at';
    END IF;
    IF pg_get_viewdef('incidents.patron_search_summary'::regclass, true)
       !~ 'OR vpb\.is_trespass' THEN
        RAISE EXCEPTION 'patron_search_summary activity CTE lost its trespass arm';
    END IF;
END $$;

ROLLBACK;
