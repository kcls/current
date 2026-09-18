import type { Page, BrowserContext } from '@playwright/test';
import { test, TEST_USERS, type TestUserRole } from '../../../fixtures';
import { LoginPage } from '../pages';

/**
 * Share ONE authenticated browser session across all tests in a spec file.
 *
 * Why not per-test login: every test logging in runs the multi-step
 * login -> select-location -> dashboard flow (~60x across the suite) — slow and
 * a big flake surface. Why not a saved storageState file: odo-auth ROTATES the
 * refresh token on each session restore, so replaying one saved cookie into
 * fresh contexts fails after the first test (the cookie is single-use).
 *
 * A live, shared context sidesteps both: it logs in once per file, and rotation
 * is handled naturally because the same context receives each new refresh
 * cookie (exactly like a real browser session).
 *
 * Requirements: the describe block runs serially (tests share one page). Call
 * inside a `test.describe`, then use `session.page` in tests. Each test should
 * navigate to its own starting point (the page is shared, so state carries over).
 *
 * ```ts
 * test.describe('Incident Search', () => {
 *   const session = useAuthedPage('staff');
 *   test.beforeEach(async () => {
 *     await new IncidentListPage(session.page).goto();
 *   });
 *   test('...', async () => { ... session.page ... });
 * });
 * ```
 */
export function useAuthedPage(role: TestUserRole = 'staff'): { page: Page } {
  // Tests in the file share one page, so they must not run concurrently.
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    const user = TEST_USERS[role];
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(user.username, user.password);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // A getter so callers always read the current shared page (assigned in
  // beforeAll, after this function returns).
  return {
    get page() {
      return page;
    },
  };
}
