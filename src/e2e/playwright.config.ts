import { defineConfig, devices } from '@playwright/test';

/**
 * Environment configuration
 * Override via environment variables:
 *   BASE_URL=http://localhost:30080 npm test
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

/**
 * Playwright configuration for Current E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Each app owns its tests under apps/<app>/tests; testDir is set per
  // project.

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retries: 2 on CI, 1 locally. e2e drives a real browser + backend, so a
  // small number of timing races remain (e.g. the multi-step login flow in the
  // login-flow tests, which by nature can't reuse a shared session). A single
  // retry absorbs those without masking real failures — a genuinely broken test
  // still fails every attempt.
  retries: process.env.CI ? 2 : 1,

  // Workers. The incident-tracker suite shares one backend + seeded users and
  // mutates global state (review chains, incidents), so parallel workers cause
  // cross-file state collisions. Default to 1 worker so files don't interleave.
  workers: 1,

  // Reporter configuration
  reporter: [
    ['html', { open: 'never', outputFolder: 'reports/html' }],
    ['json', { outputFile: 'reports/results.json' }],
    process.env.CI ? ['github'] : ['list'],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for navigation
    baseURL: BASE_URL,

    // Ignore HTTPS errors (needed for MockSAML SSO flow)
    ignoreHTTPSErrors: true,

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Default timeout for actions
    actionTimeout: 10000,

    // Default navigation timeout
    navigationTimeout: 30000,
  },

  // Test timeout
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

  // Projects: the Current app, Chromium.
  projects: [
    // The Current (incident-tracker) app. Chromium only — the suite drives one
    // shared backend, so we don't gain from cross-browser runs here.
    // fullyParallel:false — these tests share one backend, one set of seeded
    // users, and mutate global state (review chains, incidents), so they can't
    // safely interleave. Running them serially removes cross-test collisions.
    {
      name: 'current',
      testDir: './apps/incident-tracker/tests',
      fullyParallel: false,
      use: {
        ...devices['Desktop Chrome'],
        bypassCSP: true,
        launchOptions: {
          args: [
            // Treat the local HTTP origin as secure (fixes HTTPS->HTTP form submission)
            `--unsafely-treat-insecure-origin-as-secure=${BASE_URL}`,
            '--allow-running-insecure-content',
            '--disable-web-security',
            '--ignore-certificate-errors',
            '--disable-features=BlockInsecurePrivateNetworkRequests',
          ],
        },
      },
    },
  ],

  // Local dev server configuration (disabled by default - start server manually)
  // Uncomment to auto-start dev server:
  // webServer: {
  //   command: 'cd ../ui/incident-tracker && VITE_API_HOSTPORT=localhost:30080 npm start',
  //   url: BASE_URL,
  //   reuseExistingServer: true,
  //   timeout: 120000,
  // },

  // Output folder for test artifacts
  outputDir: 'reports/test-results',
});
