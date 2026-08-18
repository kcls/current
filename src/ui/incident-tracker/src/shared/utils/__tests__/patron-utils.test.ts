import { describe, it, expect } from 'vitest';
import { createTempUnknownPatron, formatAlias, getPatronNames } from '../patron-utils';
import type { Incident, InvolvedParty } from '../../../types';

describe('formatAlias', () => {
  it('returns plain alias unchanged', () => {
    expect(formatAlias('Tape Guy')).toBe('Tape Guy');
  });

  it('strips surrounding double quotes', () => {
    expect(formatAlias('"Tape Guy"')).toBe('Tape Guy');
  });

  it('strips surrounding parentheses', () => {
    expect(formatAlias('(Tape Guy)')).toBe('Tape Guy');
  });

  it('strips nested wrappers', () => {
    expect(formatAlias('(("Tape Guy"))')).toBe('Tape Guy');
  });

  it('preserves interior punctuation', () => {
    expect(formatAlias('Mr. (Tape) Guy')).toBe('Mr. (Tape) Guy');
  });

  it('returns undefined for empty / whitespace / wrapper-only input', () => {
    expect(formatAlias('')).toBeUndefined();
    expect(formatAlias(undefined)).toBeUndefined();
    expect(formatAlias(null)).toBeUndefined();
    expect(formatAlias('   ')).toBeUndefined();
    expect(formatAlias('""')).toBeUndefined();
    expect(formatAlias('()')).toBeUndefined();
  });
});

describe('createTempUnknownPatron', () => {
  it('should create a patron with the provided ID', () => {
    const result = createTempUnknownPatron('test-123');
    expect(result.id).toBe('test-123');
  });

  it('should generate a timestamp-based ID when not provided', () => {
    const result = createTempUnknownPatron();
    // Should start with 'unknown-' and have a timestamp
    expect(result.id).toMatch(/^unknown-\d+$/);
  });

  it('should set display_name to "Unknown Patron"', () => {
    const result = createTempUnknownPatron();
    expect(result.display_name).toBe('Unknown Patron');
  });

  it('should set status to "active"', () => {
    const result = createTempUnknownPatron();
    expect(result.status).toBe('active');
  });

  it('should set is_banned to false', () => {
    const result = createTempUnknownPatron();
    expect(result.is_banned).toBe(false);
  });

  it('should set incident_count to 0', () => {
    const result = createTempUnknownPatron();
    expect(result.incident_count).toBe(0);
  });

  it('should set is_unknown to true', () => {
    const result = createTempUnknownPatron();
    expect(result.is_unknown).toBe(true);
  });

  it('should set is_new_unsaved to true', () => {
    const result = createTempUnknownPatron();
    expect(result.is_new_unsaved).toBe(true);
  });
});

