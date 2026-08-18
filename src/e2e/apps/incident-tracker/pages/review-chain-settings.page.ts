import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Review Chain Settings page object model
 * Handles managing review chain configuration for locations
 */
export class ReviewChainSettingsPage extends BasePage {
  // Page elements
  readonly pageHeading: Locator;
  readonly locationSelect: Locator;

  // Action buttons
  readonly addReviewerGroupButton: Locator;
  readonly saveButton: Locator;
  readonly refreshButton: Locator;

  // Alerts
  readonly errorAlert: Locator;
  readonly infoAlert: Locator;

  constructor(page: Page) {
    super(page);

    this.pageHeading = page.getByRole('heading', { name: /review process/i });
    this.locationSelect = page.locator('#org-unit-select');

    this.addReviewerGroupButton = page.getByRole('button', { name: /add reviewer group/i });
    this.saveButton = page.getByRole('button', { name: /save/i });
    this.refreshButton = page.getByRole('button', { name: /refresh/i });

    this.errorAlert = page.locator('.MuiAlert-standardError');
    this.infoAlert = page.locator('.MuiAlert-standardInfo');
  }

  /**
   * Navigate to review chain settings page
   */
  async goto(): Promise<void> {
    await this.navigate('/review-process');
    await this.waitForReady();
  }

  /**
   * Wait for page to be ready
   */
  async waitForReady(): Promise<void> {
    await this.pageHeading.waitFor({ state: 'visible' });
    await this.waitForLoadingComplete();
  }

  /**
   * Select a location from the dropdown
   */
  async selectLocation(locationName: string): Promise<void> {
    await this.locationSelect.click();
    await this.page.getByRole('option', { name: locationName }).click();
    await this.waitForLoadingComplete();
  }

  /**
   * Get the currently selected location name
   */
  async getSelectedLocation(): Promise<string> {
    return this.locationSelect.textContent() || '';
  }

  /**
   * Get all review level cards
   * Each level card contains "Level N" text where N is a number
   */
  getReviewLevels(): Locator {
    // Match "Level 1", "Level 2", etc. - more specific than just "Level"
    return this.page.locator('[class*="MuiPaper-root"]').filter({
      has: this.page.locator('text=/^Level \\d+$/'),
    });
  }

  /**
   * Get a specific review level by index (1-based)
   */
  getReviewLevel(levelNumber: number): Locator {
    // Use exact text match for Level N heading, then go up to the level card container
    // DOM structure: levelCard > headerSection > heading "Level N"
    // We need to go up 3 levels to get the full level card that contains both header and members
    return this.page.locator(`text="Level ${levelNumber}"`).locator('..').locator('..').locator('..');
  }

  /**
   * Get the count of review levels by counting "Level N" occurrences
   */
  async getReviewLevelCount(): Promise<number> {
    // Count elements that match "Level 1", "Level 2", etc.
    const levelTexts = this.page.locator('text=/^Level \\d+$/');
    return levelTexts.count();
  }

  /**
   * Delete a review level by index (1-based)
   */
  async deleteLevel(levelNumber: number): Promise<void> {
    const levelCard = this.getReviewLevel(levelNumber);
    const deleteButton = levelCard.getByRole('button', { name: 'Delete level' });

    // Ensure button is visible before clicking
    await expect(deleteButton).toBeVisible({ timeout: 5000 });

    // Set up dialog handler before clicking (for native browser dialogs)
    this.page.once('dialog', dialog => dialog.accept());

    await deleteButton.click();

    // Check if there's a MUI confirmation dialog and handle it
    const muiConfirmButton = this.page.getByRole('button', { name: /confirm|yes|ok/i });
    const isDialogVisible = await muiConfirmButton.isVisible();
    if (isDialogVisible) {
      await muiConfirmButton.click();
    }
  }

  /**
   * Add a new reviewer group
   */
  async addReviewerGroup(): Promise<void> {
    await this.addReviewerGroupButton.click();
  }

  /**
   * Save the review chain
   */
  async save(): Promise<void> {
    await this.saveButton.click();
    // Wait for save to complete
    await this.page.waitForResponse(
      response => response.url().includes('review_chain.save') && response.ok(),
      { timeout: 10000 }
    ).catch(() => {
      // Response might fail with blocked error, that's expected in some tests
    });
  }

  /**
   * Try to save and expect it to fail
   */
  async saveAndExpectError(): Promise<void> {
    await this.saveButton.click();
    await this.errorAlert.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Get the error message from the alert
   */
  async getErrorMessage(): Promise<string> {
    return this.errorAlert.textContent() || '';
  }

  /**
   * Check if the save was blocked due to in-flight incidents
   */
  async expectBlockedByInFlightIncidents(): Promise<void> {
    const errorText = await this.getErrorMessage();
    expect(errorText).toContain('Cannot reduce review chain');
    expect(errorText).toContain('waiting for review');
  }

  /**
   * Add a member to a review level
   */
  async addMemberToLevel(levelNumber: number, memberName: string): Promise<void> {
    const levelCard = this.getReviewLevel(levelNumber);
    // MUI Autocomplete renders as a combobox with label "Search for staff members"
    const searchInput = levelCard.getByRole('combobox', { name: /search for staff/i });
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });

    // Clear any existing value and type slowly to trigger search
    await searchInput.clear();
    await searchInput.pressSequentially(memberName, { delay: 50 });

    // Wait for search results dropdown and click the option
    const option = this.page.getByRole('option', { name: new RegExp(memberName, 'i') });
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();
  }

  /**
   * Remove a member from a review level
   */
  async removeMemberFromLevel(levelNumber: number, memberName: string): Promise<void> {
    const levelCard = this.getReviewLevel(levelNumber);
    const chip = levelCard.getByText(memberName);
    const deleteIcon = chip.locator('..').getByTestId('CancelIcon');
    await deleteIcon.click();
  }

  /**
   * Assert page is loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.pageHeading).toBeVisible();
  }

  /**
   * Assert a success notification is shown
   */
  async expectSaveSuccess(): Promise<void> {
    await expect(this.page.getByRole('alert')).toContainText(/saved/i);
  }
}
