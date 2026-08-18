/**
 * Incident API adapter
 * Maps incident operations to the incident-tracker backend service
 */

import type { Incident, IncidentFormData } from '../types';
import type { ExternalLinkFormData } from '../features/incidents/components/external-link-dialog';
import { currentPost } from './client';

type ModelInstance = Record<string, any>;

const getOrgUnitLabel = (instance: ModelInstance): string | undefined => {
  if (instance['org_unit'] && typeof instance['org_unit'] === 'object') {
    return (instance['org_unit'] as any).label;
  }
  return (instance['label'] || instance['org_unit_name'] || instance['location_name']) as string | undefined;
};

/**
 * Transform API response to Incident type
 */
const transformToIncident = (instance: ModelInstance): Incident => {
  // ModelInstance fields are directly on the object, not nested in 'data'

  const sub_location =
    typeof instance.sub_location === 'object' && instance.sub_location !== null ?
    instance.sub_location.id :
    instance.sub_location || null;

  const org_unit = typeof instance.org_unit === 'object' && instance.org_unit !== null ?
    instance.org_unit.uuid :
    (instance.org_unit || instance.location_id || null);

  const created_by = typeof instance.created_by === 'object' && instance.created_by !== null
    ? instance.created_by.id // handle joined object
    : instance.created_by || 0;

  const patronId = typeof instance.patron === 'object' && instance.patron !== null
    ? instance.patron.id
    : instance.patron || null;

  return {
    id: typeof instance.id === 'number' ? instance.id : Number(instance.id) || 0,
    patronId,
    template_ids: instance.template_ids || [],
    template_name: instance.template_name,
    title: instance.title,
    description: instance.description || null,
    org_unit: org_unit,
    org_unit_name: getOrgUnitLabel(instance),
    sub_location: sub_location,
    sub_location_name: instance.sub_location_name,
    metadata: (() => {
      if (typeof instance.metadata === 'string') {
        try {
          return instance.metadata ? JSON.parse(instance.metadata) : {};
        } catch (e) {
          console.error('Failed to parse metadata JSON:', e);
          return {};
        }
      }
      return instance.metadata || {};
    })(),
    created_by: created_by,
    created_by_name: instance.created_by_name,
    assigned_to: instance.assigned_to,
    assigned_to_name: instance.assigned_to_name,
    resolved_by: instance.resolved_by,
    resolved_at: instance.resolved_at,
    reviewed_by: instance.reviewed_by,
    reviewed_at: instance.reviewed_at,
    created_at: instance.created_at || new Date().toISOString(),
    occurred_at: instance.occurred_at,
    updated_at: instance.updated_at || new Date().toISOString(),
    deleted_at: instance.deleted_at,
    emergency_capture: instance.emergency_capture,
    called_emergency: instance.called_emergency,
    photos: instance.photos || [],
    involved_parties: (() => {
      if (typeof instance.involved_parties === 'string') {
        try {
          return instance.involved_parties ? JSON.parse(instance.involved_parties) : [];
        } catch (e) {
          console.error('Failed to parse involved_parties JSON:', e);
          return [];
        }
      }
      return instance.involved_parties || [];
    })(),
    external_links: (() => {
      if (typeof instance.external_links === 'string') {
        try {
          return instance.external_links ? JSON.parse(instance.external_links) : [];
        } catch (e) {
          console.error('Failed to parse external_links JSON:', e);
          return [];
        }
      }
      return instance.external_links || [];
    })(),
    // Top-level attachments from get_incident's with_attachments
    // option. Replaces the old `metadata.attachments` blob the legacy
    // backend used to round-trip via the incident row.
    attachments: Array.isArray(instance.attachments) ? instance.attachments : [],
    coordinator_notes: instance.coordinator_notes,
    resolution_notes: instance.resolution_notes,
    patron_notes: instance.patron_notes,
    resolution_checklist: (() => {
      if (typeof instance.resolution_checklist === 'string') {
        try {
          return instance.resolution_checklist ? JSON.parse(instance.resolution_checklist) : [];
        } catch (e) {
          console.error('Failed to parse resolution_checklist JSON:', e);
          return [];
        }
      }
      return instance.resolution_checklist || null;
    })(),
    ai_analysis: (() => {
      if (typeof instance.ai_analysis === 'string') {
        try {
          return instance.ai_analysis ? JSON.parse(instance.ai_analysis) : null;
        } catch (e) {
          console.error('Failed to parse ai_analysis JSON:', e);
          return null;
        }
      }
      return instance.ai_analysis || null;
    })(),
    current_review_level: instance.current_review_level,
    latest_review_result: instance.latest_review_result,
    creator_level: instance.creator_level,
    user_review_level: instance.user_review_level,
    is_final_review: instance.is_final_review,
    can_review: instance.can_review,
    can_resubmit: instance.can_resubmit,

    // Org unit address fields (for ban/trespass letters)
    org_address_line1: instance.org_address_line1,
    org_address_line2: instance.org_address_line2,
    org_city: instance.org_city,
    org_state: instance.org_state,
    org_postal_code: instance.org_postal_code
  };
};

