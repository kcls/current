import type { FileUploadResponse } from '@core/api/upload';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { BanDetailsResponse } from '../types';
import { currentPost } from './client';

export interface BanJoinedPatron {
  id: number;
  display_name?: string;
  first_name?: string;
  last_name?: string;
}

export interface BanJoinedIncident {
  id: number;
  title?: string;
  org_unit_name?: string;
}

export interface BanDetails {
  id: number;
  patron: number | BanJoinedPatron;
  incident: number | BanJoinedIncident | null;
  org_unit: string;
  is_trespass: boolean;
  starts_at: string;
  lifts_at: string | null;
  archives_at: string | null;
  comments: string | null;
  created_at: string;
  updated_at: string;
}

export const bansApi = {
  async getBanLetterTemplates(): Promise<BanLetterTemplate[]> {
    const response = await currentPost<{ templates?: BanLetterTemplate[] }>(
      '/ban/letter/template/list', {});
    return response.templates ?? [];
  },

  async createBan(params: {
    patron: number;
    incident: number;
    org_unit: string;
    is_trespass: boolean;
    starts_at: string;
    lifts_at?: string;
    archives_at?: string;
    comments?: string;
    case_number?: string;
    law_enforcement_agency?: string;
    ban_letter_template?: number;
    ban_letter_content?: string;
  }): Promise<{ patron_ban: BanDetails; ban_letter_id?: number }> {
    return await currentPost('/ban/create', params);
  },

  /**
   * Update an existing ban.
   *
   * Note: org_unit is intentionally not editable through this endpoint
   * (same security-shape decision as incident.update). The backend
   * silently ignores any `org_unit` field on `params`.
   */
  async editBan(params: {
    ban_id: number;
    starts_at?: string;
    lifts_at?: string;
    archives_at?: string;
    org_unit?: string;
    comments?: string;
    is_trespass?: boolean;
    case_number?: string;
    law_enforcement_agency?: string;
    ban_letter_template?: number;
    ban_letter_content?: string;
  }): Promise<void> {
    await currentPost('/ban/edit', params);
  },

  async archiveBan(params: {
    ban_id: number;
    comments?: string;
  }): Promise<{ patron_ban: BanDetails }> {
    return await currentPost('/ban/archive', params);
  },

  async extendBan(params: {
    ban_id: number;
    lifts_at: string;
    archives_at?: string;
    starts_at?: string;
    comments?: string;
    case_number?: string;
    law_enforcement_agency?: string;
    incident?: number;
    ban_letter_content?: string;
    ban_letter_template?: number;
    generated_by_org?: string;
  }): Promise<{ patron_ban: BanDetails; activity_log_id: number; letter_id?: number }> {
    return await currentPost('/ban/extend', params);
  },

  async getBanDetails(banId: number): Promise<BanDetailsResponse> {
    return await currentPost<BanDetailsResponse>('/ban/details', { ban_id: banId });
  },

  async getBanLetter(letterId: number): Promise<{ content: string } | null> {
    const response = await currentPost<{ letter: { content: string } | null }>(
      '/ban/letter/get',
      { letter_id: letterId },
    );
    return response.letter || null;
  },

  async createBanLetter(params: {
    ban_id: number;
    content: string;
    template?: number;
    generated_by_org?: string;
    incident?: number;
    case_number?: string;
    law_enforcement_agency?: string;
    comments?: string;
  }): Promise<{ letter_id: number; activity_log_id: number }> {
    return await currentPost('/ban/letter/create', params);
  },

  /**
   * Add a note / attachments / external links to an existing ban.
   *
   * Caller must upload any attachments through odo-asset first (via
   * `uploadService.uploadFile`) and pass the resulting `uuid`s as
   * `attachment_file_upload_ids` — same contract as patron-photo
   * create. The legacy endpoint accepted full file metadata and wrote
   * the `asset.file_upload` row server-side; that path is gone.
   */
  async addToBan(params: {
    ban_id: number;
    comments?: string;
    attachments?: FileUploadResponse[];
    external_links?: Array<{ url: string; title: string; description?: string }>;
  }): Promise<{ activity_log_id: number }> {
    const payload: Record<string, unknown> = {
      ban_id: params.ban_id,
    };
    if (params.comments !== undefined) payload.comments = params.comments;
    if (params.attachments && params.attachments.length > 0) {
      payload.attachment_file_upload_ids = params.attachments.map((a) => a.uuid);
    }
    if (params.external_links && params.external_links.length > 0) {
      payload.external_links = params.external_links;
    }
    return await currentPost('/ban/add-to', payload);
  },
};
