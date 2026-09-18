-- Revert current:002_current_seed from pg

-- Data-only change; reverting truncates the reference tables (and, via
-- CASCADE, anything referencing them - dev-only semantics).

BEGIN;

TRUNCATE TABLE incidents.templates, incidents.categories,
    incidents.external_link_type, incidents.patron_age_range,
    incidents.sub_locations, incidents.ban_letter_template
    RESTART IDENTITY CASCADE;

COMMIT;
