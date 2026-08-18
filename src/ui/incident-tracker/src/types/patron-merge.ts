import type { Patron } from './index';

export type ConflictType =
  | 'primary_photo'
  | 'active_ban'
  | 'same_incident'
  | 'field_conflict';

export interface PatronMergeConflict {
  type: ConflictType;
  field?: string;
  primary_value: any;
  secondary_value: any;
  description: string;
  resolution?: 'primary' | 'secondary' | 'custom';
  custom_value?: any;
}

export interface PatronMergeDataSummary {
  incidents: number;
  photos: number;
  bans: number;
  trespasses: number;
  notes: number;
  timeline_events: number;
}

export interface SameIncidentConflict {
  incident_id: number;
  incident_title: string;
  primary_role: string;
  secondary_role: string;
}

export interface MergeBanRecord {
  id: number;
  patron: number;
  incident: number;
  org_unit: string;
  is_trespass: boolean;
  starts_at: string;
  lifts_at?: string;
  comments?: string;
  created_at: string;
  org_unit_name: string;
}

export interface BanConflict {
  org_unit_id: string;
  org_unit_name: string;
  primary_ban: MergeBanRecord;
  secondary_ban: MergeBanRecord;
}

export interface TrespassConflict {
  primary_trespasses: MergeBanRecord[];
  secondary_trespasses: MergeBanRecord[];
}

export interface BanResolution {
  primary_ban_id: number;
  secondary_ban_id: number;
  resolution: 'primary' | 'secondary';
}

export interface TrespassResolution {
  resolution: 'primary' | 'secondary';
  lift_ban_ids: number[];
}

export interface PhotoConflict {
  primary_photo: {
    id: number;
    file_upload: string;
  };
  secondary_photo: {
    id: number;
    file_upload: string;
  };
}

export interface MergePreviewIncident {
  incident_id: number;
  title: string;
  created_at: string;
  occurred_at: string;
  org_unit: string;
  org_unit_label: string;
}

export interface MergePreviewPhoto {
  id: number;
  is_primary: boolean;
  file_path: string;
}

export interface MergePreviewBan {
  id: number;
  is_trespass: boolean;
  starts_at: string;
  lifts_at?: string;
  org_unit: string;
  org_unit_label: string;
  incident?: number;
  incident_title?: string;
}

export interface PatronDataItems {
  incidents: MergePreviewIncident[];
  photos: MergePreviewPhoto[];
  bans: MergePreviewBan[];
}

export interface PatronMergePreview {
  primary_patron: Patron;
  secondary_patron: Patron;
  primary_data_summary: PatronMergeDataSummary;
  secondary_data_summary: PatronMergeDataSummary;
  merged_data_summary: PatronMergeDataSummary;
  primary_items: PatronDataItems;
  secondary_items: PatronDataItems;
  conflicts: PatronMergeConflict[];
  same_incident_conflicts: SameIncidentConflict[];
  ban_conflicts: BanConflict[];
  trespass_conflicts: TrespassConflict[];
  can_resolve_ban_conflicts?: boolean;
  can_resolve_trespass_conflicts?: boolean;
  photo_conflict?: PhotoConflict;
  warnings: string[];
}

export interface PatronMergeRequest {
  primary_patron_id: number;
  secondary_patron_id: number;
  conflict_resolutions: PatronMergeConflictResolution[];
  ban_resolutions?: BanResolution[];
  trespass_resolutions?: TrespassResolution[];
}

export interface PatronMergeConflictResolution {
  type: ConflictType;
  field?: string;
  resolution: 'primary' | 'secondary' | 'custom';
  custom_value?: any;
}

export interface PatronMergeResult {
  success: boolean;
  merged_patron_id: number;
  deleted_patron_id: number;
  data_transferred: {
    incidents: number;
    photos: number;
    bans: number;
    notes: number;
  };
}
