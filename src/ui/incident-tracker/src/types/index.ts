// Core type definitions for incident tracker UI
// Adapted to the Odo platform architecture

import type { RoleAssignment } from '@core';
import type { FileUploadResponse } from '@core/api/upload';
// Import base auto-generated types
import type { Patrons as BasePatron, PatronBan as BasePatronBan } from '@core/types/auto/incidents';

// User/Staff types aligned with Odo auth
export interface User {
  id: number;
  uuid?: string;  // User uuid (from the access token's sub_uuid)
  username: string;
  email: string;
  first_name?: string;
  first_given_name?: string;  // Odo uses first_given_name
  last_name?: string;
  family_name?: string;  // Odo uses family_name
  full_name?: string;
  display_name?: string;  // Database-computed display name
  roles?: RoleAssignment[];  // New: Multiple context-specific roles
  org_unit?: string;   // Working org unit uuid (from the access token)
  org_unit_name?: string;
  permissions?: Permissions;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Permissions {
  can_manage_users: boolean;
  can_access_all_locations: boolean;
  can_edit_staff_incidents: boolean;
  can_review_incidents: boolean;
  can_manage_templates: boolean;
  can_manage_patron_bans: boolean;
  can_create_branch_bans: boolean;
  can_view_global_reports: boolean;
  can_manage_regions: boolean;
}

// Organization unit (location) types
export interface OrgUnitType {
  id: number;
  label: string;
  parent: number | null;
  can_have_staff?: boolean;
  can_have_patrons?: boolean;
}

export interface OrgUnit {
  id: number;
  uuid: string;
  label: string;
  code?: string;  // Short code for the location (replaces short_name)
  display_label?: string;  // Formatted as "code / label"
  parent: number | null;  // Match core's OrgUnit type
  unit_type: number;  // The numeric ID of the unit type
  unit_type_label?: string;
  unit_type_object?: OrgUnitType;  // Full unit type object with can_have_patrons, etc.
  children?: OrgUnit[];
  level?: number;  // For UI display
  deleted_at?: string | null;  // Soft delete timestamp
  region?: string;  // Region name for filtering
  is_active?: boolean;  // Active status
  timezone?: string;  // IANA timezone identifier (e.g. 'America/Los_Angeles')
}

export interface SubLocation {
  id: number;
  name: string;
  org_unit: string;
  description?: string;
  location_code?: string;
}

// Incident types
export interface Incident {
  id: number;
  patronId: number | null;  // Renamed from 'patron' to avoid confusion with joined patron object
  template_ids: number[]; // not a DB column but may contain data from API
  template_name?: string;
  title?: string;
  description: string | null;
  org_unit: string;  // Odo org unit uuid
  org_unit_name?: string;
  location_details?: OrgUnit;  // Full location details
  sub_location?: string;
  sub_location_name?: string;
  metadata?: Record<string, any>;
  created_by: string;
  created_by_name?: string;
  assigned_to?: string;
  assigned_to_name?: string;
  resolved_by?: string;
  resolved_at?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  occurred_at: string;
  updated_at: string;
  deleted_at?: string;

  // Additional fields from KCLS
  emergency_capture?: boolean;
  called_emergency?: boolean;
  photos?: IncidentPhoto[];
  involved_parties?: InvolvedParty[];
  external_links?: ExternalLink[];
  /**
   * Attachments returned from `incident/get` when `with_attachments`
   * is set. Top-level field; the legacy `metadata.attachments` shape
   * is gone. Each entry is the odo-asset file metadata + a `category`
   * convenience field derived from `mime_type`.
   */
  attachments?: Array<{
    id: string;
    original_name: string;
    mime_type?: string;
    size?: number;
    relative_path: string;
    category: string;
  }>;
  coordinator_reviewed?: boolean;
  coordinator_notes?: string;
  resolution_notes?: string;
  resolution_checklist?: string[];
  ai_analysis?: Record<string, any>;
  patron_id?: string;
  patron_notes?: string;
  is_unknown_patron?: boolean;
  requires_follow_up?: boolean;
  follow_up_date?: string;
  notes?: string;
  link_relationship?: string;
  current_review_level?: number;
  latest_review_result?: string;
  creator_level?: number;
  user_review_level?: number;
  is_final_review?: boolean;
  can_review?: boolean;
  can_resubmit?: boolean;

