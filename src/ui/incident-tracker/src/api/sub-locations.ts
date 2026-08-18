import type { SubLocation } from '../types';
import { currentPost } from './client';

/**
 * Transform backend row to SubLocation type
 */
const transformToSubLocation = (instance: any): SubLocation => {
  return {
    id: Number(instance.id) || 0,
    name: instance.label || '',
    org_unit: instance.org_unit || '',
    description: instance.description,
    location_code: instance.code
  };
};

export const subLocationApi = {
  async getByOrgUnit(orgUnitUuid: string): Promise<SubLocation[]> {
    const response = await currentPost<SubLocation[]>(
      '/sub-location/list', { org_unit: orgUnitUuid });
    return Array.isArray(response) ? response.map(transformToSubLocation) : [];
  },
};
