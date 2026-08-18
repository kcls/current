import { Page, Locator } from '@playwright/test';

/**
 * App base path - all routes are relative to this
 */
const APP_BASE_PATH = '/incident-tracker';

/**
 * Base page class providing common functionality for all page objects.
 * All page objects should extend this class.
 */
export abstract class BasePage {
  constructor(protected page: Page) {}

  /**
   * Navigate to a specific path (automatically prefixed with app base path)
   */
  async navigate(path: string): Promise<void> {
    await this.page.goto(`${APP_BASE_PATH}${path}`);
  }

  /**
   * Wait for page to be fully loaded (network idle)
   */
  async waitForLoaded(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Wait for page to be loaded (DOM content loaded)
   */
  async waitForDomLoaded(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Get the current page URL
   */
  getCurrentUrl(): string {
    return this.page.url();
  }

  /**
   * Get page title
   */
  async getTitle(): Promise<string> {
    return this.page.title();
  }

  /**
   * Check if an element is visible
   */
  async isVisible(locator: Locator): Promise<boolean> {
    return locator.isVisible();
  }

  /**
   * Wait for a specific URL pattern
   */
  async waitForUrl(urlPattern: string | RegExp): Promise<void> {
    await this.page.waitForURL(urlPattern);
  }

  /**
   * Get a toast/snackbar notification message
   */
  getNotification(): Locator {
    return this.page.getByRole('alert');
  }

  /**
   * Wait for loading spinner to disappear
   */
  async waitForLoadingComplete(): Promise<void> {
    const spinner = this.page.locator('[role="progressbar"]');
    if (await spinner.isVisible()) {
      await spinner.waitFor({ state: 'hidden' });
    }
  }

  /**
   * Take a screenshot for debugging
   */
  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `reports/screenshots/${name}.png` });
  }
}
