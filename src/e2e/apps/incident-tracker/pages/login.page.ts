import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { SelectLocationPage } from './select-location.page';

/**
 * Login page object model
 * Handles authentication flows
 *
 * Maps to: src/ui/incident-tracker/src/pages/Login.tsx
 */
export class LoginPage extends BasePage {
  // Locators - matching Material UI TextField and Button components
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly loadingIndicator: Locator;
  readonly pageTitle: Locator;

  constructor(page: Page) {
    super(page);
    // Material UI TextField renders label + input, use getByLabel for accessibility
    this.usernameInput = page.getByLabel('Username');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton = page.getByTestId('local-login-button');
    this.errorMessage = page.getByRole('alert');
    this.loadingIndicator = page.locator('[role="progressbar"]');
    // Accept either historical "Incident Tracker Login" or the new "Current Login" heading
    this.pageTitle = page.getByRole('heading', { name: /login/i });
  }

  /**
   * Navigate to login page
   */
  async goto(): Promise<void> {
    await this.navigate('/login');
    await this.waitForReady();
  }

  /**
   * Wait for login page to be ready (form loaded)
   */
  async waitForReady(): Promise<void> {
    await this.pageTitle.waitFor({ state: 'visible' });
    await this.page
      .locator('[data-testid="toggle-local-login"], #username')
      .first()
      .waitFor({ state: 'visible' });
  }

  async revealLocalLogin(): Promise<void> {
    if (await this.usernameInput.isVisible().catch(() => false)) return;
    const toggle = this.page.getByTestId('toggle-local-login');
    await toggle.click();
    await this.usernameInput.waitFor({ state: 'visible' });
  }

  /**
   * Fill in login credentials
   */
  async fillCredentials(username: string, password: string): Promise<void> {
    await this.revealLocalLogin();
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
  }

  /**
   * Click the submit button
   */
  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /**
   * Perform complete login flow
   */
  async login(username: string, password: string): Promise<void> {
    await this.fillCredentials(username, password);
    await this.submit();
  }

  /**
   * Login and wait for redirect away from login page
   * After login, user may be redirected to:
   * - /select-location (if user has roles at multiple locations)
   * - /dashboard or /incidents (after location selection or single location)
   */
  async loginAndWaitForRedirect(username: string, password: string): Promise<void> {
    await this.login(username, password);
    // Wait for redirect away from login page
    await this.waitForUrl(/\/(select-location|dashboard|incidents)/);
  }

  /**
   * Complete login flow including location selection if needed
   * This is the recommended method for most tests as it handles all post-login flows
   */
  async loginAndWaitForDashboard(username: string, password: string): Promise<void> {
    await this.login(username, password);
    // Wait for redirect away from login page
    await expect(this.page).not.toHaveURL(/\/login/, { timeout: 30000 });

    // If we're on select-location page, complete the selection flow
    if (this.page.url().includes('/select-location')) {
      const selectLocationPage = new SelectLocationPage(this.page);
      await selectLocationPage.completeLocationSelection();
    }

    // Wait for dashboard to be fully rendered before allowing the test to continue
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Check if login error is displayed
   */
  async hasError(): Promise<boolean> {
    return this.errorMessage.isVisible();
  }

  /**
   * Get error message text
   */
  async getErrorMessage(): Promise<string> {
    const text = await this.errorMessage.textContent();
    return text ?? '';
  }

  /**
   * Assert successful login redirect
   */
  async expectLoginSuccess(): Promise<void> {
    await expect(this.page).toHaveURL(/\/(select-location|dashboard|incidents)/);
  }

  /**
   * Assert login error is shown
   */
  async expectLoginError(): Promise<void> {
    await expect(this.errorMessage).toBeVisible();
  }
}
