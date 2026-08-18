import type { BanLetterTemplate } from '@core/types/auto/incidents';

export interface PatronDetails {
  id: string | number;
  barcode?: string;
  display_name: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  preferred_name?: string;
  alias?: string;
  email?: string;
  phone?: string;
  alternate_phone?: string;
  address?: PatronAddress;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  age_range?: number;
  age_range_label?: string;
  library_card_number?: string;
  library_card?: string;
  registration_date?: string;
  last_activity?: string;
  status: PatronStatus;
  is_unknown?: boolean;
  notes?: string;
  gender?: string;
  metadata?: string | Record<string, unknown>;
  incidents?: PatronIncidentSummary[];
  bans?: PatronBanSummary[];
  photos?: PatronPhoto[];
  risk_assessment?: RiskAssessment;
  fresh_start_eligibility?: FreshStartEligibility;
  created_at: string;
  updated_at: string;
}

export interface PatronAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export type PatronStatus = 'active' | 'inactive' | 'banned' | 'suspended' | 'deceased';

export interface PatronIncidentSummary {
  id: number;
  date: string;
  title: string;
  location: string;
  status: string;
  resulted_in_ban: boolean;
}

export interface PatronBanSummary {
  id: number;
  type: 'system' | 'branch' | 'temporary' | 'permanent';
  status: 'active' | 'expired' | 'lifted' | 'appealed';
  starts_at: string;
  lifts_at?: string;
  archives_at?: string;
  locations: string[];
}

export interface PatronPhoto {
  id: number;
  url: string;
  caption?: string;
  uploaded_at: string;
  uploaded_by: string;
  is_primary: boolean;
}

export interface RiskAssessment {
  score: number;  // 0-100
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactor[];
  last_calculated: string;
  trend: 'increasing' | 'stable' | 'decreasing';
}

export interface RiskFactor {
  type: string;
  description: string;
  weight: number;
  contribution: number;
}

export interface FreshStartEligibility {
  eligible: boolean;
  eligibility_date?: string;
  reasons_if_not_eligible?: string[];
  incidents_to_archive?: number;
  last_fresh_start?: string;
  fresh_start_count: number;
}

export interface PatronMergeRequest {
  primary_patron_id: string;
  duplicate_patron_ids: string[];
  merge_fields: {
    name?: boolean;
    contact?: boolean;
    address?: boolean;
    notes?: boolean;
    incidents?: boolean;
    bans?: boolean;
  };
  reason: string;
}

export interface PatronSearchResult {
  id: string;
  display_name?: string;
  barcode?: string;
  library_card?: string;
  status: PatronStatus;
  is_banned?: boolean;
  is_unknown?: boolean;
  incident_count?: number;
  last_incident?: string;
  sort_incident?: string;
  match_score?: number;  // For search relevance
  primary_photo_url?: string;  // URL to primary photo
  incident_org_unit_id?: string;  // Org unit uuid of the incident
  incident_org_unit_label?: string;  // Org unit label/name
  is_new_unsaved?: boolean;
  first_name?: string;
  last_name?: string;
  alias?: string;
  ban_max_lifts_at?: string;
  active_ban_count?: number;
  trespass_max_lifts_at?: string;
  active_trespass_count?: number;
  is_trespassed?: boolean;
  ban_location_names?: string;
}

export interface BanLetterData {
  patron: PatronDetails;
  ban: PatronBanDetails;
  incident: any;  // Incident type
  template: BanLetterTemplate;
  generated_date: string;
  generated_by: string;
}

export interface PatronBanDetails {
  id: number;
  patron_id: string;
  ban_type: 'system' | 'branch' | 'temporary' | 'permanent';
  starts_at: string;
  lifts_at?: string;
  archives_at?: string;
  duration_days?: number;
  detailed_reason?: string;
  locations: Array<{
    id: number;
    name: string;
    code: string;
  }>;
  incident_id?: number;
  incident_details?: any;
  created_by: string;
  created_by_name: string;
  created_at: string;

  // Appeal information
  appeal_eligible: boolean;
  appeal_deadline?: string;
  appeal_status?: 'not_appealed' | 'pending' | 'approved' | 'denied';
  appeal_date?: string;
  appeal_reason?: string;
  appeal_decision_date?: string;
  appeal_decision_by?: string;
  appeal_notes?: string;

  // Letter information
  letter_sent: boolean;
  letter_sent_date?: string;
  letter_template_id?: number;
  letter_content?: string;

  // Lift information
  lifted: boolean;
  lifted_date?: string;
  lifted_by?: string;
  lifted_by_name?: string;
  lifted_reason?: string;
}

export interface QuickNoteData {
  patron_id: string;
  note: string;
  type: 'general' | 'warning' | 'medical' | 'behavior' | 'positive';
  is_confidential: boolean;
  notify_managers: boolean;
}
