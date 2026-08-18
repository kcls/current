/**
 * TypeScript interfaces for incidents schema
 * Auto-generated - DO NOT EDIT
 * Generated on: 2026-03-13T20:44:40.371640
 *
 * Hand-updated 2026-08 for the uuid migration: user/org/file reference
 * columns (created_by, updated_by, deleted_by, lifted_by, archived_by,
 * org_unit) are now uuid strings on the wire.
 */

// ============================================
// incidents.ban_letter_template
// ============================================

export interface BanLetterTemplate {
  /** @default nextval('incidents.ban_letter_template_id_seq'::regclass) */
  id: number;
  subject: string | null;
  body: string;
  /** @default false */
  is_default: boolean;
  created_by: string;
  /** @default now() */
  created_at: string;
  updated_by: string;
  /** @default now() */
  updated_at: string;
  deleted_by: string | null;
  deleted_at: string | null;
  name: string | null;
  /** @default false */
  is_trespass: boolean;
  /** @default 'created'::text */
  operation_type: string;
}

// ============================================
// incidents.patron_ban
// ============================================

export interface PatronBan {
  /** @default nextval('incidents.patron_ban_id_seq'::regclass) */
  id: number;
  patron: number;
  incident: number;
  org_unit: string;
  /** @default now() */
  starts_at: string;
  comments: string | null;
  created_by: string;
  /** @default now() */
  created_at: string;
  updated_by: string;
  /** @default now() */
  updated_at: string;
  lifted_by: string | null;
  /** @default false */
  is_trespass: boolean;
  archived_by: string | null;
  archives_at: string | null;
  /** @default (((((CURRENT_DATE + '30 days'::interval))::date || ' 00:00:00'::text))::timestamp without time zone AT TIME ZONE 'America/Los_Angeles'::text) */
  lifts_at: string;
}

// ============================================
// incidents.patrons
// ============================================

export interface Patrons {
  /** @default nextval('incidents.patrons_id_seq'::regclass) */
  id: number;
  library_card: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  preferred_name: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  /** @default 'US'::character varying */
  country: string | null;
  photo_url: string | null;
  identification_type: string | null;
  identification_number: string | null;
  /** @default 'low'::character varying */
  risk_level: string | null;
  notes: string | null;
  /** @default '{}'::jsonb */
  metadata: any | null;
  created_by: string | null;
  /** @default CURRENT_TIMESTAMP */
  created_at: string | null;
  /** @default CURRENT_TIMESTAMP */
  updated_at: string | null;
  deleted_at: string | null;
  /** @default ''::text */
  display_name: string;
  /** @default false */
  is_unknown: boolean;
  /** @default 1 */
  age_range: number;
  alias: string | null;
}