  // Org unit address fields (for ban/trespass letters)
  org_address_line1?: string;
  org_address_line2?: string;
  org_city?: string;
  org_state?: string;
  org_postal_code?: string;
}

export interface IncidentPhoto {
  id: number;
  photo: string;
  caption?: string;
  uploaded_at: string;
}

export interface ExternalLink {
  id?: number;
  url: string;
  title: string;
  description?: string;
  link_type?: number;
  restricted_access?: boolean;
  added_by?: string;
  added_at?: string;
  link_type_label?: string;
  link_type_description?: string;
  link_type_display_order?: number;
}

export interface InvolvedParty {
  id?: number;
  patron_id?: string;  // Patron ID
  party_type?: string;
  staff_id?: string;
  patron_display?: {
    id: string;
    display_name: string;
    library_card?: string;
    is_banned: boolean;
    is_unknown?: boolean;
    is_deleted?: boolean;
  };
  non_patron_name?: string;
  requires_ban: boolean;
  external_name?: string;
  external_contact?: string;
  role?: string;
  notes?: string;
  description?: string;
  ban_processed?: boolean;
  is_unknown_patron?: boolean;
}

/**
 * Data structure for creating/updating involved parties in incident forms.
 * Used when submitting incident data to the API.
 */
export interface InvolvedPartyData {
  party_type: string;
  patron_id?: number;
  staff_id?: string;
  external_name?: string;
  external_contact?: string;
  role?: string;
  notes?: string;
  is_unknown_patron?: boolean;
}

// Template types
export interface IncidentTemplate {
  id: number | string;  // Can be string in Odo
  name: string;
  description: string;
  category: string;
  fields?: TemplateField[];  // Odo uses 'fields' array
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  display_order?: number;
  usage_count?: number;
  requires_patron?: boolean;  // Whether this template requires patron information
  show_called_emergency?: boolean;
  resolution_checklist?: string[];
}

export interface TemplateField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'checkbox' | 'select' | 'radio' | 'number' | 'date' | 'time' | 'boolean';
  required: boolean;
  options?: string[];
  help_text?: string;
  validation?: any;
  placeholder?: string;
}

// Patron types - extends auto-generated type with computed fields
export interface Patron extends Partial<BasePatron> {
  id: number;
  display_name: string; // Computed from first_name, last_name, preferred_name
  alias?: string; // Patron alias/nickname
  age_range?: number; // Age range ID
  age_range_label?: string; // Age range label (e.g., "13-18 years")
  is_banned?: boolean; // Computed from risk_level or ban_status
  is_unknown?: boolean;
  ban_status?: PatronBan;
  incident_count?: number; // Computed from related incidents
  address?: string; // Computed from address fields
}

export interface PatronBan extends Omit<Partial<BasePatronBan>, 'patron' | 'created_at' | 'updated_at'> {
  id: number;
  patron: string | number; // Can be patron ID
  patron_id: number;
  patron_name?: string; // Computed field
  patron_barcode?: string;
  incident?: number;
  incident_title?: string;
  ban_type: string;
  starts_at: string; // DATE when ban starts
  lifts_at?: string; // DATE when ban will be automatically lifted (30 days default)
  archives_at?: string; // DATE when ban will be automatically archived (60 days default)
  archived_by?: string | null; // User who manually archived the ban
  duration_days?: number; // Computed from dates
  comments?: string; // Additional notes about the ban
  locations?: any; // JSONB array
  location_names?: string[]; // Computed field
  status?: 'active' | 'expired' | 'appealed' | 'lifted' | 'pending'; // Computed field
  created_by: string;
  created_by_name?: string; // Computed field
  created_at: string | null;
  updated_at?: string | null;
  lifted_by?: string | null;
  lifted_reason?: string;
  appeal_status?: 'pending' | 'approved' | 'denied';
  has_ban_letter?: boolean;
  branch_name?: string;
  send_letter?: boolean;
  is_active?: boolean; // Computed field
  is_trespass?: boolean; // Trespasses are manually archived only
  org_unit?: string; // Organization unit where ban applies
}

// API Response types
export interface ListResponse<T> {
  items: T[];
  total: number;
  page?: number;
  page_size?: number;
  stats?: {
    open: number;
    in_progress: number;
    pending_review: number;
    resolved: number;
    closed: number;
  };
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  page_size: number;
  total_pages: number;
  current_page: number;
  results: T[];
}

// Category type
export interface Category {
  code: string;
  label: string;
  description: string;
  icon: string;
  display_order: number;
  is_active: boolean;
}

