/**
 * Locations API adapter
 * Maps location operations to org-units API from @core
 */

import { orgUnitApi } from '@core/api/org-units';
import type { OrgUnit } from '@core/api/org-units';

export interface Location {
  id: string;
  name: string;
  code: string;
  type: 'library' | 'branch' | 'department' | 'area';
  parent_id?: string;
  address?: string;
  phone?: string;
  email?: string;
  hours?: string;
  active: boolean;
  metadata?: Record<string, any>;
  children?: Location[];
}

/**
 * Transform OrgUnit to Location type
 *
 * TODO update this to use unit_type.can_have_patrons, can_have_staff, and depth
 * to determine the use and position for each org unit instead of relying
 * on labels that will change.
 */
const transformToLocation = (orgUnit: OrgUnit): Location => {
  return {
    id: String(orgUnit.id),
    name: orgUnit.display_label || orgUnit.label,  // Use display_label if available
    code: orgUnit.code || orgUnit.label.substring(0, 3).toUpperCase(),
    type: orgUnit.unit_type_label === 'branch' ? 'branch' :
          orgUnit.unit_type_label === 'department' ? 'department' :
          orgUnit.unit_type_label === 'area' ? 'area' : 'library',
    parent_id: orgUnit.parent ? String(orgUnit.parent) : undefined,
    address: undefined,  // TODO: Add address field to org.unit table if needed
    phone: undefined,    // TODO: Add phone field to org.unit table if needed
    email: undefined,    // TODO: Add email field to org.unit table if needed
    hours: undefined,    // TODO: Add hours field to org.unit table if needed
    active: orgUnit.deleted_at === null,
    metadata: {}
  };
};

export const locationApi = {
  /**
   * Get all locations
   */
  async getAll(): Promise<Location[]> {
    const orgUnitTree = await orgUnitApi.getOrgUnitTree();
    const flattened = orgUnitApi.flattenOrgUnits(orgUnitTree);
    return flattened.map(transformToLocation);
  },

  /**
   * Get active locations
   */
  async getActive(): Promise<Location[]> {
    // All units from getOrgUnitTree are active (deleted_at is null)
    return locationApi.getAll();
  },

  /**
   * Get a single location by integer ID or org-unit uuid
   */
  async get(id: string | number): Promise<Location> {
    const orgUnitTree = await orgUnitApi.getOrgUnitTree();
    const orgUnit =
      typeof id === 'string' && !/^\d+$/.test(id)
        ? orgUnitApi.flattenOrgUnits(orgUnitTree).find((u) => u.uuid === id) ?? null
        : orgUnitApi.findUnitById(orgUnitTree, Number(id));
    if (!orgUnit) throw new Error(`Location ${id} not found`);
    return transformToLocation(orgUnit);
  },

  /**
   * Get locations by type
   */
  async getByType(type: Location['type']): Promise<Location[]> {
    const orgUnitTree = await orgUnitApi.getOrgUnitTree();
    const flattened = orgUnitApi.flattenOrgUnits(orgUnitTree);
    return flattened
      .filter(unit => {
        if (type === 'library') return !unit.parent;
        return unit.unit_type_label?.toLowerCase() === type;
      })
      .map(transformToLocation);
  },

  /**
   * Get child locations of a parent
   */
  async getChildren(parentId: string | number): Promise<Location[]> {
    const orgUnitTree = await orgUnitApi.getOrgUnitTree();
    const parent = orgUnitApi.findUnitById(orgUnitTree, Number(parentId));
    if (!parent || !parent.children) return [];
    return parent.children.map(transformToLocation);
  },

  /**
   * Get location hierarchy (tree structure)
   */
  async getHierarchy(): Promise<Location[]> {
    const orgUnitTree = await orgUnitApi.getOrgUnitTree();

    // Transform the tree structure, preserving hierarchy
    const transformTree = (units: OrgUnit[]): Location[] => {
      return units.map(unit => {
        const location = transformToLocation(unit);
        if (unit.children && unit.children.length > 0) {
          return { ...location, children: transformTree(unit.children) };
        }
        return location;
      });
    };

    return transformTree(orgUnitTree);
  },

  /**
   * Search locations by name or code
   */
  async search(query: string): Promise<Location[]> {
    const locations = await locationApi.getAll();
    const searchTerm = query.toLowerCase();

    return locations.filter(loc =>
      loc.name.toLowerCase().includes(searchTerm) ||
      loc.code.toLowerCase().includes(searchTerm)
    );
  }
};
