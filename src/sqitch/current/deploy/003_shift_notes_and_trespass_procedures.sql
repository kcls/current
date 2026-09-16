-- Deploy current:003_shift_notes_and_trespass_procedures to pg
-- requires: 002_current_seed

-- Two features that landed after the repo split.
--
-- Shift Notes (the "Communication Log"): a low-friction bulletin board
-- where staff record what happened during a shift so coworkers see it.
-- Distinct from incidents -- no review workflow, no patron record
-- required, seconds to file.
--
-- Retention is permission-gated rather than archived: rows are never
-- moved or flagged. The read path caps ordinary users at the most recent
-- N days (config_shift_note_setting.retention_days) and
-- current.shift_note.read_archived lifts the cap.
--
-- Trespass procedures: a configurable checklist a reviewer completes when
-- submitting a trespass, plus the frozen per-trespass snapshot of what
-- was checked (patron_ban.trespass_procedures). The snapshot is JSONB
-- rather than rows so the record of what staff attested to survives later
-- edits to the checklist.
--
-- Every odo reference here (org unit, user, uploaded file) is a stable
-- uuid, matching the rest of this schema: Current's database is separate
-- from odo's, so integer ids would not resolve.

BEGIN;

-- The shift-note free-text search uses trigram indexes. Odo's baseline
-- creates this extension in its own database; Current's database needs
-- its own copy. The deploying role must be allowed to CREATE EXTENSION,
-- or the extension must be pre-created.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- ---------------------------------------------------------------------------
-- Shift notes: configuration
-- ---------------------------------------------------------------------------

