-- Revert current:007_config_global_setting from pg

BEGIN;

DROP TABLE incidents.config_global_setting;

COMMIT;
