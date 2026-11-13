-- Verify current:006_incident_links on pg

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'incident_links_linked_incident_id_fkey') THEN
        RAISE EXCEPTION 'incident_links.linked_incident_id has no FK';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE schemaname = 'incidents'
                      AND indexname = 'idx_incident_links_one_followup_source') THEN
        RAISE EXCEPTION 'idx_incident_links_one_followup_source missing';
    END IF;
END $$;

ROLLBACK;