-- Code of Conduct checkbox areas. Same language as the trespass letters,
-- but intentionally a separate table from config_ban_reason: ban reasons
-- are legal text on a mailed letter, these are a staff-facing triage aid.
-- The two are allowed to drift.
--
-- Rows are deactivated, never deleted, so historical notes keep rendering.
CREATE TABLE incidents.config_shift_note_conduct_area (
    id            SERIAL       PRIMARY KEY,
    code          VARCHAR(64)  NOT NULL UNIQUE,
    label         TEXT         NOT NULL,
    display_order INTEGER      NOT NULL DEFAULT 0,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_shift_note_conduct_area_order
    ON incidents.config_shift_note_conduct_area (display_order)
    WHERE is_active;

-- Entry types. `color` is a UI chip hint, not semantics.
CREATE TABLE incidents.config_shift_note_type (
    id            SERIAL       PRIMARY KEY,
    code          VARCHAR(64)  NOT NULL UNIQUE,
    label         TEXT         NOT NULL,
    color         VARCHAR(32),
    display_order INTEGER      NOT NULL DEFAULT 0,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_shift_note_type_order
    ON incidents.config_shift_note_type (display_order)
    WHERE is_active;

-- Single-row settings table (id = 1 enforced by CHECK).
CREATE TABLE incidents.config_shift_note_setting (
    id             INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    retention_days INTEGER     NOT NULL DEFAULT 30 CHECK (retention_days > 0),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- auth.usr uuid (cross-database reference).
    updated_by     UUID
);

-- ---------------------------------------------------------------------------
-- Shift notes: entries
-- ---------------------------------------------------------------------------

CREATE TABLE incidents.shift_note (
    id                  SERIAL      PRIMARY KEY,

    -- Where it happened. org.unit uuid (cross-database reference).
    -- A note does NOT carry its own broadcast scope; readers query a
    -- subtree, defaulting to the user's region.
    org_unit            UUID        NOT NULL,

    type                INTEGER     NOT NULL
                            REFERENCES incidents.config_shift_note_type (id)
                            DEFERRABLE INITIALLY DEFERRED,

    -- Free text, not a patron record: a note often concerns someone with
    -- no account, and filing one must not require creating one.
    patron_name         TEXT,
    patron_description  TEXT,

    was_instructed      BOOLEAN     NOT NULL DEFAULT FALSE,
    was_warned          BOOLEAN     NOT NULL DEFAULT FALSE,
    notes               TEXT        NOT NULL,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,

    -- auth.usr uuids (cross-database references).
    created_by          UUID        NOT NULL,
    updated_by          UUID,
    deleted_by          UUID
);

-- The list query: scope by unit subtree, newest first, active only.
CREATE INDEX idx_shift_note_org_unit_created
    ON incidents.shift_note (org_unit, created_at DESC)
    WHERE deleted_at IS NULL;

-- The retention cutoff, and reads that span many units.
CREATE INDEX idx_shift_note_created
    ON incidents.shift_note (created_at DESC)
    WHERE deleted_at IS NULL;

-- Filter/sort by entry type within a scope.
CREATE INDEX idx_shift_note_type_created
    ON incidents.shift_note (type, created_at DESC)
    WHERE deleted_at IS NULL;

-- "My notes", and the own-note edit/delete check.
CREATE INDEX idx_shift_note_created_by
    ON incidents.shift_note (created_by, created_at DESC)
    WHERE deleted_at IS NULL;

-- Free-text search over the note body and the patron name.
CREATE INDEX idx_shift_note_notes_trgm
    ON incidents.shift_note USING gin (LOWER(notes) gin_trgm_ops)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_shift_note_patron_name_trgm
    ON incidents.shift_note USING gin (LOWER(patron_name) gin_trgm_ops)
    WHERE deleted_at IS NULL;

-- Which Code of Conduct areas a note touches.
CREATE TABLE incidents.shift_note_conduct_area (
    id           SERIAL  PRIMARY KEY,
    shift_note   INTEGER NOT NULL REFERENCES incidents.shift_note (id)
                     ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    conduct_area INTEGER NOT NULL
                     REFERENCES incidents.config_shift_note_conduct_area (id)
                     DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (shift_note, conduct_area)
);

CREATE INDEX idx_shift_note_conduct_area_note
    ON incidents.shift_note_conduct_area (shift_note);

-- Attachments. The file itself lives in odo-asset; this table only links
-- it to a note. The asset.current.* permissions already govern them, so
-- no new asset directory is needed.
CREATE TABLE incidents.shift_note_attachment (
    id          SERIAL  PRIMARY KEY,
    shift_note  INTEGER NOT NULL REFERENCES incidents.shift_note (id)
                    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    -- asset.file_upload uuid (cross-database reference).
    file_upload UUID    NOT NULL,
    UNIQUE (shift_note, file_upload)
);

CREATE INDEX idx_shift_note_attachment_note
    ON incidents.shift_note_attachment (shift_note);

CREATE INDEX idx_shift_note_attachment_file_upload
    ON incidents.shift_note_attachment (file_upload);

-- ---------------------------------------------------------------------------
-- Trespass procedures
-- ---------------------------------------------------------------------------

-- The configurable checklist. `account_dependent` items are waived when
-- the escape-hatch item ("patron has no account") is checked; at most one
-- active escape hatch is allowed.
CREATE TABLE incidents.trespass_procedure_item (
    id                SERIAL       PRIMARY KEY,
    code              VARCHAR(64)  NOT NULL UNIQUE,
    label             TEXT         NOT NULL,
    required          BOOLEAN      NOT NULL DEFAULT TRUE,
    account_dependent BOOLEAN      NOT NULL DEFAULT FALSE,
    is_escape_hatch   BOOLEAN      NOT NULL DEFAULT FALSE,
    display_order     INTEGER      NOT NULL DEFAULT 0,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- auth.usr uuids (cross-database references).
    created_by        UUID,
    updated_by        UUID
);

CREATE INDEX idx_trespass_procedure_active_order
    ON incidents.trespass_procedure_item (display_order)
    WHERE is_active;

CREATE UNIQUE INDEX uq_trespass_procedure_active_escape_hatch
    ON incidents.trespass_procedure_item (is_escape_hatch)
    WHERE is_escape_hatch AND is_active;

-- Frozen snapshot of what the reviewer attested to, per trespass. JSONB
-- rather than rows so the record survives later edits to the checklist.
ALTER TABLE incidents.patron_ban
    ADD COLUMN trespass_procedures JSONB;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

INSERT INTO incidents.config_shift_note_conduct_area (code, label, display_order) VALUES
    ('unsafe_disruptive',   'Unsafe or disruptive behavior',           1),
    ('property_misuse',     'Inappropriate use of library property',   2),
    ('illegal_activity',    'Illegal activity',                        3),
    ('staff_noncompliance', 'Noncompliance with staff direction',      4)
ON CONFLICT (code) DO NOTHING;

INSERT INTO incidents.config_shift_note_type (code, label, color, display_order) VALUES
    ('patron_behavior',    'Patron Behavior',    'amber', 1),
    ('reference_question', 'Reference Question', 'blue',  2),
    ('building_update',    'Building Update',    'green', 3)
ON CONFLICT (code) DO NOTHING;

INSERT INTO incidents.config_shift_note_setting (id, retention_days)
VALUES (1, 30)
ON CONFLICT (id) DO NOTHING;

-- The default checklist. Wording is generic: an install adapts these to
-- its own procedures and integrated library system.
INSERT INTO incidents.trespass_procedure_item
    (code, label, required, account_dependent, is_escape_hatch, display_order) VALUES
    ('police_letter_issued', 'System-wide trespass letter issued by police',
        TRUE,  FALSE, FALSE, 1),
    ('letter_mailed',        'System-wide trespass letter mailed to patron''s address (if available)',
        FALSE, FALSE, FALSE, 2),
    ('ils_alert_set',        'Alert message set on the patron''s library account',
        TRUE,  TRUE,  FALSE, 3),
    ('account_barred',       'Patron account marked as Barred',
        TRUE,  TRUE,  FALSE, 4),
    ('no_computer_access',   'No computer access',
        TRUE,  TRUE,  FALSE, 5),
    ('holds_cancelled',      'Holds cancelled',
        TRUE,  TRUE,  FALSE, 6),
    ('no_library_account',   'Patron does not have a library account',
        FALSE, FALSE, TRUE,  7)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- patron_search_summary: waiting-for-archive trespasses stay visible
-- ---------------------------------------------------------------------------
--
-- A trespass stays in force until a human archives it: past-lift-date
-- trespasses show as "Waiting for archive" in the UI and must keep
-- appearing in has_visible_trespass searches (the dashboard's Active
-- Trespasses table). The baseline definition applied `lifts_at > NOW()`
-- to the trespass aggregates AND to the activity CTE, so a
-- waiting-for-archive trespass dropped out of the gate, lost its
-- lift-date sort key, and -- when the patron had no other activity --
-- lost its view row entirely.
--
-- Ban aggregates are unchanged: non-trespass bans genuinely end at
-- lifts_at, so "active" is correct there.

CREATE OR REPLACE VIEW incidents.patron_search_summary AS
WITH activity AS (
    -- All (patron, org_unit) pairs from open incidents the patron
    -- is involved in.
    SELECT ip.patron_id AS patron, ii.org_unit
      FROM incidents.involved_parties ip
      JOIN incidents.incidents ii
        ON ii.id = ip.incident_id
       AND ii.deleted_at IS NULL
     WHERE ip.patron_id IS NOT NULL
    UNION
    -- Plus (patron, org_unit) pairs from non-archived bans that have
    -- not yet lifted -- and from ALL non-archived trespasses.
    SELECT vpb.patron, vpb.org_unit
      FROM incidents.visible_patron_ban vpb
     WHERE vpb.lifts_at > NOW()
        OR vpb.is_trespass
)
SELECT
    a.patron AS patron_id,
    a.org_unit,

    ip.library_card,
    ip.first_name,
    ip.middle_name,
    ip.last_name,
    ip.display_name,
    ip.email,
    ip.alias,
    ip.risk_level,
    ip.notes,
    ip.is_unknown,
    ip.deleted_at AS patron_deleted_at,

    (
        SELECT COUNT(DISTINCT ii.id)
          FROM incidents.involved_parties iip
          JOIN incidents.incidents ii
            ON ii.id = iip.incident_id
           AND ii.deleted_at IS NULL
         WHERE iip.patron_id = a.patron
           AND ii.org_unit = a.org_unit
    ) AS incident_count,
    (
        SELECT MAX(ii.occurred_at)
          FROM incidents.involved_parties iip
          JOIN incidents.incidents ii
            ON ii.id = iip.incident_id
           AND ii.deleted_at IS NULL
         WHERE iip.patron_id = a.patron
           AND ii.org_unit = a.org_unit
    ) AS last_incident_at,
    (
        SELECT MIN(ii.occurred_at)
          FROM incidents.involved_parties iip
          JOIN incidents.incidents ii
            ON ii.id = iip.incident_id
           AND ii.deleted_at IS NULL
         WHERE iip.patron_id = a.patron
           AND ii.org_unit = a.org_unit
    ) AS first_incident_at,

    -- Active (non-trespass) ban aggregates scoped to this org.
    (
        SELECT COUNT(*)
          FROM incidents.visible_patron_ban vpb
         WHERE vpb.patron = a.patron
           AND vpb.org_unit = a.org_unit
           AND vpb.is_trespass = false
           AND vpb.lifts_at > NOW()
    ) AS active_ban_count,
    (
        SELECT MIN(vpb.lifts_at)
          FROM incidents.visible_patron_ban vpb
         WHERE vpb.patron = a.patron
           AND vpb.org_unit = a.org_unit
           AND vpb.is_trespass = false
           AND vpb.lifts_at > NOW()
    ) AS ban_min_lifts_at,
    (
        SELECT MAX(vpb.lifts_at)
          FROM incidents.visible_patron_ban vpb
         WHERE vpb.patron = a.patron
           AND vpb.org_unit = a.org_unit
           AND vpb.is_trespass = false
           AND vpb.lifts_at > NOW()
    ) AS ban_max_lifts_at,

    -- Trespass aggregates are cross-location (a trespass at one branch is
    -- visible everywhere; per-org rows repeat the same values) and follow
    -- *visible* semantics: a trespass counts until archived, even past
    -- its lift date.
    (
        SELECT COUNT(*)
          FROM incidents.visible_patron_ban vpb
         WHERE vpb.patron = a.patron
           AND vpb.is_trespass = true
    ) AS active_trespass_count,
    (
        SELECT MIN(vpb.lifts_at)
          FROM incidents.visible_patron_ban vpb
         WHERE vpb.patron = a.patron
           AND vpb.is_trespass = true
    ) AS trespass_min_lifts_at,
    (
        SELECT MAX(vpb.lifts_at)
          FROM incidents.visible_patron_ban vpb
         WHERE vpb.patron = a.patron
           AND vpb.is_trespass = true
    ) AS trespass_max_lifts_at,

    (
        SELECT ipp.file_upload
          FROM incidents.patron_photo ipp
         WHERE ipp.patron = a.patron
           AND ipp.is_primary = true
         LIMIT 1
    ) AS primary_photo_file_upload

  FROM activity a
  JOIN incidents.patrons ip ON ip.id = a.patron
 WHERE ip.deleted_at IS NULL;

COMMIT;
