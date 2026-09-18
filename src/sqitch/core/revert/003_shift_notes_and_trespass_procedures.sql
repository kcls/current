-- Revert current:003_shift_notes_and_trespass_procedures from pg

BEGIN;

-- patron_search_summary goes back to the baseline definition, where the
-- trespass aggregates and the activity CTE are both gated on lifts_at.
CREATE OR REPLACE VIEW incidents.patron_search_summary AS
WITH activity AS (
    SELECT ip.patron_id AS patron, ii.org_unit
      FROM incidents.involved_parties ip
      JOIN incidents.incidents ii
        ON ii.id = ip.incident_id
       AND ii.deleted_at IS NULL
     WHERE ip.patron_id IS NOT NULL
    UNION
    SELECT vpb.patron, vpb.org_unit
      FROM incidents.visible_patron_ban vpb
     WHERE vpb.lifts_at > NOW()
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

    (
        SELECT COUNT(*)
          FROM incidents.visible_patron_ban vpb
         WHERE vpb.patron = a.patron
           AND vpb.is_trespass = true
           AND vpb.lifts_at > NOW()
    ) AS active_trespass_count,
    (
        SELECT MIN(vpb.lifts_at)
          FROM incidents.visible_patron_ban vpb
         WHERE vpb.patron = a.patron
           AND vpb.is_trespass = true
           AND vpb.lifts_at > NOW()
    ) AS trespass_min_lifts_at,
    (
        SELECT MAX(vpb.lifts_at)
          FROM incidents.visible_patron_ban vpb
         WHERE vpb.patron = a.patron
           AND vpb.is_trespass = true
           AND vpb.lifts_at > NOW()
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

ALTER TABLE incidents.patron_ban DROP COLUMN IF EXISTS trespass_procedures;

DROP TABLE IF EXISTS incidents.trespass_procedure_item;
DROP TABLE IF EXISTS incidents.shift_note_attachment;
DROP TABLE IF EXISTS incidents.shift_note_conduct_area;
DROP TABLE IF EXISTS incidents.shift_note;
DROP TABLE IF EXISTS incidents.config_shift_note_setting;
DROP TABLE IF EXISTS incidents.config_shift_note_type;
DROP TABLE IF EXISTS incidents.config_shift_note_conduct_area;

-- pg_trgm is left installed: dropping an extension another change might
-- rely on is riskier than leaving it.

COMMIT;
