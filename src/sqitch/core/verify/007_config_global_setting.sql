-- Verify current:007_config_global_setting on pg

BEGIN;

SELECT name, value, description, updated_at, updated_by
  FROM incidents.config_global_setting
 WHERE FALSE;

ROLLBACK;
