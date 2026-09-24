-- Verify current:005_ban_view_predicates on pg

BEGIN;

DO $$
BEGIN
    IF pg_get_viewdef('incidents.active_patron_ban'::regclass) !~ 'lifts_at > now\(\)' THEN
        RAISE EXCEPTION 'active_patron_ban does not filter on lifts_at';
    END IF;

    IF pg_get_viewdef('incidents.visible_patron_ban'::regclass) ~ 'lifts_at > now\(\)' THEN
        RAISE EXCEPTION 'visible_patron_ban filters on lifts_at';
    END IF;
END $$;

ROLLBACK;
