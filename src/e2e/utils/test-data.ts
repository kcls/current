/**
 * Test data generators and utilities
 */

/**
 * Generate a unique test identifier
 */
export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generate incident test data
 */
export function generateIncidentData(overrides: Partial<IncidentTestData> = {}): IncidentTestData {
  const testId = generateTestId();
  return {
    title: `Test Incident ${testId}`,
    description: `This is a test incident created by E2E tests. ID: ${testId}`,
    location: 'Shoreline',
    ...overrides,
  };
}

export interface IncidentTestData {
  title: string;
  description: string;
  location: string;
}

/**
 * Generate patron test data
 */
export function generatePatronData(overrides: Partial<PatronTestData> = {}): PatronTestData {
  const testId = generateTestId();
  return {
    firstName: `Test`,
    lastName: `Patron-${testId}`,
    email: `test.patron.${testId}@test.example.org`,
    ...overrides,
  };
}

export interface PatronTestData {
  firstName: string;
  lastName: string;
  email?: string;
}

/**
 * Wait for a specified duration
 * Use sparingly - prefer Playwright's auto-waiting
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format date for form inputs
 */
export function formatDateForInput(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format time for form inputs
 */
export function formatTimeForInput(date: Date = new Date()): string {
  return date.toTimeString().slice(0, 5);
}
