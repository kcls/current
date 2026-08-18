/**
 * Patron API adapter
 */

import { currentPost } from './client';

interface ModelInstance {
  id?: number | string;
  [key: string]: any;
}

import type {
  PatronDetails,
  PatronSearchResult,
  PatronStatus,
  ListResponse
} from '../types';
import type {
  PatronMergePreview,
  PatronMergeRequest,
  PatronMergeResult,
} from '../types/patron-merge';

// Model code for patrons in zcrud
const PATRON_MODEL = 'ip'; // incidents.patrons

/**
 * Transform zcrud ModelInstance to PatronSearchResult
 */
const transformToPatronSearchResult = (instance: ModelInstance): PatronSearchResult => {
  const displayName = instance.preferred_name ||
    `${instance.first_name} ${instance.last_name}`.trim();

  const now = new Date();
  const banMaxLiftsAt = instance.ban_max_lifts_at ? new Date(instance.ban_max_lifts_at) : null;
  const hasActiveBan = banMaxLiftsAt !== null && banMaxLiftsAt > now;
  const trespassMaxLiftsAt = instance.trespass_max_lifts_at ? new Date(instance.trespass_max_lifts_at) : null;
  const hasActiveTrespass = trespassMaxLiftsAt !== null && trespassMaxLiftsAt > now;

  return {
    id: String(instance.id),
    display_name: displayName,
    barcode: instance.library_card,
    library_card: instance.library_card,
    status: (instance.risk_level === 'banned' ? 'banned' : 'active') as PatronStatus,
    is_banned: hasActiveBan,
    is_trespassed: hasActiveTrespass,
    is_unknown: instance.is_unknown || false,
    incident_count: instance.incident_count || 0,
    last_incident: instance.last_incident_date,
    sort_incident: instance.sort_incident_date,
    match_score: instance.match_score,
    primary_photo_url: instance.primary_photo_path || undefined,
    incident_org_unit_id: instance.incident_org_unit_id || undefined,
    incident_org_unit_label: instance.incident_org_unit_label || undefined,
    alias: instance.alias || undefined,
    ban_max_lifts_at: instance.ban_max_lifts_at || undefined,
    active_ban_count: instance.active_ban_count || 0,
    trespass_max_lifts_at: instance.trespass_max_lifts_at || undefined,
    active_trespass_count: instance.active_trespass_count || 0,
    ban_location_names: instance.ban_location_names || undefined,
  };
};

/**
 * Transform zcrud ModelInstance to PatronDetails
 */
export const transformToPatronDetails = (instance: ModelInstance): PatronDetails => {
  const displayName = instance.preferred_name ||
    `${instance.first_name} ${instance.last_name}`.trim();

  // Parse metadata if it's a string
  let metadata: any = {};
  if (typeof instance.metadata === 'string') {
    try {
      metadata = instance.metadata ? JSON.parse(instance.metadata) : {};
    } catch (e) {
      console.error('Failed to parse patron metadata:', e);
    }
  } else {
    metadata = instance.metadata || {};
  }

  const instanceAny = instance as any;

  return {
    id: instance.id || 0,
    barcode: instance.library_card,
    display_name: displayName,
    first_name: instance.first_name,
    last_name: instance.last_name,
    middle_name: instance.middle_name,
    preferred_name: instance.preferred_name,
    email: instance.email,
    phone: instance.phone,
    address: instance.address_line1 ? {
      street: instance.address_line1 + (instance.address_line2 ? '\n' + instance.address_line2 : ''),
      city: instance.city || '',
      state: instance.state_province || '',
      zip: instance.postal_code || '',
      country: instance.country || 'US'
    } : undefined,
    library_card_number: instance.library_card,
    status: (instance.risk_level === 'banned' ? 'banned' : 'active') as PatronStatus,
    is_unknown: instance.is_unknown || false,
    created_at: instance.created_at,
    updated_at: instance.updated_at,
    notes: instance.notes || '',
    incidents: [], // Will be populated from incidents
    bans: [], // Will be populated from patron_bans
    photos: instance.photo_url ? [{
      id: 1,
      url: instance.photo_url,
      uploaded_at: instance.created_at,
      uploaded_by: instance.created_by,
      is_primary: true
    }] : [],
    risk_assessment: metadata.risk_assessment,
    fresh_start_eligibility: metadata.fresh_start_eligibility,
    alias: instanceAny['alias'],
    age_range: instanceAny['age_range']
  } as PatronDetails;
};

/**
 * Transform PatronDetails to API data format
 */