// Settings types
export interface SystemSettings {
  features: {
    emergency_mode: boolean;
    ai_analysis: boolean;
    patron_photos: boolean;
    ban_letters: boolean;
    fresh_start: boolean;
  };
  defaults: {
    page_size: number;
    date_format: string;
    time_format: string;
    timezone: string;
  };
  ui: {
    theme: 'light' | 'dark' | 'auto';
    sidebar_collapsed: boolean;
    show_hints: boolean;
  };
}

// Alert types
export interface Alert {
  id: number;
  type: 'emergency' | 'security' | 'info' | 'warning';
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  location?: number;
  incident?: number;
  created_at: string;
  acknowledged?: boolean;
  acknowledged_by?: number;
  acknowledged_at?: string;
}

// Timeline types
export interface TimelineEvent {
  id: string;
  type: 'incident' | 'note' | 'ban' | 'alert';
  date: string;
  title: string;
  description: string;
  location?: OrgUnit;
  staff?: User;
  metadata?: Record<string, any>;
  isRestricted?: boolean;
}

// Form types
export interface IncidentFormData {
  template_ids: number[]; // Changed from template_id to support multiple templates
  org_unit: string | null;
  sub_location: number | string | null;
  title: string;
  description: string;
  metadata: Record<string, any>;
  involved_parties?: Array<{
    party_type: string;
    patron_id?: number;
    staff_id?: string;
    external_name?: string;
    external_contact?: string;
    role?: string;
    notes?: string;
  }>;
  photos?: File[];
  emergency_capture?: boolean;
  called_emergency?: boolean;
  requires_follow_up?: boolean;
  is_emergency?: boolean;
}


export interface ReviewGroup {
  id: number;
  org_unit: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  member_count?: number;
}

export interface ReviewGroupMember {
  id: number;
  review_group: number;
  usr: string;
  usr_display_name?: string;
  created_at: string;
}

export interface ReviewGroupWithMembers extends ReviewGroup {
  members: ReviewGroupMember[];
}

export interface ReviewChainEntry {
  id: number;
  org_unit: string;
  review_level: number;
  reviewer_group: number;
  reviewer_ids?: string[];
  reviewer_names?: string[];
  is_final: boolean;
  require_peer_review: boolean;
  created_at: string;
  updated_at: string;
}

// Search & Filter types
export interface SearchParams {
  query?: string;
  filters?: Record<string, any>;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface IncidentFilters {
  status?: string[];
  org_unit?: string[];
  template_id?: number[];
  date_from?: string;
  date_to?: string;
  created_by?: string;
  assigned_to?: string;
}

export interface BanLetterDetail {
  id: number;
  ban: number;
  template?: number;
  template_name?: string;
  generated_by: string;
  generated_by_name?: string;
  generated_at: string;
  activity_log_id?: number;
  incident?: number;
  generated_by_org?: string;
  generated_by_org_name?: string;
}

export interface BanDetailsResponseBan extends Omit<PatronBan, 'patron' | 'incident'> {
  patron: string | number | { id: number; display_name?: string; preferred_name?: string; first_name?: string; last_name?: string };
  incident?: number | { id: number; title?: string; org_unit_name?: string } | null;
  patron_name?: string;
  org_unit_name?: string;
  created_by_name?: string;
}

export interface BanDetailsResponse {
  ban: BanDetailsResponseBan;
  letters: BanLetterDetail[];
}

export interface ActivityLogLetter {
  id: number;
  incident?: number;
  generated_at: string;
  generated_by_name?: string;
}

export interface ActivityLogEntry {
  id: number;
  event_type: string;
  actor_id: string;
  actor_name?: string;
  org_unit?: string;
  org_unit_name?: string;
  incident_id?: number;
  ban_id?: number;
  event_data: Record<string, unknown>;
  created_at: string;
  attachments?: FileUploadResponse[];
  external_links?: Array<{ url: string; title: string; description?: string }>;
  letter?: ActivityLogLetter | null;
}

/** Active ban/trespass status for a patron at the incident location. */
export interface PatronBanStatus {
  hasBan: boolean;
  hasTrespass: boolean;
  banId?: number;
  trespassId?: number;
  trespassOrgUnitName?: string;
  banLiftsAt?: string;
  trespassLiftsAt?: string;
}

// Export all types
export * from './api';
export * from './settings';
export * from './patron';
