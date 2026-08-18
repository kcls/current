import { test, expect } from '../../../../fixtures';
import { IncidentFormPage, IncidentDetailPage } from '../../pages';
import { useAuthedPage } from '../../support/authed-page';

/**
 * Submit for Review Tests
 *
 * Tests for the "Submit for Review" button behavior when:
 * 1. Location has review chain configured - button should be enabled
 * 2. Location has NO review chain configured - button should be disabled with tooltip
 *
 * The Submit for Review button lives on Step 3 of the stepper form.
 *
 * Test Setup:
 * - Main Street Branch (demo tree, code MAIN) MUST have a review chain configured
 * - Riverside Branch (code RIVR) MUST NOT have a review chain
 * - These are verified by the test data setup in sqitch migrations
 */

test.describe('Submit for Review Button', () => {
  // One authenticated staff session shared across this file (serial). Avoids a
  // per-test login and the refresh-token-rotation issue of saved storage state.
  const session = useAuthedPage('staff');

  test.describe('Create Incident Form', () => {
    test('button is enabled when location has review chain configured', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Fill required fields with a location that HAS review chain (Main Street Branch)
      await incidentForm.fillNarrative('E2E Test - Submit for review with review chain');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Main Street Branch'); // Has review chain

      // Add unknown patron (required for Disturbance template)
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();

      // Navigate to step 3 where Submit for Review lives
      await incidentForm.navigateToReviewStep();

      // Submit for Review button should be enabled
      await expect(incidentForm.submitForReviewButton).toBeEnabled();
    });

    test('button is disabled when location has NO review chain configured', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Fill required fields with a location that has NO review chain (Riverside Branch)
      await incidentForm.fillNarrative('E2E Test - Submit for review without review chain');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Riverside Branch'); // No review chain

      // Add unknown patron (required for Disturbance template)
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();

      // Navigate to step 3 where Submit for Review lives
      await incidentForm.navigateToReviewStep();

      // Submit for Review button should be disabled
      await expect(incidentForm.submitForReviewButton).toBeDisabled();
    });

    test('button shows tooltip when disabled due to no review chain', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Fill required fields with a location that has NO review chain (Riverside Branch)
      await incidentForm.fillNarrative('E2E Test - Check tooltip');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Riverside Branch'); // No review chain

      // Add unknown patron (required for Disturbance template)
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();

      // Navigate to step 3 where Submit for Review lives
      await incidentForm.navigateToReviewStep();

      // Button should be disabled
      await expect(incidentForm.submitForReviewButton).toBeDisabled();

      // Hover over the parent span to trigger tooltip (MUI wraps disabled buttons in a span)
      const tooltipWrapper = incidentForm.submitForReviewButton.locator('..');
      await tooltipWrapper.hover({ force: true });

      // Tooltip should appear with the message
      const tooltip = session.page.getByRole('tooltip', {
        name: /this location has no review process configured/i
      });
      await expect(tooltip).toBeVisible();
    });

    test('button changes state when switching between locations', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Fill required fields with Main Street Branch (has review chain)
      await incidentForm.fillNarrative('E2E Test - Location switching');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Main Street Branch'); // Has review chain

      // Add unknown patron
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();

      // Navigate to step 3 — button should be enabled
      await incidentForm.navigateToReviewStep();
      await expect(incidentForm.submitForReviewButton).toBeEnabled();

      // Go back to step 1 and change to Riverside Branch (no review chain)
      await incidentForm.navigateBackToReportStep();
      await incidentForm.selectLocation('Riverside Branch');

      // Navigate to step 3 — button should now be disabled
      await incidentForm.navigateToReviewStep();
      await expect(incidentForm.submitForReviewButton).toBeDisabled();

      // Go back to step 1 and change back to Main Street Branch
      await incidentForm.navigateBackToReportStep();
      await incidentForm.selectLocation('Main Street Branch');

      // Navigate to step 3 — button should be enabled again
      await incidentForm.navigateToReviewStep();
      await expect(incidentForm.submitForReviewButton).toBeEnabled();
    });
  });

  test.describe('Incident Detail Page', () => {
    test('button is enabled for incident at location with review chain', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Create an incident at Main Street Branch (has review chain)
      await incidentForm.fillNarrative('E2E Test - Detail page with review chain');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Main Street Branch');
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();

      // Save (not submit for review)
      await incidentForm.submit();

      // Wait for redirect to detail page
      await expect(session.page).not.toHaveURL(/\/incidents\/new/, { timeout: 15000 });
      await session.page.waitForURL(/\/incidents\/\d+/, { timeout: 10000 });

      // On detail page, Submit for Review button should be visible and enabled
      const detailPage = new IncidentDetailPage(session.page);
      await expect(detailPage.submitForReviewButton).toBeVisible();
      await expect(detailPage.submitForReviewButton).toBeEnabled();
    });

    test('button is disabled for incident at location without review chain', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Create an incident at Riverside Branch (no review chain)
      await incidentForm.fillNarrative('E2E Test - Detail page without review chain');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Riverside Branch');
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();

      // Save (not submit for review)
      await incidentForm.submit();

      // Wait for redirect to detail page
      await expect(session.page).not.toHaveURL(/\/incidents\/new/, { timeout: 15000 });
      await session.page.waitForURL(/\/incidents\/\d+/, { timeout: 10000 });

      // On detail page, Submit for Review button should be disabled
      const detailPage = new IncidentDetailPage(session.page);
      await expect(detailPage.submitForReviewButton).toBeVisible();
      await expect(detailPage.submitForReviewButton).toBeDisabled();
    });

    test('button shows tooltip on detail page when disabled', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Create an incident at Riverside Branch (no review chain)
      await incidentForm.fillNarrative('E2E Test - Detail page tooltip');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Riverside Branch');
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();

      // Save
      await incidentForm.submit();

      // Wait for redirect to detail page
      await expect(session.page).not.toHaveURL(/\/incidents\/new/, { timeout: 15000 });
      await session.page.waitForURL(/\/incidents\/\d+/, { timeout: 10000 });

      // Hover over the parent span to trigger tooltip (MUI wraps disabled buttons in a span)
      const detailPage = new IncidentDetailPage(session.page);
      await expect(detailPage.submitForReviewButton).toBeVisible();
      await expect(detailPage.submitForReviewButton).toBeDisabled();

      const tooltipWrapper = detailPage.submitForReviewButton.locator('..');
      await tooltipWrapper.hover({ force: true });

      const tooltip = session.page.getByRole('tooltip');
      await expect(tooltip).toBeVisible({ timeout: 5000 });
      await expect(tooltip).toContainText(/no review process configured/i);
    });
  });
});
