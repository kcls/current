import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  STORAGE_KEYS,
  loadSavedOrgUnits,
  forgetSavedOrgUnit,
  isUnknownOrgUnit,
} from '../storage';

// Mock localStorage
const storeRef = { get: (): Record<string, string> => ({}) };
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  storeRef.get = () => store;
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('STORAGE_KEYS', () => {
  it('should define USER_PREFERENCES key', () => {
    expect(STORAGE_KEYS.USER_PREFERENCES).toBe('incident-tracker-user-preferences');
  });

  it('should define SAVED_ORG_UNITS key', () => {
    expect(STORAGE_KEYS.SAVED_ORG_UNITS).toBe('incident-tracker-saved-org-units');
  });

});

describe('loadSavedOrgUnits', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should return empty array when no data in localStorage', () => {
    localStorageMock.getItem.mockReturnValue(null);

    const result = loadSavedOrgUnits();

    expect(result).toEqual([]);
    expect(localStorageMock.getItem).toHaveBeenCalledWith(STORAGE_KEYS.SAVED_ORG_UNITS);
  });

  it('should parse and return saved org units', () => {
    const savedData = [
      { uuid: 'uuid-1', code: 'LOC1', label: 'Location 1', last_used_at: '2024-01-15T10:00:00Z' },
      { uuid: 'uuid-2', code: 'LOC2', label: 'Location 2', last_used_at: '2024-01-16T10:00:00Z' },
    ];
    localStorageMock.getItem.mockReturnValue(JSON.stringify(savedData));

    const result = loadSavedOrgUnits();

    expect(result).toHaveLength(2);
    expect(result[0]!.code).toBe('LOC2'); // More recent first
    expect(result[1]!.code).toBe('LOC1');
  });

  it('should sort by last_used_at descending (most recent first)', () => {
    const savedData = [
      { uuid: 'uuid-1', code: 'OLD', label: 'Old', last_used_at: '2024-01-01T00:00:00Z' },
      { uuid: 'uuid-2', code: 'NEWEST', label: 'Newest', last_used_at: '2024-01-20T00:00:00Z' },
      { uuid: 'uuid-3', code: 'MIDDLE', label: 'Middle', last_used_at: '2024-01-10T00:00:00Z' },
    ];
    localStorageMock.getItem.mockReturnValue(JSON.stringify(savedData));

    const result = loadSavedOrgUnits();

    expect(result[0]!.code).toBe('NEWEST');
    expect(result[1]!.code).toBe('MIDDLE');
    expect(result[2]!.code).toBe('OLD');
  });

  it('should drop stale pre-uuid entries (integer id, no uuid)', () => {
    const savedData = [
      { id: 1, code: 'STALE', label: 'Stale', last_used_at: '2024-01-20T00:00:00Z' },
      { uuid: 'uuid-2', code: 'CURRENT', label: 'Current', last_used_at: '2024-01-10T00:00:00Z' },
    ];
    localStorageMock.getItem.mockReturnValue(JSON.stringify(savedData));

    const result = loadSavedOrgUnits();

    expect(result).toHaveLength(1);
    expect(result[0]!.code).toBe('CURRENT');
  });

  it('should return empty array for invalid JSON', () => {
    localStorageMock.getItem.mockReturnValue('not valid json {{{');

    const result = loadSavedOrgUnits();

    expect(result).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    localStorageMock.getItem.mockReturnValue('');

    const result = loadSavedOrgUnits();

    expect(result).toEqual([]);
  });

  it('should handle empty array in storage', () => {
    localStorageMock.getItem.mockReturnValue('[]');

    const result = loadSavedOrgUnits();

    expect(result).toEqual([]);
  });
});

describe('forgetSavedOrgUnit', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    // Earlier suites stub getItem with a fixed return; clearAllMocks
    // clears calls but not implementations, so restore the real
    // store-backed reader before exercising a read/write round trip.
    localStorageMock.getItem.mockImplementation(
      (key: string) => storeRef.get()[key] ?? null,
    );
  });

  it('drops only the named location', () => {
    localStorageMock.setItem(
      STORAGE_KEYS.SAVED_ORG_UNITS,
      JSON.stringify([
        { uuid: 'aaa', code: 'A', label: 'A', last_used_at: '2026-01-02T00:00:00Z' },
        { uuid: 'bbb', code: 'B', label: 'B', last_used_at: '2026-01-01T00:00:00Z' },
      ]),
    );

    forgetSavedOrgUnit('aaa');

    expect(loadSavedOrgUnits().map((u) => u.uuid)).toEqual(['bbb']);
  });

  it('is a no-op for a uuid that was never saved', () => {
    localStorageMock.setItem(
      STORAGE_KEYS.SAVED_ORG_UNITS,
      JSON.stringify([
        { uuid: 'aaa', code: 'A', label: 'A', last_used_at: '2026-01-01T00:00:00Z' },
      ]),
    );

    forgetSavedOrgUnit('never-saved');

    expect(loadSavedOrgUnits().map((u) => u.uuid)).toEqual(['aaa']);
  });

  it('survives an empty store', () => {
    expect(() => forgetSavedOrgUnit('aaa')).not.toThrow();
    expect(loadSavedOrgUnits()).toEqual([]);
  });
});

describe('isUnknownOrgUnit', () => {
  it('matches the NOT_FOUND the server returns for a stale location', () => {
    expect(
      isUnknownOrgUnit({
        code: 'NOT_FOUND',
        message: 'org unit 5eed0000-0000-4000-a000-000000000204 not found',
      }),
    ).toBe(true);
  });

  it('matches on the message alone when no code is carried', () => {
    expect(isUnknownOrgUnit({ message: 'org unit abc not found' })).toBe(true);
  });

  it('does not match a genuine auth failure', () => {
    expect(
      isUnknownOrgUnit({ code: 'UNAUTHENTICATED', message: 'Invalid credentials' }),
    ).toBe(false);
  });

  it('matches an Error carrying the server code, which is how it arrives', () => {
    // Regression: loginLocal used to throw a bare Error('Auth Failed'),
    // discarding the response body, so this predicate could never fire
    // and the login retry never ran. The client now rebuilds the Error
    // from the server's JSON -- this asserts the shape it produces.
    const err = new Error(
      'org unit 5eed0000-0000-4000-a000-000000000204 not found',
    ) as Error & { code?: string };
    err.code = 'NOT_FOUND';
    expect(isUnknownOrgUnit(err)).toBe(true);
  });

  it('does not match the bare Error the client used to throw', () => {
    expect(isUnknownOrgUnit(new Error('Auth Failed'))).toBe(false);
  });

  it('does not match a non-error value', () => {
    expect(isUnknownOrgUnit(undefined)).toBe(false);
    expect(isUnknownOrgUnit('nope')).toBe(false);
  });
});
