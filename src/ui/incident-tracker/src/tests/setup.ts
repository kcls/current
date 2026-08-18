import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest expect with jest-dom matchers
expect.extend(matchers);

// Clean up after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia (required for MUI)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
(globalThis as any).IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver
(globalThis as any).ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;

// Mock @core APIs to prevent real network calls
vi.mock('@core', async () => {
  const actual = await vi.importActual('@core');
  return {
    ...actual,
    samlApi: {
      listSSOConfigs: vi.fn().mockResolvedValue([]),
      initiateSSOLogin: vi.fn().mockResolvedValue({ redirect_url: 'https://sso.test.com/login', request_id: 'test-id' }),
      listIdPs: vi.fn().mockResolvedValue([]),
    },
    authApi: {
      login: vi.fn().mockResolvedValue({ token: 'test-token' }),
      refreshToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
      clearTokens: vi.fn(),
      getOrgUnit: vi.fn().mockReturnValue(null),
    },
  };
});
