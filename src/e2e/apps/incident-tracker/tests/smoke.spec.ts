import { test, expect } from '../../../fixtures';
import { LoginPage, DashboardPage, IncidentFormPage } from '../pages';

/**
 * Smoke Tests - Critical Path
 *
 * These tests cover the most essential user journeys.
 * Run on every PR to catch critical regressions quickly.
 *
 * Coverage:
 * - Authentication (login/logout)
 * - Dashboard access
 * - Incident creation (basic flow)
 */

test.describe('Smoke Tests', () => {
  test.describe('Authentication', () => {
    test('should display login page', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      // The login page is SSO-first; the username/password fields live
      // behind the "Use a username and password" toggle.
      await loginPage.revealLocalLogin();

      await expect(loginPage.usernameInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeVisible();
      await expect(loginPage.submitButton).toBeVisible();
    });

    test('should login successfully with valid credentials', async ({ page, staffUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login(staffUser.username, staffUser.password);

      // Should redirect away from login page (may go to select-location first)
      await expect(page).toHaveURL(/\/(select-location|dashboard|incidents)/);
    });

    test('should show error for invalid credentials', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login('invalid@test.com', 'wrongpassword');

      await loginPage.expectLoginError();
    });

    test('should logout successfully', async ({ page, staffUser }) => {
      // Login first
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.loginAndWaitForDashboard(staffUser.username, staffUser.password);

      // Then logout
      const dashboard = new DashboardPage(page);
      await dashboard.logout();

      // Should redirect to login page
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Dashboard', () => {
    test('should display dashboard after login', async ({ page, staffUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.loginAndWaitForDashboard(staffUser.username, staffUser.password);

      const dashboard = new DashboardPage(page);
      await dashboard.expectLoaded();
      await dashboard.expectLoggedIn();
    });

    test('should show create incident button for staff', async ({ page, staffUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.loginAndWaitForDashboard(staffUser.username, staffUser.password);

      const dashboard = new DashboardPage(page);
      // Wait for dashboard to be fully loaded before checking
      await dashboard.expectLoaded();
      const canCreate = await dashboard.canCreateIncident();

      expect(canCreate).toBe(true);
    });
  });

  test.describe('Incident Creation', () => {
    test('should navigate to create incident form', async ({ page, staffUser }) => {
      // Login
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.loginAndWaitForDashboard(staffUser.username, staffUser.password);

      // Wait for dashboard to be fully loaded
      const dashboard = new DashboardPage(page);
      await dashboard.expectLoaded();

      // Navigate to create incident
      await dashboard.clickCreateIncident();

      // Verify form page loaded
      const incidentForm = new IncidentFormPage(page);
      await incidentForm.expectLoaded();
    });

    test('should show validation error for empty required fields', async ({ page, staffUser }) => {
      // Login
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.loginAndWaitForDashboard(staffUser.username, staffUser.password);

      // Go to create form
      const incidentForm = new IncidentFormPage(page);
      await incidentForm.gotoCreate();

      // Click Next on step 1 with empty fields triggers validation
      await incidentForm.clickNext();

      // Should show validation error
      await incidentForm.expectValidationError();
    });
  });
});

test.describe('Role-Based Access', () => {
  test('staff user can access dashboard', async ({ page, staffUser }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWaitForDashboard(staffUser.username, staffUser.password);

    // Staff should be on dashboard after login
    const dashboard = new DashboardPage(page);
    await dashboard.expectLoaded();
    await dashboard.expectLoggedIn();
  });

  test('manager user can access dashboard', async ({ page, managerUser }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWaitForDashboard(managerUser.username, managerUser.password);

    // Manager should be on dashboard after login
    const dashboard = new DashboardPage(page);
    await dashboard.expectLoaded();
    await dashboard.expectLoggedIn();
  });

  test('admin user can access dashboard', async ({ page, adminUser }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWaitForDashboard(adminUser.username, adminUser.password);

    // Admin should be on dashboard after login (using manager as fallback)
    const dashboard = new DashboardPage(page);
    await dashboard.expectLoaded();
    await dashboard.expectLoggedIn();
  });
});
