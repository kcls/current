import { describe, it, expect } from 'vitest';
import { buildLocationMap, getRegionOrgUnit } from '../location-utils';
import type { OrgUnit } from '../../../types';

// Helper to create mock org units
function createMockOrgUnit(overrides: Partial<OrgUnit> = {}): OrgUnit {
  const id = overrides.id ?? 1;
  return {
    id,
    uuid: `uuid-${id}`,
    label: 'Test Location',
    parent: null,
    unit_type: 1,
    is_active: true,
    deleted_at: null,
    ...overrides,
  };
}

describe('buildLocationMap', () => {
  it('should filter out inactive locations', () => {
    const locations: OrgUnit[] = [
      createMockOrgUnit({ id: 1, label: 'Active', is_active: true }),
      createMockOrgUnit({ id: 2, label: 'Inactive', is_active: false }),
    ];

    const { activeLocations } = buildLocationMap(locations);
    expect(activeLocations).toHaveLength(1);
    expect(activeLocations[0]!.label).toBe('Active');
  });

  it('should filter out deleted locations', () => {
    const locations: OrgUnit[] = [
      createMockOrgUnit({ id: 1, label: 'Active', deleted_at: null }),
      createMockOrgUnit({ id: 2, label: 'Deleted', deleted_at: '2024-01-01' }),
    ];

    const { activeLocations } = buildLocationMap(locations);
    expect(activeLocations).toHaveLength(1);
    expect(activeLocations[0]!.label).toBe('Active');
  });

  it('should create a map of locations by ID', () => {
    const locations: OrgUnit[] = [
      createMockOrgUnit({ id: 1, label: 'Location 1' }),
      createMockOrgUnit({ id: 2, label: 'Location 2' }),
    ];

    const { locationMap } = buildLocationMap(locations);
    expect(locationMap.get(1)?.label).toBe('Location 1');
    expect(locationMap.get(2)?.label).toBe('Location 2');
  });

  it('should calculate correct levels for nested hierarchy', () => {
    const locations: OrgUnit[] = [
      createMockOrgUnit({ id: 1, label: 'Root', parent: null }),
      createMockOrgUnit({ id: 2, label: 'Region', parent: 1 }),
      createMockOrgUnit({ id: 3, label: 'Branch', parent: 2 }),
    ];

    const { getLevel, locationMap } = buildLocationMap(locations);
    expect(getLevel(locationMap.get(1)!)).toBe(0);
    expect(getLevel(locationMap.get(2)!)).toBe(1);
    expect(getLevel(locationMap.get(3)!)).toBe(2);
  });

  it('should handle locations with missing parent', () => {
    const locations: OrgUnit[] = [
      createMockOrgUnit({ id: 2, label: 'Orphan', parent: 999 }), // Parent doesn't exist
    ];

    const { getLevel, locationMap } = buildLocationMap(locations);
    expect(getLevel(locationMap.get(2)!)).toBe(0);
  });

  it('should handle empty locations array', () => {
    const { activeLocations, locationMap } = buildLocationMap([]);
    expect(activeLocations).toHaveLength(0);
    expect(locationMap.size).toBe(0);
  });
});

describe('getRegionOrgUnit', () => {
  const hierarchicalLocations: OrgUnit[] = [
    createMockOrgUnit({ id: 1, label: 'System Root', parent: null }),
    createMockOrgUnit({ id: 10, label: 'North Region', parent: 1 }),
    createMockOrgUnit({ id: 20, label: 'South Region', parent: 1 }),
    createMockOrgUnit({ id: 100, label: 'North Branch A', parent: 10 }),
    createMockOrgUnit({ id: 101, label: 'North Branch B', parent: 10 }),
    createMockOrgUnit({ id: 200, label: 'South Branch A', parent: 20 }),
    createMockOrgUnit({ id: 1000, label: 'North Branch A - Floor 1', parent: 100 }),
  ];

  it('should return root org unit when given root uuid', () => {
    const result = getRegionOrgUnit('uuid-1', hierarchicalLocations);
    expect(result).toBe('uuid-1');
  });

  it('should return region uuid when given region uuid (level 1)', () => {
    const result = getRegionOrgUnit('uuid-10', hierarchicalLocations);
    expect(result).toBe('uuid-10');
  });

  it('should return parent region uuid for branch (level 2)', () => {
    const result = getRegionOrgUnit('uuid-100', hierarchicalLocations);
    expect(result).toBe('uuid-10'); // Parent region
  });

  it('should traverse up to level 1 for deeply nested location', () => {
    const result = getRegionOrgUnit('uuid-1000', hierarchicalLocations);
    expect(result).toBe('uuid-10'); // North Region
  });

  it('should return the org unit uuid if not found in locations', () => {
    const result = getRegionOrgUnit('uuid-999', hierarchicalLocations);
    expect(result).toBe('uuid-999');
  });

  it('should return null for empty locations array', () => {
    const result = getRegionOrgUnit('uuid-1', []);
    expect(result).toBeNull();
  });

  it('should handle multiple regions correctly', () => {
    expect(getRegionOrgUnit('uuid-100', hierarchicalLocations)).toBe('uuid-10'); // North
    expect(getRegionOrgUnit('uuid-200', hierarchicalLocations)).toBe('uuid-20'); // South
  });
});
