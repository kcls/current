import { test, expect } from '../../../../fixtures';
import { DashboardPage } from '../../pages';
import { useAuthedPage } from '../../support/authed-page';

test.describe('Dashboard Table State', () => {
  // One authenticated staff session shared across this file (serial). Avoids a
  // per-test login and the refresh-token-rotation issue of saved storage state.
  const session = useAuthedPage('staff');

  test.beforeEach(async () => {
    await new DashboardPage(session.page).goto();
  });

  test('should persist rows per page when navigating away and back', async () => {
    const dashboard = new DashboardPage(session.page);
    await dashboard.expectLoaded();

    // Skip if no pagination (no data in table)
    const hasPagination = await dashboard.rowsPerPageSelect.isVisible().catch(() => false);
    test.skip(!hasPagination, 'No pagination available - table has no data');

    // Change rows per page to 25
    await dashboard.setRowsPerPage(25);
    await dashboard.expectRowsPerPage(25);

    // Open drawer and navigate to Incidents (client-side navigation)
    await session.page.getByRole('button', { name: 'menu' }).click();
    await session.page.getByRole('link', { name: /incidents/i }).click();
    await expect(session.page).toHaveURL(/\/incidents/);

    // Open drawer and navigate back to dashboard
    await session.page.getByRole('button', { name: 'menu' }).click();
    await session.page.getByRole('link', { name: /dashboard/i }).click();
    await dashboard.expectLoaded();

    // Rows per page should still be 25
    await dashboard.expectRowsPerPage(25);
  });

  test('should persist rows per page across multiple page navigations', async () => {
    const dashboard = new DashboardPage(session.page);
    await dashboard.expectLoaded();

    // Skip if no pagination (no data in table)
    const hasPagination = await dashboard.rowsPerPageSelect.isVisible().catch(() => false);
    test.skip(!hasPagination, 'No pagination available - table has no data');

    // Change rows per page to 25
    await dashboard.setRowsPerPage(25);
    await dashboard.expectRowsPerPage(25);

    // Open drawer and navigate to Incidents
    await session.page.getByRole('button', { name: 'menu' }).click();
    await session.page.getByRole('link', { name: /incidents/i }).click();
    await expect(session.page).toHaveURL(/\/incidents/);

    // Open drawer and navigate back to dashboard
    await session.page.getByRole('button', { name: 'menu' }).click();
    await session.page.getByRole('link', { name: /dashboard/i }).click();
    await dashboard.expectLoaded();

    // Rows per page should still be 25
    await dashboard.expectRowsPerPage(25);
  });

  test('should persist rows per page on page refresh', async () => {
    const dashboard = new DashboardPage(session.page);
    await dashboard.expectLoaded();

    // Skip if no pagination (no data in table)
    const hasPagination = await dashboard.rowsPerPageSelect.isVisible().catch(() => false);
    test.skip(!hasPagination, 'No pagination available - table has no data');

    // Change rows per page to 25
    await dashboard.setRowsPerPage(25);
    await dashboard.expectRowsPerPage(25);

    // Refresh the page
    await session.page.reload();

    // Wait for dashboard to load again
    await dashboard.expectLoaded();

    // Rows per page should persist (stored in localStorage)
    await dashboard.expectRowsPerPage(25);
  });

  test('Active Trespasses and Active Bans should share rows per page state', async () => {
    const dashboard = new DashboardPage(session.page);
    await dashboard.expectLoaded();

    // Skip if no pagination (no data in table)
    const hasPagination = await dashboard.rowsPerPageSelect.isVisible().catch(() => false);
    test.skip(!hasPagination, 'No pagination available - table has no data');

    // Set Active Trespasses rows per page to 25
    await dashboard.activeTrespassesTab.click();
    await dashboard.setRowsPerPage(25);

    // Switch to Active Bans tab - should also be 25 (shared state)
    await dashboard.activeBansTab.click();
    await session.page.waitForTimeout(500);
    await expect(dashboard.rowsPerPageSelect).toHaveText('25');

    // Change rows per page on Bans tab to 5
    await dashboard.rowsPerPageSelect.click();
    await session.page.getByRole('option', { name: '5', exact: true }).click();

    // Switch back to Trespasses - should also be 5 (shared state)
    await dashboard.activeTrespassesTab.click();
    await session.page.waitForTimeout(500);
    await dashboard.expectRowsPerPage(5);
  });
});