const transformToData = (patron: Partial<PatronDetails>): Record<string, any> => {
  const data: Record<string, any> = {};

  if (patron.first_name !== undefined) data.first_name = patron.first_name;
  if (patron.last_name !== undefined) data.last_name = patron.last_name;
  if (patron.middle_name !== undefined) data.middle_name = patron.middle_name;
  if (patron.preferred_name !== undefined) data.preferred_name = patron.preferred_name;
  if (patron.barcode !== undefined) data.library_card = patron.barcode;
  if (patron.email !== undefined) data.email = patron.email;
  if (patron.phone !== undefined) data.phone = patron.phone;
  if (patron.is_unknown !== undefined) data.is_unknown = patron.is_unknown;
  if (patron.notes !== undefined) data.notes = patron.notes;

  const patronAnyForBasicFields = patron as any;
  if (patronAnyForBasicFields['age_range'] !== undefined) data['age_range'] = patronAnyForBasicFields['age_range'];
  if (patronAnyForBasicFields['alias'] !== undefined) data['alias'] = patronAnyForBasicFields['alias'];

  const patronAny = patron as any;

  if (patronAny['address_line1'] !== undefined) data['address_line1'] = patronAny['address_line1'];
  if (patronAny['address_line2'] !== undefined) data['address_line2'] = patronAny['address_line2'];
  if (patronAny['city'] !== undefined) data['city'] = patronAny['city'];
  if (patronAny['state_province'] !== undefined) data['state_province'] = patronAny['state_province'];
  if (patronAny['postal_code'] !== undefined) data['postal_code'] = patronAny['postal_code'];
  if (patronAny['country'] !== undefined) data['country'] = patronAny['country'];
  if (patron.address && !patronAny['address_line1']) {
    data['address_line1'] = patron.address.street?.split('\n')[0];
    data['address_line2'] = patron.address.street?.split('\n')[1];
    data['city'] = patron.address.city;
    data['state_province'] = patron.address.state;
    data['postal_code'] = patron.address.zip;
    data['country'] = patron.address.country || 'US';
  }

  // Map status to risk_level
  if (patron.status === 'banned') {
    data.risk_level = 'banned';
  } else if (patron.status) {
    data.risk_level = 'low'; // Default for active patrons
  }

  // Store complex data in metadata
  if (patronAnyForBasicFields['metadata'] !== undefined) {
    data['metadata'] = patronAnyForBasicFields['metadata'];
  } else if (patron.risk_assessment || patron.fresh_start_eligibility) {
    data['metadata'] = {
      risk_assessment: patron.risk_assessment,
      fresh_start_eligibility: patron.fresh_start_eligibility
    };
  }

  return data;
};

