import { test, expect } from '../../../../fixtures';
import { LoginPage } from '../../pages';

/**
 * Login Tests
 *
 * Comprehensive tests for login functionality
 */

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test.describe('UI Elements', () => {
    // The page defaults to the SSO view; reveal the username/password form.
    test.beforeEach(async ({ page }) => {
      await new LoginPage(page).revealLocalLogin();
    });

    test('should display all login form elements', async ({ page }) => {
      const loginPage = new LoginPage(page);

      await expect(loginPage.usernameInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeVisible();
      await expect(loginPage.submitButton).toBeVisible();
    });

    test('should have proper input types', async ({ page }) => {
      const loginPage = new LoginPage(page);

      // Password should be masked
      await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    });
  });

  test.describe('Validation', () => {
    // The page defaults to the SSO view; reveal the username/password form.
    test.beforeEach(async ({ page }) => {
      await new LoginPage(page).revealLocalLogin();
    });

    test('should disable submit button when username is empty', async ({ page }) => {
      const loginPage = new LoginPage(page);

      // Fill only password - button should remain disabled
      await loginPage.passwordInput.fill('password123');

      // Submit button should be disabled when username is empty
      await expect(loginPage.submitButton).toBeDisabled();
    });

    test('should disable submit button when password is empty', async ({ page }) => {
      const loginPage = new LoginPage(page);

      // Fill only username - button should remain disabled
      await loginPage.usernameInput.fill('user@test.com');

      // Submit button should be disabled when password is empty
      await expect(loginPage.submitButton).toBeDisabled();
    });

    test('should enable submit button when both fields are filled', async ({ page }) => {
      const loginPage = new LoginPage(page);

      // Fill both fields
      await loginPage.usernameInput.fill('user@test.com');
      await loginPage.passwordInput.fill('password123');

      // Submit button should be enabled
      await expect(loginPage.submitButton).toBeEnabled();
    });
  });

  test.describe('Authentication', () => {
    test('should authenticate staff user', async ({ page, staffUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.login(staffUser.username, staffUser.password);

      await loginPage.expectLoginSuccess();
    });

    test('should authenticate coordinator user', async ({ page, coordinatorUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.login(coordinatorUser.username, coordinatorUser.password);

      await loginPage.expectLoginSuccess();
    });

    test('should authenticate manager user', async ({ page, managerUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.login(managerUser.username, managerUser.password);

      await loginPage.expectLoginSuccess();
    });

    test('should authenticate admin user', async ({ page, adminUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.login(adminUser.username, adminUser.password);

      await loginPage.expectLoginSuccess();
    });

    test('should reject invalid credentials', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.login('invalid@test.com', 'wrongpassword');

      await loginPage.expectLoginError();
    });

    test('should keep submit button disabled with empty credentials', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.revealLocalLogin();

      // Without filling any fields, button should be disabled
      await expect(loginPage.submitButton).toBeDisabled();
    });
  });

  test.describe('Session', () => {
    test('should maintain session after page refresh', async ({ page, staffUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.login(staffUser.username, staffUser.password);
      await loginPage.expectLoginSuccess();

      // Refresh page
      await page.reload();

      // Should still be logged in (not redirected to login)
      await expect(page).not.toHaveURL(/\/login/);
    });

    test('should redirect to login when accessing protected page without session', async ({ browser }) => {
      // Use a fresh context with no stored session
      const context = await browser.newContext();
      const page = await context.newPage();

      // Try to access protected page without login (use app base path)
      await page.goto('/incident-tracker');

      // Should be redirected to login
      await expect(page).toHaveURL(/\/login/);

      await context.close();
    });
  });
});
