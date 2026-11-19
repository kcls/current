import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshot capture for the user docs in docs/. Not part of the e2e suite:
 * the default config never matches *.capture.ts, and CI does not run this.
 * Run through scripts/capture-docs.sh.
 *
 * Captures drive a seeded dev/test deployment (the e2e users and org tree)
 * and write PNGs to docs/generated/<feature>/. Rendering is pinned (viewport,
 * light theme, locale, time zone) so a rerun changes an image only when the
 * UI or the data shown in it changed.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:30080';

export default defineConfig({
  testDir: './docs-capture',
  testMatch: '*.capture.ts',
  outputDir: './reports/docs-capture',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    trace: 'retain-on-failure',
  },
});
