import type { Page } from '@playwright/test';
import { test, expect } from '../../../../fixtures';
import { DashboardPage, IncidentDetailPage, IncidentListPage } from '../../pages';
import { useAuthedPage } from '../../support/authed-page';

/**
 * incident-data (read-only analyst) smoke tests.
 *
 * The analyst shares the staff pages, but each write control is shown only
 * when the server says the user holds the matching write permission
 * (usePerm). Those checks are asynchronous, so a "control is absent"
 * assertion made before they answer would pass for the wrong reason: every
 * absence check below first waits for the permission responses.
 */

const APP = '/incident-tracker';

/** Start waiting for `count` permission checks before the action that triggers them. */
function permChecks(page: Page, count = 1): Promise<unknown> {
  let seen = 0;
  return page.waitForResponse((r) => {
    if (r.url().includes('/authz/user-has-perm')) seen += 1;
    return seen >= count;
  });
}

test.describe('Data analyst (incident-data)', () => {
  const session = useAuthedPage('data');

  test('dashboard loads without the New Incident button', async () => {
    const page = session.page;
    const checked = permChecks(page);
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await checked;

    // Not expectLoaded(): that requires the New Incident button.
    await expect(dashboard.welcomeHeading).toBeVisible();
    await expect(dashboard.createIncidentButton).toHaveCount(0);
  });

  test('menu offers the read pages and Reports, not Notifications', async () => {
    const page = session.page;
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.welcomeHeading).toBeVisible();

    // The menu is a temporary drawer opened from the header.
    await dashboard.headerMenuButton.click();
    const drawer = page.locator('.MuiDrawer-paper');
    for (const name of ['Dashboard', 'Incidents', 'Reviews', 'Patrons', 'Communication Log', 'Reports']) {
      await expect(drawer.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(drawer.getByRole('link', { name: 'Notifications', exact: true })).toHaveCount(0);
    await expect(drawer.getByRole('link', { name: 'Review Process', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('incident list loads without the New Incident button', async () => {
    const page = session.page;
    const checked = permChecks(page);
    const list = new IncidentListPage(page);
    await list.goto();
    await checked;

    await list.expectLoaded();
    await expect(list.newIncidentButton).toHaveCount(0);
  });

  test('incident detail is viewable with no write controls', async () => {
    const page = session.page;
    const list = new IncidentListPage(page);
    await list.goto();
    test.skip((await list.getIncidentCount()) === 0, 'no incidents to open');

    // follow-up, related incident and create-ban checks
    const checked = permChecks(page, 3);
    await list.clickIncident(0);
    const detail = new IncidentDetailPage(page);
    await detail.waitForReady();
    await checked;

    // A read-only control proves the toolbar rendered.
    await expect(page.getByRole('button', { name: 'Print incident report' })).toBeVisible();
    for (const name of ['Create follow-up incident', 'Create related incident', 'Create ban / trespass']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(page.locator(`a[href$="/edit"]`)).toHaveCount(0);
  });

  test('communication log loads without the New Entry button', async () => {
    const page = session.page;
    const checked = permChecks(page);
    await page.goto(`${APP}/shift-notes`);
    await expect(page.getByRole('heading', { name: 'Communication Log' })).toBeVisible();
    await checked;

    await expect(page.getByRole('button', { name: 'New Entry' })).toHaveCount(0);
  });

  test('reports page is reachable', async () => {
    const page = session.page;
    await page.goto(`${APP}/reports`);

    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByText('Access Denied')).toHaveCount(0);
  });

  test('staff-only create page redirects home', async () => {
    const page = session.page;
    await page.goto(`${APP}/incidents/new`);

    await expect(page).not.toHaveURL(/\/incidents\/new/);
    await expect(new DashboardPage(page).welcomeHeading).toBeVisible();
  });
});
