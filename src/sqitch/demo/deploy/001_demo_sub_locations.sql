-- Deploy current-demo:001_demo_sub_locations to pg
-- requires: current:002_current_seed

-- Sample sub-locations, all on the platform's demo root org unit.
--
-- Sub-locations name places inside a building -- Lobby, Elevator,
-- Parking Lot -- so each belongs to a particular org unit. That makes
-- them installation data, not reference data: a real install names its
-- own, against its own units. This set exists so a demo install, the
-- e2e suites and a new developer's checkout have something to pick from.
--
-- The org unit is odo's demo root, referenced by its pinned uuid across
-- the database boundary (5eed0000-...-0201). An install that deployed a
-- different root does not want these rows at all -- which is the point
-- of them living here rather than in the seed.

BEGIN;

INSERT INTO incidents.sub_locations (id, label, description, code, org_unit) VALUES
    (58, $q$Meeting or Study Room$q$, $q$Meeting rooms and study spaces$q$, $q$OLS-MSR$q$, '5eed0000-0000-4000-a000-000000000201'),
    (59, $q$Parking Lot or Garage$q$, $q$Parking areas and garages$q$, $q$OLS-PLG$q$, '5eed0000-0000-4000-a000-000000000201'),
    (60, $q$Lobby$q$, $q$Main entrance and lobby area$q$, $q$OLS-LOB$q$, '5eed0000-0000-4000-a000-000000000201'),
    (61, $q$Outside$q$, $q$Outdoor areas around the building$q$, $q$OLS-OUT$q$, '5eed0000-0000-4000-a000-000000000201'),
    (62, $q$Elevator$q$, $q$Elevator areas$q$, $q$OLS-ELE$q$, '5eed0000-0000-4000-a000-000000000201'),
    (63, $q$Restrooms$q$, $q$Public restrooms$q$, $q$OLS-RES$q$, '5eed0000-0000-4000-a000-000000000201'),
    (64, $q$Makerspace$q$, $q$Creative and technology workspace$q$, $q$OLS-MAK$q$, '5eed0000-0000-4000-a000-000000000201')
ON CONFLICT (id) DO UPDATE SET
    label = EXCLUDED.label, description = EXCLUDED.description, code = EXCLUDED.code;
SELECT setval('incidents.sub_locations_id_seq', GREATEST((SELECT MAX(id) FROM incidents.sub_locations), 1));

COMMIT;
