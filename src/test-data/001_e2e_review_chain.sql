-- Two-level review chain at Main Street Branch (demo tree code MAIN) for
-- e2e/integration tests:
--   Level 1: e2e.current.manager - branch manager, first reviewer
--   Level 2: e2e.current.coord   - regional coordinator, final reviewer
-- e2e.odo.staff is NOT in the chain - they only create incidents.
--
-- Org units and users are referenced by their stable uuids (pinned by
-- the platform seed / fixtures.json); review groups carry pinned ids
-- (9102/9103) that tests reference. The companion authz grant
-- (e2e.current.coord -> incident-manager @ root) lives in fixtures.json.
--
-- Post-split: Current's database has no org schema, so MAIN's uuid is
-- the pinned platform-demo-seed literal rather than an org.unit lookup
-- (no existence check is possible here - deploy the platform seed first).
--
-- Idempotent: rebuilds the chain on every run.

BEGIN;

DO $$
DECLARE
  -- Main Street Branch (code MAIN), pinned by the platform demo seed.
  branch_uuid UUID := '5eed0000-0000-4000-a000-000000000204';
  manager_uuid UUID := 'e2e00000-0000-4000-a000-000000000202';
  coord_uuid   UUID := 'e2e00000-0000-4000-a000-000000000201';
BEGIN
  DELETE FROM incidents.review_chain WHERE org_unit = branch_uuid;

  -- Pinned ids (9102/9103): tests reference fixture groups by well-known id.
  INSERT INTO incidents.review_group (id, org_unit, name, description)
  VALUES (9102, branch_uuid, 'E2E Level 1 Reviewers', 'First-level reviewers (branch managers) for E2E tests')
  ON CONFLICT (id) DO UPDATE SET org_unit = EXCLUDED.org_unit;

  INSERT INTO incidents.review_group (id, org_unit, name, description)
  VALUES (9103, branch_uuid, 'E2E Level 2 Reviewers', 'Final reviewers (coordinators) for E2E tests')
  ON CONFLICT (id) DO UPDATE SET org_unit = EXCLUDED.org_unit;

  DELETE FROM incidents.review_group_member WHERE review_group IN (9102, 9103);

  INSERT INTO incidents.review_group_member (review_group, usr) VALUES
    (9102, manager_uuid),
    (9103, coord_uuid);

  INSERT INTO incidents.review_chain (org_unit, review_level, reviewer_group, is_final) VALUES
    (branch_uuid, 1, 9102, false),
    (branch_uuid, 2, 9103, true);
END $$;

COMMIT;
