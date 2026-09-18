import { test as base } from '@playwright/test';
import { TEST_USERS, TestUser } from './test-users';

/**
 * Extended test fixtures exposing the seeded test-user credentials.
 *
 * There is no saved-storageState/pre-authenticated-page machinery: odo-auth
 * rotates the refresh token on each session restore, so a single saved cookie
 * can't be replayed across tests. Tests authenticate via a shared live session
 * per file instead — see apps/incident-tracker/support/authed-page.ts.
 */
type AuthFixtures = {
  staffUser: TestUser;
  coordinatorUser: TestUser;
  managerUser: TestUser;
  adminUser: TestUser;
};

export const test = base.extend<AuthFixtures>({
  staffUser: async ({}, use) => {
    await use(TEST_USERS.staff);
  },
  coordinatorUser: async ({}, use) => {
    await use(TEST_USERS.coordinator);
  },
  managerUser: async ({}, use) => {
    await use(TEST_USERS.manager);
  },
  adminUser: async ({}, use) => {
    await use(TEST_USERS.admin);
  },
});

export { expect } from '@playwright/test';
export { TEST_USERS } from './test-users';
export type { TestUser, TestUserRole } from './test-users';