export const patronApi = {
  /**
   * Search patrons using the backend API
   */
  async search(params: {
    query?: string;
    status?: PatronStatus;
    risk_level?: string;
    has_active_bans?: boolean;
    has_visible_trespass?: boolean;
    is_unknown?: boolean;
    org_unit?: string;
    page?: number;
    limit?: number;
    sort_incident_date?: boolean;
    sort_lift_date?: boolean;
    sort_dir?: 'asc' | 'desc';
  }): Promise<ListResponse<PatronSearchResult>> {
    const limit = params.limit || 25;
    const searchParams: Record<string, unknown> = {
      limit,
      offset: ((params.page || 1) - 1) * limit,
    };

    if (params.query !== undefined) searchParams.query = params.query;
    if (params.org_unit) searchParams.org_unit = params.org_unit;
    if (params.has_active_bans) searchParams.has_active_bans = params.has_active_bans;
    if (params.has_visible_trespass) searchParams.has_visible_trespass = params.has_visible_trespass;
    if (params.is_unknown !== undefined) searchParams.is_unknown = params.is_unknown;
    if (params.sort_incident_date !== undefined) searchParams.sort_incident_date = params.sort_incident_date;
    if (params.sort_lift_date !== undefined) searchParams.sort_lift_date = params.sort_lift_date;
    if (params.sort_dir) searchParams.sort_dir = params.sort_dir;

    const response = await currentPost<{ patrons?: unknown[]; total_count?: number }>(
      '/patron/search',
      searchParams,
    );

    const patrons = (response.patrons || []).map((p) =>
      transformToPatronSearchResult(p as ModelInstance),
    );

    return {
      items: patrons,
      total: response.total_count || 0,
      page: params.page || 1,
      page_size: limit,
    };
  },

  /**
   * Get patron details by ID
   */
  async get(id: string | number): Promise<PatronDetails> {
    const summary = await this.getDetailSummary(id);
    return transformToPatronDetails(summary.patron);
  },

  /**
   * Create a new patron
   */
  async create(patron: Partial<PatronDetails>): Promise<PatronDetails> {
    const transformed = transformToData(patron);

    // Some patrons are created on the fly and may have minimal info,
    // like just a first name.
    transformed.last_name ??= '';
    transformed.first_name ??= '';

    const result = await currentPost<PatronDetails>('/patron/create', transformed);
    if (!result) {
      throw new Error('Patron create() returned no response');
    }
    return transformToPatronDetails(result as ModelInstance);
  },

  /**
   * Update patron details
   */
  async update(id: string | number, updates: Partial<PatronDetails>): Promise<PatronDetails> {
    const transformed = transformToData(updates);
    const result = await currentPost<ModelInstance>('/patron/update', {
      patron_id: typeof id === 'string' ? parseInt(id) : id,
      ...transformed,
    });
    if (!result) throw new Error(`Patron ${id} not found`);
    return transformToPatronDetails(result);
  },

  /**
   * Delete a patron (soft delete)
   */
  async delete(id: string | number): Promise<{ patron_id: number; bans_lifted: number }> {
    const response = await currentPost<{ patron_id: number; bans_lifted: number }>(
      '/patron/delete',
      { patron_id: typeof id === 'string' ? parseInt(id) : id },
    );
    return response;
  },

  /**
   * Search patrons by name for autocomplete
   */
  async searchByName(query: string, limit: number = 10): Promise<PatronSearchResult[]> {
    const result = await this.search({
      query,
      limit
    });
    return result.items;
  },

  /**
   * Get patron bans with optional filters.
   * By default returns only visible (unarchived) bans.
   * Pass includeArchived: true to include archived bans.
   */
  async getPatronBans(params: {
    patronId?: string | number;
    incidentId?: string | number;
    orgUnit?: string;
    limit?: number;
    includeArchived?: boolean;
  }): Promise<any[]> {
    const requestParams: any = {};

    if (params.patronId) {
      requestParams.patron_id = typeof params.patronId === 'string'
        ? parseInt(params.patronId)
        : params.patronId;
    }

    if (params.incidentId) {
      requestParams.incident_id = typeof params.incidentId === 'string'
        ? parseInt(params.incidentId)
        : params.incidentId;
    }

    if (params.orgUnit) {
      requestParams.org_unit = params.orgUnit;
    }

    if (params.limit) {
      requestParams.limit = params.limit;
    }

    if (params.includeArchived) {
      requestParams.include_archived = true;
    }

    const response = await currentPost<{ bans?: any[] }>('/ban/list', requestParams);
    return response.bans ?? [];
  },

  // TODO: Add ban.letter.list_by_patron endpoint to list all accumulated letters for a patron across all bans (for patron page)

  /**
   * Get detailed summary for patron detail page
   * Returns patron info, statistics, and photos in a single call
   */
  async getDetailSummary(
    patronId: string | number,
    orgUnit?: string
  ): Promise<{
    patron: any;
    statistics: {
      active_bans_count: number;
      active_ban_only_count: number;
      active_trespass_count: number;
      visible_bans_count: number;
      total_incidents_count: number;
    };
    photos: Array<{
      id: number;
      patron: number;
      file_upload: string;
      is_primary: boolean;
      file_upload_data?: {
        id: string;
        file_name: string;
        file_type: string | null;
        file_size: number | null;
        relative_path: string;
      };
    }>;
  }> {
    const params: any = {
      patron_id: typeof patronId === 'string' ? parseInt(patronId) : patronId,
    };

    if (orgUnit !== undefined) {
      params.org_unit = orgUnit;
    }

    return await currentPost('/patron/details', params);
  },

  /**
   * Create a patron photo record. Caller must upload the file through
   * odo-asset first (via `uploadService.uploadFile`) and pass the
   * resulting `uuid` here — the backend just binds that existing
   * file_upload to the patron, it doesn't write the file row itself.
   */
  async createPhoto(
    patronId: string | number,
    fileUploadId: string,
    isPrimary: boolean = false,
  ): Promise<any> {
    return await currentPost('/patron/photo/create', {
      patron_id: typeof patronId === 'string' ? parseInt(patronId) : patronId,
      file_upload_id: fileUploadId,
      is_primary: isPrimary,
    });
  },

  /**
   * Set a photo as primary for a patron
   */
  async setPrimaryPhoto(patronId: string | number, photoId: number): Promise<any> {
    return await currentPost('/patron/photo/set-primary', {
      patron_id: typeof patronId === 'string' ? parseInt(patronId) : patronId,
      photo_id: photoId,
    });
  },

  /**
   * Delete a patron photo (also deletes the underlying file via odo-asset)
   */
  async deletePhoto(photoId: number): Promise<any> {
    return await currentPost('/patron/photo/delete', {
      photo_id: photoId,
    });
  },

  /**
   * Get merge preview for two patrons
   */
  async getMergePreview(
    primaryPatronId: number,
    secondaryPatronId: number
  ): Promise<PatronMergePreview> {
    return await currentPost<PatronMergePreview>('/patron/merge/preview', {
      primary_patron_id: primaryPatronId,
      secondary_patron_id: secondaryPatronId,
    });
  },

  /**
   * Execute patron merge operation
   */
  async executeMerge(request: PatronMergeRequest): Promise<PatronMergeResult> {
    return await currentPost<PatronMergeResult>('/patron/merge', request);
  },
};
