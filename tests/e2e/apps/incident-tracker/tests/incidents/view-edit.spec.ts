import { test, expect } from '../../../../fixtures';
import { LoginPage, IncidentListPage, IncidentFormPage } from '../../pages';
import { useAuthedPage } from '../../support/authed-page';

test.describe('Incident View and Edit', () => {
  // One authenticated staff session shared across this file (serial). Avoids a
  // per-test login and the refresh-token-rotation issue of saved storage state.
  // The explicit fresh-login test below does its own login and does not use it.
  const session = useAuthedPage('staff');

  test.describe('View Incidents List', () => {
    test('loads incidents data when navigating from dashboard after fresh login', async ({ page, staffUser }) => {
      // Fresh login flow: login → select location → dashboard
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.loginAndWaitForDashboard(staffUser.username, staffUser.password);

      // Navigate to incidents via dashboard button (primary user flow)
      await page.getByRole('link', { name: /view all incidents/i }).click();

      // Verify page loads successfully
      const incidentList = new IncidentListPage(page);
      await incidentList.expectLoaded();

      await expect(incidentList.incidentRows.first()).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('View Incident Details', () => {
    test('can click on incident to view details', async () => {
      const incidentList = new IncidentListPage(session.page);
      await incidentList.goto();

      // Skip if no incidents
      const count = await incidentList.getIncidentCount();
      if (count === 0) {
        test.skip();
        return;
      }

      // Click first incident row (rows navigate directly on click)
      await incidentList.clickIncident(0);

      // Should navigate to incident detail page
      await expect(session.page).toHaveURL(/\/incidents\/\d+/);
    });

    test('incident detail page shows incident information', async () => {
      const incidentList = new IncidentListPage(session.page);
      await incidentList.goto();

      const count = await incidentList.getIncidentCount();
      if (count === 0) {
        test.skip();
        return;
      }

      await incidentList.clickIncident(0);

      // Should see incident details (narrative text is visible somewhere on page)
      // Staff may not have edit permission, so check for view elements
      await expect(session.page.getByRole('heading').first()).toBeVisible();
    });
  });

  test.describe('Edit Incident', () => {
    // Note: Staff users may not have permission to edit incidents created by others.
    // These tests will skip if no editable incidents are available.

    test('shows edit permissions appropriately', async () => {
      const incidentList = new IncidentListPage(session.page);
      await incidentList.goto();

      const count = await incidentList.getIncidentCount();
      if (count === 0) {
        test.skip();
        return;
      }

      // The legacy Actions column has been replaced with row-click navigation.
      // Verify the global "New Incident" action is available (indicates edit/create permission).
      const newIncidentLink = session.page.getByRole('link', { name: /new incident/i });
      await expect(newIncidentLink).toBeVisible();
      await expect(newIncidentLink).toBeEnabled();
    });

    test('can view incident details without editing', async () => {
      const incidentList = new IncidentListPage(session.page);
      await incidentList.goto();

      const count = await incidentList.getIncidentCount();
      if (count === 0) {
        test.skip();
        return;
      }

      // Click first incident to view
      await incidentList.clickIncident(0);

      // Should be on incident detail page
      await expect(session.page).toHaveURL(/\/incidents\/\d+/);

      // Should be able to navigate back
      const backButton = session.page.getByRole('button', { name: /back/i });
      if (await backButton.isVisible()) {
        await backButton.click();
        await expect(session.page).toHaveURL(/\/incidents$/);
      }
    });

    // Detail page renders templates from two independent sources: the header
    // (incident.title, derived at form-submit time) and the sidebar list
    // (incident.template_ids). Both must reflect the latest edit.
    test('removing a template updates detail page header and sidebar', async () => {
      const incidentForm = new IncidentFormPage(session.page);

      await incidentForm.gotoCreate();
      await incidentForm.fillNarrative(
        'E2E - verify template removal propagates to detail page',
      );
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectTemplate('After-hours');
      await incidentForm.selectLocation('Main Street Branch');
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();
      await incidentForm.submit();

      await session.page.waitForURL(/\/incidents\/\d+(?:[?#].*)?$/, { timeout: 15000 });
      const idMatch = session.page.url().match(/\/incidents\/(\d+)/);
      expect(idMatch, 'should be on a detail URL after save').not.toBeNull();
      const incidentId = idMatch![1];

      await expect(session.page.getByText('Disturbance').first()).toBeVisible({ timeout: 10000 });
      await expect(session.page.getByText('After-hours').first()).toBeVisible();

      // navigate() applies the /incident-tracker SPA base path.
      await incidentForm.navigate(`/incidents/${incidentId}/edit`);
      await incidentForm.narrativeInput.waitFor({ state: 'visible' });
      await incidentForm.removeTemplate('After-hours');
      await incidentForm.saveReportButton.click();

      await session.page.waitForURL(
        new RegExp(`/incidents/${incidentId}(?:[?#].*)?$`),
        { timeout: 15000 },
      );
      await expect(session.page.getByText('Disturbance').first()).toBeVisible({ timeout: 10000 });
      await expect(session.page.getByText('After-hours')).toHaveCount(0);
    });
  });
});
