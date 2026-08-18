/**
 * Staff/User Search API adapter
 * Uses auth.user.get and auth.user.search APIs
 */

import { authApi } from '@core';
import type { User } from '@core/api/auth';

export interface StaffMember extends User {
  id: number;
  /** User uuid — the reference to hand to `current` APIs (staff_id etc.). */
  uuid?: string;
  username: string;
  email: string;
  first_given_name?: string;
  family_name?: string;
  display_name?: string;
  role?: string;
  org_unit?: number;
  org_unit_name?: string;
  is_active?: boolean;
  last_login?: string;
}

export interface StaffSearchResult {
  id: number;
  /** User uuid — the reference to hand to `current` APIs (staff_id etc.). */
  uuid: string;
  display_name: string;
  email: string;
  role: string;
  org_unit: number;
  org_unit_name: string;
  is_active: boolean;
}

const toStaffMember = (user: any): StaffMember => ({
  id: Number(user.id) || 0,
  uuid: user.uuid,
  username: user.username || user.email?.split('@')[0] || '',
  email: user.email || '',
  first_given_name: user.first_given_name,
  family_name: user.family_name,
  display_name: user.display_name || '',
  role: user.role || 'staff',
  org_unit: user.org_unit,
  org_unit_name: user.org_unit_name,
  is_active: user.status === 'active',
  last_login: user.last_login_at,
});

const toSearchResult = (user: any): StaffSearchResult => {
  const staff = toStaffMember(user);
  return {
    id: staff.id,
    uuid: staff.uuid || '',
    display_name: staff.display_name || '',
    email: staff.email,
    role: staff.role || 'staff',
    org_unit: staff.org_unit || 0,
    org_unit_name: staff.org_unit_name || '',
    is_active: staff.is_active || false,
  };
};

export const staffApi = {
  /**
   * Search staff members with pagination
   */
  async search(params: {
    query?: string;
    is_active?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    items: StaffSearchResult[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const limit = params.limit || 20;
    const page = params.page || 1;

    const searchParams: Record<string, any> = {
      limit,
      offset: (page - 1) * limit,
    };

    if (params.is_active) {
      searchParams.status = 'active';
    }

    if (params.query) {
      searchParams.keywords = params.query;
    }

    const results = await authApi.searchUsers(searchParams);
    const users = Array.isArray(results) ? results : [];
    const items = users.map(toSearchResult);

    return {
      items,
      total: items.length,
      page,
      page_size: limit,
    };
  },

  /**
   * Get staff member by ID (integer) or uuid.
   */
  async getById(id: number | string): Promise<StaffMember> {
    const params = typeof id === 'string' ? { uuid: id } : { id };
    const result = await authApi.getUser(params) as any;

    if (!result) {
      throw new Error(`Staff member ${id} not found`);
    }

    return toStaffMember(result);
  },

  /**
   * Search for staff by name (for autocomplete)
   */
  async searchByName(query: string, limit: number = 10): Promise<StaffSearchResult[]> {
    const result = await this.search({
      query,
      is_active: true,
      limit
    });
    return result.items;
  },
};
