-- Deploy current:007_config_global_setting to pg
-- requires: 006_incident_links

-- Site-wide settings, one row per named setting. The value is JSON so a
-- setting can be a string, number or object without a column per
-- setting; the service validates each value behind a typed accessor and
-- falls back to the seeded default when a row is missing or unreadable.

BEGIN;

CREATE TABLE incidents.config_global_setting (
    name        TEXT        PRIMARY KEY,
    value       JSONB       NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- auth.usr uuid (cross-database reference).
    updated_by  UUID
);

INSERT INTO incidents.config_global_setting (name, value, description) VALUES
    ('incident.move.review_mode', '"first_level"',
     'What happens to an in-review incident moved to another location. '
     'first_level: resubmitted at level 1 of the new location''s review '
     'chain (draft when it has none). return_to_draft: returned to the '
     'reporter to resubmit.');

COMMIT;
