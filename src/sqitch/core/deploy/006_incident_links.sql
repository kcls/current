-- Deploy current:006_incident_links to pg
-- requires: 005_ban_view_predicates

-- incident_links ships in the baseline but nothing wrote to it until
-- related / follow-up incidents. Direction: incident_id is the newer
-- incident, linked_incident_id the one it refers back to.
--
-- The baseline only had an FK on incident_id. A follow-up copies its
-- source's org unit, templates and parties, so it has exactly one source.

BEGIN;

ALTER TABLE incidents.incident_links
    ADD CONSTRAINT incident_links_linked_incident_id_fkey
    FOREIGN KEY (linked_incident_id) REFERENCES incidents.incidents(id);

CREATE UNIQUE INDEX idx_incident_links_one_followup_source
    ON incidents.incident_links (incident_id)
    WHERE link_type = 'followup';

COMMIT;
