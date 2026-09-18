import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Incident list page object model
 * Handles viewing, searching, and filtering incidents
 *
 * Maps to: src/ui/incident-tracker/src/pages/Incidents.tsx
 */
export class IncidentListPage extends BasePage {
  // Page elements
  readonly pageHeading: Locator;
  readonly incidentTable: Locator;
  readonly incidentRows: Locator;

  // Search and filters
  readonly searchInput: Locator;
  readonly locationFilter: Locator;
  readonly statusFilter: Locator;
  readonly dateRangeFilter: Locator;
  readonly clearFiltersButton: Locator;

  // Actions
  readonly newIncidentButton: Locator;

  // Loading/Empty states
  readonly loadingIndicator: Locator;
  readonly emptyState: Locator;
  readonly noResultsMessage: Locator;

  constructor(page: Page) {
    super(page);
    // Page elements
    this.pageHeading = page.getByRole('heading', { name: /incidents/i });
    this.incidentTable = page.getByRole('table');
    this.incidentRows = page.locator('tbody tr');

    // Search and filters
    this.searchInput = page.getByPlaceholder(/search/i);
    this.locationFilter = page.getByRole('combobox', { name: /location/i });
    // MUI wires the <InputLabel>Status</InputLabel> to the select via
    // aria-labelledby, so the combobox has an accessible name (same pattern as
    // the location filter) — far more stable than an xpath off the label text.
    this.statusFilter = page.getByRole('combobox', { name: /status/i });
    this.dateRangeFilter = page.getByRole('button', { name: /date range/i });
    this.clearFiltersButton = page.getByRole('button', { name: /clear/i });

    // Actions
    this.newIncidentButton = page.getByRole('link', { name: /new incident/i });

    // Loading/Empty states
    this.loadingIndicator = page.locator('[role="progressbar"]');
    this.emptyState = page.getByText(/no incidents/i);
    this.noResultsMessage = page.getByText(/no results/i);
  }

  /**
   * Navigate to incidents list page
   */
  async goto(): Promise<void> {
    await this.navigate('/incidents');
    await this.waitForReady();
  }

  /**
   * Wait for page to be ready
   */
  async waitForReady(): Promise<void> {
    await this.pageHeading.waitFor({ state: 'visible' });
    // Wait for either table or empty state
    await Promise.race([
      this.incidentTable.waitFor({ state: 'visible', timeout: 10000 }),
      this.emptyState.waitFor({ state: 'visible', timeout: 10000 }),
    ]).catch(() => {
      // One of them should be visible
    });
  }

  /**
   * Whether a filter control is actually present, waiting up to `timeout` for
   * it to render. Unlike a bare `locator.isVisible()` (a point-in-time check
   * with no retry), this won't race a still-rendering page — so a test can't
   * see `false` mid-render and skip, nor see a half-rendered `true` and then
   * time out interacting. Returns false only if it's genuinely absent.
   */
  async isFilterPresent(locator: Locator, timeout = 5000): Promise<boolean> {
    return locator
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Search for incidents by text
   */
  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    // Wait for network to settle after search debounce
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Clear search input
   */
  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
    // Wait for network to settle
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Filter by location
   */
  async filterByLocation(location: string): Promise<void> {
    await this.locationFilter.click();
    await this.page.getByRole('listbox').waitFor({ state: 'visible' });
    await this.page.getByRole('option', { name: new RegExp(location, 'i') }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Filter by status
   */
  async filterByStatus(status: string): Promise<void> {
    await this.statusFilter.click();
    await this.page.getByRole('listbox').waitFor({ state: 'visible' });
    await this.page.getByRole('option', { name: new RegExp(status, 'i') }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Clear all filters
   */
  async clearFilters(): Promise<void> {
    if (await this.clearFiltersButton.isVisible()) {
      await this.clearFiltersButton.click();
    }
  }

  /**
   * Get count of visible incidents (excludes "No incidents found" row)
   */
  async getIncidentCount(): Promise<number> {
    // Check if the "No incidents found" message is showing
    const noIncidentsText = await this.page.getByText('No incidents found').isVisible();
    if (noIncidentsText) {
      return 0;
    }
    return this.incidentRows.count();
  }

  /**
   * Click on an incident row by index (rows navigate directly on click)
   */
  async clickIncident(index: number): Promise<void> {
    const row = this.incidentRows.nth(index);
    await row.waitFor({ state: 'visible' });
    await row.click();
  }

  /**
   * Click on an incident by matching row text
   */
  async clickIncidentByText(text: string): Promise<void> {
    const row = this.page.getByRole('row').filter({ hasText: text }).first();
    await row.waitFor({ state: 'visible' });
    await row.click();
  }

  /**
   * Check if incident with specific text exists in list
   */
  async hasIncidentWithText(text: string): Promise<boolean> {
    const row = this.page.getByRole('row').filter({ hasText: text });
    return row.isVisible();
  }

  /**
   * Navigate to create new incident
   */
  async clickNewIncident(): Promise<void> {
    await this.newIncidentButton.click();
  }

  /**
   * Assert page is loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.pageHeading).toBeVisible();
  }

  /**
   * Assert incidents are displayed
   */
  async expectIncidentsVisible(): Promise<void> {
    await expect(this.incidentTable).toBeVisible();
    const count = await this.getIncidentCount();
    expect(count).toBeGreaterThan(0);
  }

  /**
   * Assert no results message is displayed
   */
  async expectNoResults(): Promise<void> {
    await expect(this.noResultsMessage.or(this.emptyState)).toBeVisible();
  }
}
