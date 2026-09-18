import { test, expect } from '../../../../fixtures';
import {
  LoginPage,
  IncidentFormPage,
  ReviewChainSettingsPage,
} from '../../pages';

test.describe.configure({ mode: 'serial' });

test.describe('Review Chain Edge Cases', () => {
  async function resetReviewChainTo2Levels(
    page: any,
    loginPage: LoginPage,
    reviewChainSettings: ReviewChainSettingsPage,
    coordinatorUser: any
  ) {
    await loginPage.goto();
    await loginPage.loginAndWaitForDashboard(coordinatorUser.username, coordinatorUser.password);
    await reviewChainSettings.goto();
    await reviewChainSettings.selectLocation('Main Street Branch');

    await expect(page.locator('text="Level 1"')).toBeVisible({ timeout: 10000 });

    let levelCount = await reviewChainSettings.getReviewLevelCount();

    if (levelCount > 2) {
      for (let i = levelCount; i > 2; i--) {
        await reviewChainSettings.deleteLevel(i);
        await expect(page.locator(`text="Level ${i}"`)).not.toBeVisible({ timeout: 5000 });
      }

      await reviewChainSettings.save();
      await reviewChainSettings.refreshButton.click();
      await reviewChainSettings.waitForLoadingComplete();

      levelCount = await reviewChainSettings.getReviewLevelCount();

      if (levelCount > 2) {
        throw new Error(
          `Could not reset to 2 levels (current: ${levelCount}). ` +
          `There may be in-flight incidents blocking the reset.`
        );
      }
    }
  }

  async function logout(page: any) {
    const logoutButton = page.getByRole('button', { name: 'Logout' });
    await expect(logoutButton).toBeVisible({ timeout: 5000 });
    await logoutButton.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
  }

  test.describe('Reducing Chain Levels with In-Flight Incidents', () => {
    /**
     * Incident at level 2, coordinator tries to reduce chain to 1 level.
     * System should block with BLOCKED_BY_IN_FLIGHT_INCIDENTS error.
     */
    test('blocks reducing chain when incident is waiting at level 2', async ({ page, managerUser, staffUser, coordinatorUser }) => {
      const loginPage = new LoginPage(page);
      const incidentForm = new IncidentFormPage(page);
      const reviewChainSettings = new ReviewChainSettingsPage(page);

      await resetReviewChainTo2Levels(page, loginPage, reviewChainSettings, coordinatorUser);
      await logout(page);

      // Staff creates incident and submits for review
      await loginPage.goto();
      await loginPage.loginAndWaitForDashboard(staffUser.username, staffUser.password);

      await incidentForm.gotoCreate();
      await incidentForm.fillNarrative('E2E Test - In-flight blocking test');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Main Street Branch');
      await page.getByRole('button', { name: /add unknown patron/i }).click();
      await incidentForm.submitForReview();

      await expect(page).not.toHaveURL(/\/incidents\/new/, { timeout: 15000 });
      await page.waitForURL(/\/incidents\/\d+/, { timeout: 10000 });
      const incidentUrl = page.url();

      await logout(page);

      // Manager approves -> incident advances to level 2
      await loginPage.goto();
      await loginPage.loginAndWaitForDashboard(managerUser.username, managerUser.password);

      await page.goto(incidentUrl);

      const reviewButton = page.getByRole('button', { name: 'Review' });
      await expect(reviewButton).toBeVisible({ timeout: 5000 });
      await reviewButton.click();

      const dialog = page.getByRole('dialog', { name: 'Approve Incident' });
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await dialog.getByRole('button', { name: 'Confirm' }).click();
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      await expect(page.getByText(/awaiting review from.*coordinator/i)).toBeVisible({ timeout: 10000 });

      await logout(page);

      // Coordinator tries to reduce chain -> should be blocked
      // Already on login page after logout — wait for ready instead of re-navigating
      await loginPage.waitForReady();
      await loginPage.loginAndWaitForDashboard(coordinatorUser.username, coordinatorUser.password);

      await reviewChainSettings.goto();
      await reviewChainSettings.selectLocation('Main Street Branch');

      const levelCount = await reviewChainSettings.getReviewLevelCount();
      expect(levelCount).toBe(2);

      await reviewChainSettings.deleteLevel(2);
      await reviewChainSettings.saveAndExpectError();
      await reviewChainSettings.expectBlockedByInFlightIncidents();

      // Cleanup: resolve the incident
      await page.goto(incidentUrl);

      const resolveButton = page.getByRole('button', { name: 'Complete Review' });
      await expect(resolveButton).toBeVisible({ timeout: 5000 });
      await resolveButton.click();

      const resolveDialog = page.getByRole('dialog', { name: /complete incident review/i });
      await expect(resolveDialog).toBeVisible({ timeout: 5000 });
      await resolveDialog.getByRole('button', { name: 'Confirm' }).click();
      await expect(resolveDialog).not.toBeVisible({ timeout: 10000 });
    });
  });
});
