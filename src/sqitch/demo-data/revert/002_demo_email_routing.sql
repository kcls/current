-- Revert current-demo:002_demo_email_routing from pg
--
-- Deletes every routing row that targets one of odo's demo email groups
-- (5eed0000-...-03xx). Rows an installation added for its own groups are
-- untouched.

BEGIN;

DELETE FROM incidents.notification_email_routing WHERE email_group IN (
    '5eed0000-0000-4000-a000-000000000301',  -- East Region Staff
    '5eed0000-0000-4000-a000-000000000302',  -- West Region Staff
    '5eed0000-0000-4000-a000-000000000303'   -- Security Team
);

COMMIT;