function hasValue(v: any): boolean {
    return !(v === undefined || v === null || v === '');
}

/**
 * Transform Incident form data to API request format
 */
const transformToData = (incident: Partial<IncidentFormData | Incident>): Record<string, any> => {
  const data: Record<string, any> = {};

  // Map form fields to database fields
  // Handle multiple templates
  if ('template_ids' in incident && Array.isArray(incident.template_ids) && incident.template_ids.length > 0) {
    data.template_ids = incident.template_ids;
  }
  if (incident.org_unit !== undefined) data.org_unit = incident.org_unit;
  if (hasValue(incident.sub_location)) data.sub_location = Number(incident.sub_location);
  if (incident.title !== undefined) data.title = incident.title;
  if (incident.description !== undefined) data.description = incident.description;

  // Handle metadata - ensure external_links are included if present
  if (incident.metadata !== undefined) {
    // If metadata already contains external_links, it will be preserved
    data.metadata = JSON.stringify(incident.metadata);
  }

  if (incident.involved_parties !== undefined) data.involved_parties = incident.involved_parties;
  if (incident.emergency_capture !== undefined) data.emergency_capture = incident.emergency_capture;
  if (incident.called_emergency !== undefined) data.called_emergency = incident.called_emergency;
  if ('occurred_at' in incident && incident.occurred_at !== undefined) data.occurred_at = incident.occurred_at;

  // Additional fields from Incident type
  if ('resolved_by' in incident && incident.resolved_by !== undefined) data.resolved_by = incident.resolved_by;
  if ('resolved_at' in incident && incident.resolved_at !== undefined) data.resolved_at = incident.resolved_at;
  if ('resolution_notes' in incident && incident.resolution_notes !== undefined) data.resolution_notes = incident.resolution_notes;

  // @ts-ignore -- field is only on IncidentFormData
  const is_unknown = incident.is_unknown_patron || false;

  if (is_unknown) {
    data.patron = null;
    data.is_unknown_patron = true;
  } else if ('patron' in incident && incident.patron !== undefined) {
    // Use the patron field directly if it exists (from IncidentFormData)
    data.patron = incident.patron ? Number(incident.patron) : null;
    data.is_unknown_patron = false;
  }

  // Handle patron_notes - notes about the patron(s)
  // @ts-ignore -- field is only on IncidentFormData
  if ('patron_notes' in incident && incident.patron_notes !== undefined) {
    data.patron_notes = incident.patron_notes;
  }

  // Bind already-uploaded files to the incident. incident-submit.ts maps
  // the uploaded file_upload rows to these ids; the `current` service turns
  // each into an incidents.attachments join row. Without this pass-through
  // the ids are silently dropped and attachments never get linked.
  if (
    'attachment_file_upload_ids' in incident &&
    Array.isArray((incident as any).attachment_file_upload_ids)
  ) {
    data.attachment_file_upload_ids = (incident as any).attachment_file_upload_ids;
  }

  // Note: external_links are passed through metadata

  return data;
};

