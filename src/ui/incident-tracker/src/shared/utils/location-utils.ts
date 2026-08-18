import type { OrgUnit } from '../../types';

export const buildLocationMap = (locations: OrgUnit[]) => {
  const activeLocations = locations.filter(loc => loc.is_active && !loc.deleted_at);
  const locationMap = new Map(activeLocations.map(loc => [loc.id, loc]));

  const getLevel = (loc: OrgUnit): number => {
    if (!loc.parent) return 0;
    const parent = locationMap.get(loc.parent);
    return parent ? getLevel(parent) + 1 : 0;
  };

  return { activeLocations, locationMap, getLevel };
};

/**
 * Get the region (level 1 parent) org unit for a given org unit.
 * If the org unit is already at level 0 or 1, returns itself.
 * If the org unit is at level > 1, traverses up to find the level 1 parent.
 */
export const getRegionOrgUnit = (userOrgUnitUuid: string, locations: OrgUnit[]): string | null => {
  if (locations.length === 0) return null;

  const { activeLocations, locationMap, getLevel } = buildLocationMap(locations);

  const userOrgUnit = activeLocations.find(loc => loc.uuid === userOrgUnitUuid);
  if (!userOrgUnit) return userOrgUnitUuid;

  const level = getLevel(userOrgUnit);

  // If level > 1, find parent at level 1
  if (level > 1) {
    let current = userOrgUnit;
    while (current.parent) {
      const parent = locationMap.get(current.parent);
      if (!parent) break;
      const parentLevel = getLevel(parent);
      if (parentLevel === 1) {
        return parent.uuid;
      }
      current = parent;
    }
  }
  // Level <= 1, use the org unit directly
  return userOrgUnit.uuid;
};
