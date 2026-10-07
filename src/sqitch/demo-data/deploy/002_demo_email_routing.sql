-- Deploy current-demo:002_demo_email_routing to pg
-- requires: 001_demo_sub_locations

-- Sample alert routing onto odo's demo email groups, so a demo install
-- actually enqueues ban, trespass and communication-log emails.
--
-- Both sides are odo demo data referenced by pinned uuid across the
-- database boundary: org units 5eed0000-...-02xx (odo-demo
-- 001_demo_org_tree) and email groups 5eed0000-...-03xx (odo-demo
-- 002_demo_email_groups). Nothing here checks they exist -- there is no
-- odo connection -- so deploy odo's demo data alongside this.
--
-- Routing matches the alert's exact org unit (or a NULL broadcast row),
-- so each branch gets its own rows, pointed at its region's group. The
-- security group gets every ban and trespass through a broadcast row.

BEGIN;

INSERT INTO incidents.notification_email_routing (template_code, incident_org_unit, email_group)
SELECT r.template_code, r.org_unit, r.email_group
  FROM (VALUES
    -- East Region branches -> East Region Staff; West -> West.
    ('shift-note-created', '5eed0000-0000-4000-a000-000000000204'::uuid, '5eed0000-0000-4000-a000-000000000301'::uuid),  -- Main Street
    ('shift-note-created', '5eed0000-0000-4000-a000-000000000205'::uuid, '5eed0000-0000-4000-a000-000000000301'::uuid),  -- Riverside
    ('shift-note-created', '5eed0000-0000-4000-a000-000000000206'::uuid, '5eed0000-0000-4000-a000-000000000302'::uuid),  -- Hilltop
    ('shift-note-created', '5eed0000-0000-4000-a000-000000000207'::uuid, '5eed0000-0000-4000-a000-000000000302'::uuid),  -- Lakeside
    ('patron-ban-created', '5eed0000-0000-4000-a000-000000000204'::uuid, '5eed0000-0000-4000-a000-000000000301'::uuid),
    ('patron-ban-created', '5eed0000-0000-4000-a000-000000000205'::uuid, '5eed0000-0000-4000-a000-000000000301'::uuid),
    ('patron-ban-created', '5eed0000-0000-4000-a000-000000000206'::uuid, '5eed0000-0000-4000-a000-000000000302'::uuid),
    ('patron-ban-created', '5eed0000-0000-4000-a000-000000000207'::uuid, '5eed0000-0000-4000-a000-000000000302'::uuid),
    ('patron-trespass-created', '5eed0000-0000-4000-a000-000000000204'::uuid, '5eed0000-0000-4000-a000-000000000301'::uuid),
    ('patron-trespass-created', '5eed0000-0000-4000-a000-000000000205'::uuid, '5eed0000-0000-4000-a000-000000000301'::uuid),
    ('patron-trespass-created', '5eed0000-0000-4000-a000-000000000206'::uuid, '5eed0000-0000-4000-a000-000000000302'::uuid),
    ('patron-trespass-created', '5eed0000-0000-4000-a000-000000000207'::uuid, '5eed0000-0000-4000-a000-000000000302'::uuid),
    -- Broadcast: security hears about every ban and trespass.
    ('patron-ban-created',      NULL::uuid, '5eed0000-0000-4000-a000-000000000303'::uuid),
    ('patron-trespass-created', NULL::uuid, '5eed0000-0000-4000-a000-000000000303'::uuid)
  ) AS r (template_code, org_unit, email_group)
 -- Not ON CONFLICT: the unique index treats NULL org units as distinct,
 -- so it would let a re-run duplicate the broadcast rows.
 WHERE NOT EXISTS (
    SELECT 1 FROM incidents.notification_email_routing x
     WHERE x.template_code = r.template_code
       AND x.email_group = r.email_group
       AND x.incident_org_unit IS NOT DISTINCT FROM r.org_unit
 );

COMMIT;
