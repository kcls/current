import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Incident form page object model
 * Handles incident creation and editing via the 3-step stepper:
 *   Step 1 (Report) → Step 2 (Create Bans, optional) → Step 3 (Submit for Review)
 */
export class IncidentFormPage extends BasePage {
  // Form fields (Step 1)
  readonly narrativeInput: Locator;
  readonly incidentTemplatesSelect: Locator;
  readonly locationSelect: Locator;
  readonly subLocationSelect: Locator;
  readonly dateInput: Locator;
  readonly timeInput: Locator;
  readonly patronSearch: Locator;
  readonly staffSearch: Locator;

  // Step navigation
  readonly nextButton: Locator;
  readonly backStepButton: Locator;

  // Actions (Step 3)
  readonly saveReportButton: Locator;
  readonly submitForReviewButton: Locator;

  // Feedback
  readonly formErrors: Locator;
  readonly successMessage: Locator;
  readonly pageHeading: Locator;

  constructor(page: Page) {
    super(page);
    // Form fields
    this.narrativeInput = page.getByLabel('Incident Narrative');
    this.incidentTemplatesSelect = page.getByRole('combobox', { name: 'Incident Templates' });
    this.locationSelect = page.getByRole('combobox', { name: 'Location' });
    this.subLocationSelect = page.getByRole('combobox', { name: 'Sub-Location' });
    this.dateInput = page.getByLabel('Date');
    this.timeInput = page.getByLabel('Time');
    this.patronSearch = page.getByRole('combobox', { name: 'Search for patrons' });
    this.staffSearch = page.getByRole('combobox', { name: 'Search for staff members' });

    // Step navigation
    this.nextButton = page.getByRole('button', { name: 'Next' });
    this.backStepButton = page.getByRole('button', { name: 'Back' });

    // Actions on Step 3 (Submit for Review)
    this.saveReportButton = page.getByRole('button', { name: 'Save Report' });
    this.submitForReviewButton = page.getByRole('button', { name: 'Submit for Review' });

    // Feedback
    this.formErrors = page.locator('.MuiFormHelperText-root.Mui-error');
    this.successMessage = page.getByRole('alert').filter({ hasText: /success|created|saved/i });
    this.pageHeading = page.getByRole('heading', { name: 'Report New Incident' });
  }

  /**
   * Navigate to create incident page
   */
  async gotoCreate(): Promise<void> {
    await this.navigate('/incidents/new');
    await this.waitForReady();
  }

  /**
   * Wait for form to be ready
   */
  async waitForReady(): Promise<void> {
    await this.pageHeading.waitFor({ state: 'visible' });
    await this.narrativeInput.waitFor({ state: 'visible' });
  }

  /**
   * Navigate to edit incident page
   */
  async gotoEdit(incidentId: number): Promise<void> {
    await this.navigate(`/incidents/${incidentId}`);
  }

  /**
   * Fill incident narrative
   */
  async fillNarrative(narrative: string): Promise<void> {
    await this.narrativeInput.fill(narrative);
  }

  /**
   * Select incident template(s)
   */
  async selectTemplate(templateName: string): Promise<void> {
    await this.incidentTemplatesSelect.click();

    const listbox = this.page.getByRole('listbox');
    await listbox.waitFor({ state: 'visible' });

    const option = this.page.getByRole('option', { name: templateName, exact: true });
    await option.waitFor({ state: 'visible' });
    await option.click({ force: true });

    const chip = this.page.locator('.MuiChip-root', { hasText: templateName });
    await expect(chip).toBeVisible({ timeout: 5000 });
  }

  /**
   * Remove a previously selected template by clicking the chip's delete icon.
   */
  async removeTemplate(templateName: string): Promise<void> {
    const chip = this.page.locator('.MuiChip-root', { hasText: templateName });
    await expect(chip).toBeVisible();
    await chip.locator('.MuiChip-deleteIcon').click();
    await expect(chip).toHaveCount(0, { timeout: 5000 });
  }

  /**
   * Select a location from dropdown
   */
  async selectLocation(locationName: string): Promise<void> {
    await this.locationSelect.click();
    const listbox = this.page.getByRole('listbox');
    await listbox.waitFor({ state: 'visible' });
    const option = this.page.getByRole('option', { name: new RegExp(locationName, 'i') });
    await option.waitFor({ state: 'visible' });
    await option.click({ force: true });
  }

  /**
   * Fill the complete incident form (minimum required fields)
   */
  async fillForm(data: {
    narrative: string;
    template: string;
    location: string;
  }): Promise<void> {
    await this.fillNarrative(data.narrative);
    await this.selectTemplate(data.template);
    await this.selectLocation(data.location);
  }

  /**
   * Click Next on the current step. Triggers validation on step 1.
   */
  async clickNext(): Promise<void> {
    await this.nextButton.click();
  }

  /**
   * Navigate from step 1 through to step 3 (review step).
   * Handles step 2 (ban actions) being present or skipped.
   * Assumes step 1 is valid — call only after filling required fields.
   */
  async navigateToReviewStep(): Promise<void> {
    await this.nextButton.click();

    try {
      // If step 2 was skipped (no patrons), Save Report appears immediately
      await this.saveReportButton.waitFor({ state: 'visible', timeout: 1500 });
      return;
    } catch {
      // Step 2 is showing — click Next to advance to step 3
    }

    await this.nextButton.click();
    await this.saveReportButton.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Navigate back from step 3/2 to step 1 (report step).
   */
  async navigateBackToReportStep(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const onStep1 = await this.narrativeInput.isVisible().catch(() => false);
      if (onStep1) return;
      await this.backStepButton.click();
      await this.page.waitForTimeout(300);
    }
  }

  /**
   * Submit the form by navigating to step 3 and clicking Save Report
   */
  async submit(): Promise<void> {
    await this.navigateToReviewStep();
    await this.saveReportButton.click();
  }

  /**
   * Submit for review by navigating to step 3 and clicking Submit for Review
   */
  async submitForReview(): Promise<void> {
    await this.navigateToReviewStep();
    await this.submitForReviewButton.scrollIntoViewIfNeeded();
    await this.submitForReviewButton.click();
  }

  /**
   * Create a complete incident
   */
  async createIncident(data: {
    narrative: string;
    template: string;
    location: string;
  }): Promise<void> {
    await this.fillForm(data);
    await this.submit();
  }

  /**
   * Check if form has validation errors
   */
  async hasErrors(): Promise<boolean> {
    return this.formErrors.first().isVisible();
  }

  /**
   * Assert form submission success
   */
  async expectSuccess(): Promise<void> {
    await expect(this.successMessage).toBeVisible();
  }

  /**
   * Assert form validation error
   */
  async expectValidationError(): Promise<void> {
    await expect(this.formErrors.first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Assert form is loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.pageHeading).toBeVisible();
    await expect(this.narrativeInput).toBeVisible();
  }
}