export const incidentApi = {
  /**
   * Search incidents using the new incidents.search API endpoint
   * Search incidents with filtering and pagination
   */
  async searchV2(params: {
    query?: string;
    org_unit?: string;
    is_resolved?: boolean;
    occurred_after?: string;
    occurred_before?: string;
    has_active_bans?: boolean;
    has_active_trespass?: boolean;
    patron?: number;
    sort_incident_date?: boolean;
    sort_dir?: 'asc' | 'desc';
    page?: number;
    limit?: number;
    with_involved_parties?: boolean;
  }): Promise<{
    items: Incident[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const pageSize = params.limit || 25;
    const page = params.page || 1;

    const searchParams: any = {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    };

    if (params.query) searchParams.query = params.query;
    if (params.org_unit) searchParams.org_unit = params.org_unit;
    if (params.is_resolved !== undefined) searchParams.is_resolved = params.is_resolved;
    if (params.occurred_after) searchParams.occurred_after = params.occurred_after;
    if (params.occurred_before) searchParams.occurred_before = params.occurred_before;
    if (params.has_active_bans) searchParams.has_active_bans = params.has_active_bans;
    if (params.has_active_trespass) searchParams.has_active_trespass = params.has_active_trespass;
    if (params.patron !== undefined) searchParams.patron = params.patron;
    if (params.sort_incident_date !== undefined) searchParams.sort_incident_date = params.sort_incident_date;
    if (params.sort_dir) searchParams.sort_dir = params.sort_dir;
    if (params.with_involved_parties !== undefined) {
      searchParams.options = { with_involved_parties: params.with_involved_parties };
    }

    const response = await currentPost<any>('/incident/search', searchParams);
    const incidents = (response.incidents || []).map((item: any) => transformToIncident(item));

    return {
      items: incidents,
      total: response.total_count || 0,
      page,
      page_size: pageSize,
    };
  },

  /**
   * Create a new incident via the `current` REST service.
   *
   * NOTE: pending_bans metadata is currently a no-op on the backend — the
   * ban write endpoints (ban.create, ban.extend) haven't been migrated to
   * `current` yet. Until they are, inline ban toggles on the incident form
   * won't create bans. `created_ban_ids` / `extended_ban_ids` will always
   * come back undefined.
   */
  async create(incident: IncidentFormData): Promise<Incident & {
    created_ban_ids?: number[];
    extended_ban_ids?: number[];
  }> {
    const transformed = transformToData(incident);
    const result = await currentPost<any>('/incident/create', transformed);

    // The new backend returns just identifiers ({id, created_at,
    // updated_at, occurred_at}). Fetch the full incident shape so callers
    // that downstream-render an Incident don't break.
    const parsed = transformToIncident({ ...transformed, ...result });
    return {
      ...parsed,
      created_ban_ids: result.created_ban_ids || undefined,
      extended_ban_ids: result.extended_ban_ids || undefined,
    };
  },

  /**
   * Get a single incident by ID with related data
   */
  async get(id: string | number): Promise<Incident> {
    const result = await currentPost<any>('/incident/get', {
      id: Number(id),
      options: {
        with_involved_parties: true,
        with_external_links: true,
        with_attachments: true,
      },
    });

    const incident = transformToIncident(result);

    // The new backend returns involved_parties as a flat array with display
    // names already resolved. Remap to the UI's expected shape.
    const rawParties = Array.isArray(result.involved_parties) ? result.involved_parties : [];
    incident.involved_parties = rawParties.map((party: any) => {
      let displayName = 'Unknown';
      let patron_display = undefined;
      const isUnknownPatron = party.is_unknown_patron === true;

      if (party.party_type === 'patron' && party.patron_id) {
        displayName = party.patron_display_name || `Patron #${party.patron_id}`;
        patron_display = {
          id: String(party.patron_id),
          display_name: displayName,
          is_unknown: isUnknownPatron,
        };
      } else if (party.party_type === 'staff' && party.staff_id) {
        displayName = party.staff_display_name || `Staff #${party.staff_id}`;
      } else if (party.party_type === 'external' && party.external_name) {
        displayName = party.external_name;
      }

      return {
        id: party.id,
        party_type: party.party_type,
        patron_id: party.patron_id || null,
        staff_id: party.staff_id || null,
        patron_display,
        external_name: party.external_name,
        external_contact: party.external_contact,
        role: party.role,
        notes: party.notes,
        non_patron_name: displayName,
        description: party.notes || '',
        requires_ban: false,
        is_unknown_patron: isUnknownPatron,
      };
    });

    return incident;
  },

  /**
   * Update an incident.
   *
   * Note: org_unit is intentionally not editable through this endpoint.
   * The `current` backend silently ignores any `org_unit` field on
   * `updates` — moving an incident across orgs would otherwise let a
   * caller relocate work under permissions checked at the source org
   * (an issue in the legacy endpoint).
   */
  async update(
    id: string | number,
    updates: Partial<IncidentFormData | Incident>,
    options?: {
      add_involved_parties?: Array<{
        party_type: string;
        patron_id?: number;
        staff_id?: string;
        external_name?: string;
        external_contact?: string;
        role?: string;
        notes?: string;
        is_unknown_patron?: boolean;
      }>;
      remove_involved_parties?: number[];
      add_external_links?: ExternalLinkFormData[];
      remove_external_links?: number[];
      /** file_upload uuids to bind as new attachments. */
      add_attachment_file_upload_ids?: string[];
      /** attachment (file_upload) uuids to unlink. */
      remove_attachment_ids?: string[];
    }
  ): Promise<Incident> {
    const updateParams: any = {
      id: Number(id),
      ...transformToData(updates),
    };

    if (options?.add_involved_parties) {
      updateParams.add_involved_parties = options.add_involved_parties;
    }
    if (options?.remove_involved_parties) {
      updateParams.remove_involved_parties = options.remove_involved_parties;
    }
    if (options?.add_external_links) {
      updateParams.add_external_links = options.add_external_links;
    }
    if (options?.remove_external_links) {
      updateParams.remove_external_links = options.remove_external_links;
    }
    if (options?.add_attachment_file_upload_ids) {
      updateParams.add_attachment_file_upload_ids = options.add_attachment_file_upload_ids;
    }
    if (options?.remove_attachment_ids) {
      updateParams.remove_attachment_ids = options.remove_attachment_ids;
    }

    const result = await currentPost<ModelInstance>('/incident/update', updateParams);
    if (!result) {
      throw new Error(`Failed to update incident ${id}`);
    }
    return transformToIncident(result);
  },

  /**
   * Get recent incidents (ordered by created_at DESC)
   */
  async getRecent(limit: number = 10): Promise<Incident[]> {
    const result = await incidentApi.searchV2({
      limit,
      is_resolved: false, // Only show active incidents in recent list
    });
    return result.items;
  },

  /**
   * Resolve an incident
   */
  async resolve(id: string | number, resolution: string): Promise<Incident> {
    // Create a review entry with result='resolved'
    // This will also set resolved_at and resolved_by timestamps automatically
    await this.createReview(Number(id), 'resolved', resolution);

    return this.get(id);
  },

  /**
   * Create an incident review
   */
  async createReview(
    incidentId: number,
    result: 'submitted' | 'approved' | 'approved-with-edits' | 'returned' | 'deleted' | 'resolved' | 'reopened',
    comments?: string
  ): Promise<any> {
    const params = {
      incident: incidentId,
      result,
      ...(comments && { comments })
    };

    return await currentPost('/incident/review/create', params);
  },

  /**
   * Get review history for an incident
   */
  async getReviews(incidentId: number): Promise<any[]> {
    const response = await currentPost<any[]>('/incident/review/list', {
      incident: incidentId,
    });
    return Array.isArray(response) ? response : [];
  },

  /**
   * Get incidents pending review for the current user
   *
   * Returns incidents that the current user needs to review based on their role
   * and the incident's current review state.
   *
   * Keyset-paged: pass `cursor` from a prior response's `nextCursor`
   * to fetch the next page. The first call should omit `cursor`.
   *
   * @param orgUnit - Org unit to filter by (backend includes descendants).
   *                  Pass null to get all locations.
   * @param opts.cursor - Opaque cursor from the prior `nextCursor`. Omit
   *                  to start from the oldest open incident.
   * @param opts.limit - Visible-row cap per page (defaults to backend
   *                  default; capped to backend max).
   */
  async getPendingReviews(
    orgUnit: string | null,
    opts: { cursor?: PendingReviewsCursor | null; limit?: number } = {},
  ): Promise<PendingReviewsPage> {
    const params: Record<string, unknown> = {};
    if (orgUnit != null) params.org_unit = orgUnit;
    if (opts.cursor) params.cursor = opts.cursor;
    if (opts.limit != null) params.limit = opts.limit;
    const result = await currentPost<{
      rows: any[];
      next_cursor?: PendingReviewsCursor | null;
    }>('/incident/pending-reviews', params);
    return {
      items: (result.rows || []).map((item: any) => transformToIncident(item)),
      nextCursor: result.next_cursor ?? null,
    };
  }
};

/**
 * Opaque keyset cursor returned by `getPendingReviews`. The UI passes
 * it back verbatim to fetch the next page; no field is inspected
 * client-side.
 */
export interface PendingReviewsCursor {
  created_at: string;
  id: number;
}

export interface PendingReviewsPage {
  items: Incident[];
  /**
   * Pass to the next `getPendingReviews` call as `opts.cursor`. `null`
   * when the inner DB scan reached the end of the open-incident set
   * (no more pages).
   */
  nextCursor: PendingReviewsCursor | null;
}
