/**
 * E2E Test user credentials and configuration
 *
 * These users are created by sqitch/test-data/016_e2e_test_passwords migration.
 * All test users are local (password 'test123!'). SSO/SAML is not exercised in
 * e2e (it would require a live third-party IdP; MockSAML tests were removed).
 *
 * Setup: Run `./scripts/manage-database.sh deploy-test` to deploy test data.
 *
 * Valid incident-tracker roles (from docs/incident-roles.md):
 * - incident-staff: Dashboard, create/view incidents, Reviews page
 * - incident-coordinator: Operations center, patron management, bans, templates
 * - incident-manager: Reports, sub-locations, review process config
 * - incident-admin: Full access (super admin at root, or scoped to org_unit)
 * - incident-data: Read-only access to all data (analytics/reporting)
 */

export interface TestUser {
  username: string;
  password: string;
  roles: string[];
  displayName: string;
  orgUnit: string;
  authMethod: 'local' | 'saml';
}

/**
 * E2E test users for different role-based scenarios
 *
 * Local users (password: test123!):
 * - e2e.current.staff: incident-staff @ root (Odo Library System)
 * - e2e.current.coord: incident-coordinator, incident-staff @ root (Odo Library System)
 * - e2e.current.manager: incident-manager, incident-staff @ Main Street Branch
 * - e2e.current.admin: incident-admin @ root (Odo Library System)
 */
export const TEST_USERS = {
  /**
   * Staff user - can create incidents, view dashboard
   * Assigned incident-staff @ root (Odo Library System)
   */
  staff: {
    username: 'e2e.current.staff',
    password: 'test123!',
    roles: ['incident-staff'],
    displayName: 'E2E Staff',
    orgUnit: 'Odo Library System',
    authMethod: 'local',
  } as TestUser,

  /**
   * Coordinator user - can manage operations, patrons, bans
   * Assigned incident-coordinator and incident-staff @ root (Odo Library System)
   */
  coordinator: {
    username: 'e2e.current.coord',
    password: 'test123!',
    roles: ['incident-coordinator', 'incident-staff'],
    displayName: 'E2E Coordinator',
    orgUnit: 'Odo Library System',
    authMethod: 'local',
  } as TestUser,

  /**
   * Manager user - can manage settings, reports, review chains
   * Assigned incident-manager @ Main Street Branch, incident-staff @ root
   */
  manager: {
    username: 'e2e.current.manager',
    password: 'test123!',
    roles: ['incident-manager', 'incident-staff'],
    displayName: 'E2E Manager',
    orgUnit: 'Main Street Branch',
    authMethod: 'local',
  } as TestUser,

  /**
   * Admin user - full access to all features
   * Assigned incident-admin @ root (Odo Library System)
   */
  admin: {
    username: 'e2e.current.admin',
    password: 'test123!',
    roles: ['incident-admin'],
    displayName: 'E2E Admin',
    orgUnit: 'Odo Library System',
    authMethod: 'local',
  } as TestUser,
} as const;

export type TestUserRole = keyof typeof TEST_USERS;
