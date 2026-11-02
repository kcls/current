-- Revert current:006_incident_links from pg

BEGIN;

DROP INDEX incidents.idx_incident_links_one_followup_source;

ALTER TABLE incidents.incident_links
    DROP CONSTRAINT incident_links_linked_incident_id_fkey;

COMMIT;
