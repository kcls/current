import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STORAGE_KEYS, loadSavedOrgUnits } from '../storage';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
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