describe('getPatronNames', () => {
  // Helper to create mock incident with involved parties
  function createMockIncident(parties: Partial<InvolvedParty>[]): Incident {
    return {
      id: 1,
      patronId: null,
      description: 'Test',
      org_unit: 'org-uuid-1',
      created_by: 'user-uuid-1',
      created_at: '2024-01-15',
      occurred_at: '2024-01-15',
      updated_at: '2024-01-15',
      template_ids: [],
      involved_parties: parties.map((p, i) => ({
        id: i + 1,
        incident: 1,
        party_type: p.party_type || 'patron',
        patron_id: p.patron_id,
        patron_display: p.patron_display,
        ...p,
      })) as InvolvedParty[],
    };
  }

  describe('edge cases', () => {
    it('should return default value for null incident', () => {
      expect(getPatronNames(null)).toBe('-');
    });

    it('should return default value for undefined incident', () => {
      expect(getPatronNames(undefined)).toBe('-');
    });

    it('should return default value for incident with no involved_parties', () => {
      const incident = createMockIncident([]);
      expect(getPatronNames(incident)).toBe('-');
    });

    it('should return default value when no patrons in involved_parties', () => {
      const incident = createMockIncident([
        { party_type: 'staff', patron_id: undefined },
        { party_type: 'witness', patron_id: undefined },
      ]);
      expect(getPatronNames(incident)).toBe('-');
    });

    it('should return custom default value when provided', () => {
      expect(getPatronNames(null, 2, 'No patrons')).toBe('No patrons');
    });
  });

  describe('patron name extraction', () => {
    it('should extract patron_display_name when available', () => {
      const incident = createMockIncident([
        {
          party_type: 'patron',
          patron_id: 1,
          patron_display_name: 'John Doe',
        } as any,
      ]);
      expect(getPatronNames(incident)).toBe('John Doe');
    });

    it('should fall back to patron_display.display_name', () => {
      const incident = createMockIncident([
        {
          party_type: 'patron',
          patron_id: '1',
          patron_display: { id: '1', display_name: 'Jane Smith', is_banned: false },
        },
      ]);
      expect(getPatronNames(incident)).toBe('Jane Smith');
    });

    it('should return "Unknown" when no name available', () => {
      const incident = createMockIncident([
        { party_type: 'patron', patron_id: '1' },
      ]);
      expect(getPatronNames(incident)).toBe('Unknown');
    });

    it('should filter out non-patron party types', () => {
      const incident = createMockIncident([
        { party_type: 'staff', patron_id: '1', patron_display: { id: '1', display_name: 'Staff', is_banned: false } },
        { party_type: 'patron', patron_id: '2', patron_display: { id: '2', display_name: 'Patron', is_banned: false } },
      ]);
      expect(getPatronNames(incident)).toBe('Patron');
    });

    it('should filter out patrons without patron_id', () => {
      const incident = createMockIncident([
        { party_type: 'patron', patron_id: undefined, patron_display: { id: '0', display_name: 'No ID', is_banned: false } },
        { party_type: 'patron', patron_id: '1', patron_display: { id: '1', display_name: 'Has ID', is_banned: false } },
      ]);
      expect(getPatronNames(incident)).toBe('Has ID');
    });
  });

  describe('multiple patrons', () => {
    it('should join multiple patron names with comma', () => {
      const incident = createMockIncident([
        { party_type: 'patron', patron_id: '1', patron_display: { id: '1', display_name: 'Alice', is_banned: false } },
        { party_type: 'patron', patron_id: '2', patron_display: { id: '2', display_name: 'Bob', is_banned: false } },
      ]);
      expect(getPatronNames(incident)).toBe('Alice, Bob');
    });

    it('should truncate when exceeding maxDisplay', () => {
      const incident = createMockIncident([
        { party_type: 'patron', patron_id: '1', patron_display: { id: '1', display_name: 'Alice', is_banned: false } },
        { party_type: 'patron', patron_id: '2', patron_display: { id: '2', display_name: 'Bob', is_banned: false } },
        { party_type: 'patron', patron_id: '3', patron_display: { id: '3', display_name: 'Charlie', is_banned: false } },
      ]);
      expect(getPatronNames(incident, 2)).toBe('Alice, Bob... (+1)');
    });

    it('should respect custom maxDisplay value', () => {
      const incident = createMockIncident([
        { party_type: 'patron', patron_id: '1', patron_display: { id: '1', display_name: 'A', is_banned: false } },
        { party_type: 'patron', patron_id: '2', patron_display: { id: '2', display_name: 'B', is_banned: false } },
        { party_type: 'patron', patron_id: '3', patron_display: { id: '3', display_name: 'C', is_banned: false } },
        { party_type: 'patron', patron_id: '4', patron_display: { id: '4', display_name: 'D', is_banned: false } },
      ]);
      expect(getPatronNames(incident, 1)).toBe('A... (+3)');
      expect(getPatronNames(incident, 3)).toBe('A, B, C... (+1)');
      expect(getPatronNames(incident, 4)).toBe('A, B, C, D');
    });

    it('should not truncate when exactly at maxDisplay', () => {
      const incident = createMockIncident([
        { party_type: 'patron', patron_id: '1', patron_display: { id: '1', display_name: 'A', is_banned: false } },
        { party_type: 'patron', patron_id: '2', patron_display: { id: '2', display_name: 'B', is_banned: false } },
      ]);
      expect(getPatronNames(incident, 2)).toBe('A, B');
    });
  });
});
