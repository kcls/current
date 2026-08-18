import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Dashboard page object model
 * Main landing page after login
 *
 * Based on actual UI structure from error-context:
 * - Header: menu button, "Incident Tracker" title, user info, notifications, theme toggle, preferences, logout
 * - Main: Welcome heading, New Incident button, Active Trespasses table, Recent Incidents table
 */
export class DashboardPage extends BasePage {
  // Locators - matching actual UI from error-context snapshot
  readonly welcomeHeading: Locator;
  readonly createIncidentButton: Locator;
  readonly activeTrespassesTab: Locator;
  readonly activeBansTab: Locator;
  readonly recentIncidentsSection: Locator;
  readonly logoutButton: Locator;
  readonly preferencesButton: Locator;
  readonly navigationMenu: Locator;
  readonly headerMenuButton: Locator;
  readonly rowsPerPageSelect: Locator;

  constructor(page: Page) {
    super(page);
    // Welcome heading shows "Welcome, [First Name]"
    this.welcomeHeading = page.getByRole('heading', { name: /welcome/i });
    // New Incident link in main content
    this.createIncidentButton = page.getByRole('link', { name: 'New Incident' });
    // Active Trespasses tab
    this.activeTrespassesTab = page.getByRole('tab', { name: 'Active Trespasses' });
    // Active Bans tab
    this.activeBansTab = page.getByRole('tab', { name: 'Active Bans' });
    // Recent Incidents section
    this.recentIncidentsSection = page.getByRole('heading', { name: /recent incidents/i });
    // Direct logout button in header (not in a dropdown menu)
    this.logoutButton = page.getByRole('button', { name: 'Logout' });
    // User preferences link
    this.preferencesButton = page.getByRole('link', { name: 'User preferences and settings' });
    // Navigation menu (sidebar)
    this.navigationMenu = page.getByRole('navigation');
    // Header menu button (hamburger)
    this.headerMenuButton = page.getByRole('button', { name: 'menu' });
    // Rows per page select (MUI TablePagination)
    this.rowsPerPageSelect = page.getByRole('combobox', { name: /rows per page/i });
  }

  /**
   * Navigate to dashboard (which is the app root)
   */
  async goto(): Promise<void> {
    await this.navigate('/');
  }

  /**
   * Click create new incident button
   */
  async clickCreateIncident(): Promise<void> {
    await this.createIncidentButton.click();
  }

  /**
   * Perform logout
   */
  async logout(): Promise<void> {
    await this.logoutButton.click();
    await this.waitForUrl(/\/login/);
  }

  /**
   * Get the welcome heading text
   */
  async getWelcomeText(): Promise<string> {
    const text = await this.welcomeHeading.textContent();
    return text ?? '';
  }

  /**
   * Check if create incident button is visible (role-based)
   */
  async canCreateIncident(): Promise<boolean> {
    return this.createIncidentButton.isVisible();
  }

  /**
   * Open navigation menu (sidebar)
   */
  async openNavigationMenu(): Promise<void> {
    await this.headerMenuButton.click();
  }

  /**
   * Navigate to a specific menu item
   */
  async navigateToMenu(menuName: string): Promise<void> {
    // Open menu first if not visible
    if (!(await this.navigationMenu.isVisible())) {
      await this.openNavigationMenu();
    }
    await this.navigationMenu.getByRole('link', { name: new RegExp(menuName, 'i') }).click();
  }

  /**
   * Assert dashboard is loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.welcomeHeading).toBeVisible();
    await expect(this.createIncidentButton).toBeVisible();
  }

  /**
   * Assert user is logged in (logout button visible means user is logged in)
   */
  async expectLoggedIn(): Promise<void> {
    await expect(this.logoutButton).toBeVisible();
  }

  /**
   * Get the current rows per page value from the Active Trespasses table
   */
  async getRowsPerPage(): Promise<string> {
    await this.activeTrespassesTab.click();
    const value = await this.rowsPerPageSelect.textContent();
    return value ?? '10';
  }

  /**
   * Change the rows per page for the Active Trespasses table
   */
  async setRowsPerPage(value: number): Promise<void> {
    await this.activeTrespassesTab.click();
    await this.rowsPerPageSelect.click();
    await this.page.getByRole('option', { name: String(value) }).click();
  }

  /**
   * Assert the rows per page value
   */
  async expectRowsPerPage(value: number): Promise<void> {
    await expect(this.rowsPerPageSelect).toHaveText(String(value));
  }
}
