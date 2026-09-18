import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Incident detail page object model
 * Handles viewing incident details and actions
 */
export class IncidentDetailPage extends BasePage {
  // Page elements
  readonly pageHeading: Locator;
  readonly incidentNumber: Locator;
  readonly incidentTitle: Locator;
  readonly incidentDescription: Locator;

  // Action buttons
  readonly submitForReviewButton: Locator;
  readonly resubmitForReviewButton: Locator;
  readonly editButton: Locator;
  readonly deleteButton: Locator;
  readonly reviewButton: Locator;
  readonly resolveButton: Locator;
  readonly reopenButton: Locator;

  constructor(page: Page) {
    super(page);

    // Page elements
    this.pageHeading = page.getByRole('heading', { name: /incident/i }).first();
    this.incidentNumber = page.locator('[data-testid="incident-number"]');
    this.incidentTitle = page.locator('[data-testid="incident-title"]');
    this.incidentDescription = page.locator('[data-testid="incident-description"]');

    // Action buttons
    this.submitForReviewButton = page.getByRole('button', { name: 'Submit for Review' });
    this.resubmitForReviewButton = page.getByRole('button', { name: 'Resubmit for Review' });
    this.editButton = page.getByRole('button', { name: /edit/i });
    this.deleteButton = page.getByRole('button', { name: /delete/i });
    this.reviewButton = page.getByRole('button', { name: /review/i });
    this.resolveButton = page.getByRole('button', { name: /resolve/i });
    this.reopenButton = page.getByRole('button', { name: /reopen/i });
  }

  /**
   * Navigate to incident detail page
   */
  async goto(incidentId: number): Promise<void> {
    await this.navigate(`/incidents/${incidentId}`);
    await this.waitForReady();
  }

  /**
   * Wait for page to be ready
   */
  async waitForReady(): Promise<void> {
    await this.pageHeading.waitFor({ state: 'visible' });
  }

  /**
   * Submit incident for review
   */
  async submitForReview(): Promise<void> {
    await this.submitForReviewButton.click();
  }

  /**
   * Resubmit incident for review (after it was returned)
   */
  async resubmitForReview(): Promise<void> {
    await this.resubmitForReviewButton.click();
  }

  /**
   * Assert page is loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.pageHeading).toBeVisible();
  }
}
