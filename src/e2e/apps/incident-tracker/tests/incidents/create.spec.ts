import { test, expect } from '../../../../fixtures';
import { IncidentFormPage } from '../../pages';
import { useAuthedPage } from '../../support/authed-page';

/**
 * Incident Creation Tests
 *
 * Tests for creating incidents via the 3-step stepper form.
 * Covers Rashma's Test Case #1: Create Incidents
 */

test.describe('Incident Creation', () => {
  // One authenticated staff session shared across this file (serial). Avoids a
  // per-test login and the refresh-token-rotation issue of saved storage state.
  const session = useAuthedPage('staff');

  test.describe('Form Navigation', () => {
    test('can navigate to create incident form from dashboard', async () => {
      // Click New Incident button
      await session.page.getByRole('link', { name: /new incident/i }).click();

      // Verify form is displayed
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.expectLoaded();
    });

    test('can navigate to create incident form via URL', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();
      await incidentForm.expectLoaded();
    });
  });

  test.describe('Form Validation', () => {
    test('shows validation error when submitting empty form', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Click Next on step 1 with empty fields triggers validation
      await incidentForm.clickNext();

      // Should show validation error
      await incidentForm.expectValidationError();
    });

    test('shows validation error when narrative is missing', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Fill template but not narrative
      await incidentForm.selectTemplate('Disturbance');

      await incidentForm.clickNext();
      await incidentForm.expectValidationError();
    });

    test('shows validation error when template is missing', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Fill narrative but not template
      await incidentForm.fillNarrative('Test incident narrative');

      await incidentForm.clickNext();
      await incidentForm.expectValidationError();
    });
  });

  test.describe('Form Submission', () => {
    test('can create incident with required fields only', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Fill required fields
      await incidentForm.fillNarrative('E2E Test - Incident created via automated test');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Main Street Branch');

      // Add unknown patron (required for Disturbance template)
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();

      // Submit the form (navigates through steps and clicks Save Report)
      await incidentForm.submit();

      // Should show success or redirect away from form
      // Use longer timeout as API call may take time
      await expect(session.page).not.toHaveURL(/\/incidents\/new/, { timeout: 15000 });
    });

    test('can create incident and submit for review', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Fill required fields
      await incidentForm.fillNarrative('E2E Test - Incident for review');
      await incidentForm.selectTemplate('Disturbance');
      await incidentForm.selectLocation('Main Street Branch');

      // Add unknown patron (required for Disturbance template)
      await session.page.getByRole('button', { name: /add unknown patron/i }).click();

      // Submit for review (navigates through steps)
      await incidentForm.submitForReview();

      // Wait for form submission to complete and redirect
      // Use longer timeout as API call may take time
      await expect(session.page).not.toHaveURL(/\/incidents\/new/, { timeout: 15000 });
    });
  });

  test.describe('Cancel and Navigation', () => {
    test('can navigate away from form and return to incidents list', async () => {
      const incidentForm = new IncidentFormPage(session.page);
      await incidentForm.gotoCreate();

      // Fill some data
      await incidentForm.fillNarrative('This will be cancelled');

      // Navigate away via breadcrumb
      await session.page.getByRole('link', { name: 'Incidents' }).click();

      // Should navigate away from form
      await expect(session.page).not.toHaveURL(/\/incidents\/new/);
    });
  });
});
