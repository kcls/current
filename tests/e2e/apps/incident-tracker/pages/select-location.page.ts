import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Select Location page object model
 * Handles the location selection flow after login
 *
 * This page appears when user has roles at multiple locations.
 * User must select a working location before accessing the dashboard.
 */
export class SelectLocationPage extends BasePage {
  readonly pageTitle: Locator;
  readonly locationSelect: Locator;
  readonly continueButton: Locator;
  readonly logoutButton: Locator;

  constructor(page: Page) {
    super(page);
    this.pageTitle = page.getByRole('heading', { name: 'Select Working Location' });
    this.locationSelect = page.getByRole('combobox', { name: 'Working Location' });
    this.continueButton = page.getByRole('button', { name: 'Continue' });
    this.logoutButton = page.getByRole('button', { name: 'Logout' });
  }

  /**
   * Check if we're on the select location page
   */
  async isOnPage(): Promise<boolean> {
    return this.page.url().includes('/select-location');
  }

  /**
   * Wait for the select location page to be ready
   */
  async waitForReady(): Promise<void> {
    await this.pageTitle.waitFor({ state: 'visible' });
    await this.locationSelect.waitFor({ state: 'visible' });
    // Wait for locations to finish loading (select should be enabled when ready)
    await expect(this.locationSelect).toBeEnabled();
  }

  /**
   * Select a location from the dropdown by visible text
   */
  async selectLocation(locationName: string): Promise<void> {
    await this.locationSelect.click();
    // Wait for listbox to appear
    const listbox = this.page.getByRole('listbox');
    await listbox.waitFor({ state: 'visible' });
    // Wait for and click the option (use regex to handle potential leading whitespace)
    const option = this.page.getByRole('option', { name: new RegExp(locationName) });
    await option.waitFor({ state: 'visible' });
    await option.click();
    // Wait for listbox to close after selection
    await listbox.waitFor({ state: 'hidden' });
  }

  /**
   * Select the first available location (skips "All Locations" which is first)
   */
  async selectFirstLocation(): Promise<void> {
    await this.locationSelect.click();
    // Wait for listbox to appear
    const listbox = this.page.getByRole('listbox');
    await listbox.waitFor({ state: 'visible' });
    // Wait for dropdown options - skip "All Locations" (first), pick the root (second)
    const options = this.page.getByRole('option');
    await options.first().waitFor({ state: 'visible' });
    // Get the second option (index 1) to skip "All Locations"
    const rootOption = options.nth(1);
    await rootOption.click();
    // Wait for listbox to close after selection
    await listbox.waitFor({ state: 'hidden' });
  }

  /**
   * Click continue button to proceed to dashboard
   */
  async continue(): Promise<void> {
    // Wait for button to be enabled (requires location to be selected)
    await expect(this.continueButton).toBeEnabled({ timeout: 5000 });
    await this.continueButton.click();
  }

  /**
   * Complete the location selection flow - select Main Street Branch (a valid incident location)
   * Note: The root location cannot be used for incidents, must select a specific library
   */
  async completeLocationSelection(): Promise<void> {
    await this.waitForReady();
    // Select Main Street Branch - a valid library location for incidents
    await this.selectLocation('MAIN / Main Street Branch');
    await this.continue();
    // Wait for redirect - the dashboard is at /incident-tracker root (not /dashboard)
    // Just wait for URL to NOT be /select-location
    await this.page.waitForURL((url) => !url.pathname.includes('/select-location'));
  }

  /**
   * Complete the location selection flow with a specific location
   */
  async selectLocationAndContinue(locationName: string): Promise<void> {
    await this.waitForReady();
    await this.selectLocation(locationName);
    await this.continue();
    // Wait for redirect - just wait for URL to NOT be /select-location
    await this.page.waitForURL((url) => !url.pathname.includes('/select-location'));
  }

  /**
   * Logout from the select location page
   */
  async logout(): Promise<void> {
    await this.logoutButton.click();
    await this.waitForUrl(/\/login/);
  }
}
