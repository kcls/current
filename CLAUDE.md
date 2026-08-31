# Current — guidance for Claude

Current is an incident tracker for community libraries, built on the Odo
platform (kcls/odo). It runs against **its own database** (the
`incidents` schema only) and reaches everything else — auth, org
structure, users, files, notifications — through the odo HTTP APIs. It
is the reference implementation for Odo applications.

## Developer Preferences

- Do not add 'Co-authored-by' metadata to commit messages.
- Author all git commits as the human user.

## Layout

- `src/rust/current/` — the API service. `odo-client` and `odo-service`
  are **git dependencies** on the odo repo (see Gotchas for the pin
  dance). Handlers per domain (incidents, patrons, bans, review, reports,
  templates, sub_locations); SeaORM entities in `src/entity/`.
- `src/ui/incident-tracker/` — React/Vite SPA (served at
  `/incident-tracker`); vendors its own copy of the core UI lib under
  `src/core/`.
- `src/sqitch/current/` — sqitch project: 001 incidents baseline
  (self-contained snapshot) + 002 reference seed (incident templates,
  categories, link types, age ranges, sub-locations, ban letters).
- `src/odo-registration/` — `manifest.json`: everything Current installs
  into the odo platform (permissions, incident-* roles, grants,
  notification templates, asset directories, SAML attr→role maps).
  Applied by `scripts/odo-register.sh` (installs the `odo-register` tool
  from the odo git origin into gitignored `.tools/` on first use).
- `src/test-data/` — e2e fixtures: `fixtures.json` (users with
  passwords + role assignments, applied via odo-register) and review-chain
  SQL against Current's database, all applied by
  `scripts/deploy-test-data.sh`.
- `src/integration-tests/` (the `current_mod` suite), `src/e2e/`
  (Playwright, `current` project), `src/db-tests/` (pgTAP).
- `k8s/` — each service directory owns its manifests: `current/` has
  the API routes + `current-jwt-auth` SecurityPolicy (routes.yaml),
  `ui-incident-tracker/` has the SPA's route. Path prefixes claimed:
  `/api/v1/current`, `/incident-tracker` (registry lives in the odo
  repo's README). HTTPRoutes live in the gateway's namespace
  (`default`); the workloads live in `odo-pub`.
- `openapi/current.json` — committed spec (`--dump-openapi` on the
  service binary regenerates it).

## Build / deploy / test (dev k3s cluster)

- `cargo check` from `src/rust/current/`.
- `./scripts/build-and-deploy-service.sh <name>` (`current`,
  `ui-incident-tracker`, or `--all`). Wait ~20s after a deploy.
- `./scripts/run-tests.sh --db --integration --e2e --unit` — DB
  connection resolves from the `current-api` secret's single
  `DATABASE_URL`; PG* env vars are overrides only.
- e2e locally: `cd src/e2e && BASE_URL=http://localhost:30080 npm test`.
- UI checks: `npx tsc --noEmit` and `npx vitest run` must both be fully
  clean. The UIs need a recent Node (>= 20).
- Fresh install order: create the `current` role and an empty database it
  owns on the PostgreSQL server by hand (Current does not own the server
  and no script creates them) → `manage-database.sh deploy` →
  `scripts/odo-register.sh src/odo-registration/manifest.json` →
  `scripts/deploy-test-data.sh`. All idempotent; re-running is always
  safe. (See the README for the full sequence.)

## Conventions that matter

- **Cross-database references are stable uuids, never odo integer ids.**
  Every column/field referencing odo-owned data (org units, users,
  files, email groups) is a uuid; labels/names are resolved through the
  odo APIs at runtime (batched lookups, best-effort decoration). The JWT
  `org_unit` claim is the working org unit's uuid. `template_code` is a
  natural key. Current's own tables keep integer primary keys.
- Tests never hard-code database ids: org units resolve by tree code
  (root `OLS`, branch-with-review-chain `MAIN`, no-chain branch `HILL`),
  users by pinned uuid (`e2e00000-…`). Current owns ALL of its test
  users — `…-0201` e2e.current.coord / `…-0202` e2e.current.manager / `…-0203`
  e2e.current.admin / `…-0204` e2e.current.staff, defined in
  `src/test-data/fixtures.json` — and grants nothing on the platform's
  `e2e.*` users, so the odo and current suites never interact.
- Anything Current needs installed in the platform goes in the
  registration manifest — never direct SQL against the odo database.
  Current has no odo-database connection at all; test-user passwords are
  set through `user/create` in `fixtures.json` (8-char minimum, hence
  `test123!`).
- Soft deletes only (`deleted_at`); a DB trigger blocks hard deletes.

## Gotchas

- **Git-dep pin dance**: `Cargo.lock` pins an exact odo rev. After odo
  changes land on `main` at github.com/kcls/odo, run here:
  `cargo update -p odo-client -p odo-service` and commit the lock.
- Docker/BuildKit can serve stale cargo caches (phantom old code in
  deployed binaries): `docker builder prune --force --filter
  type=exec.cachemount`, then rebuild.
- 1–2 random e2e failures per run can happen; rerun before treating a
  failure as a regression.
- After `kubectl apply` of a changed deployment, verify the change
  actually landed (`kubectl get deploy … -o yaml`) — a rolling update
  can leave an old pod serving while a new one crashloops, making stale
  config look healthy. Prefer expressing operational changes as git
  edits and handing `kubectl` commands to the user.
