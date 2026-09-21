/**
 * Shift Notes (the "Communication Log") — see design-docs/shift-notes.md
 */

export interface ShiftNoteType {
  id: number;
  code: string;
  label: string;
  color: string | null;
  display_order: number;
  is_active: boolean;
}

export interface ShiftNoteConductArea {
  id: number;
  code: string;
  label: string;
  display_order: number;
  is_active: boolean;
}

export interface ShiftNoteAttachment {
  /** `asset.file_upload` uuid (durable reference). */
  file_upload: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  relative_path: string;
}

export interface ShiftNote {
  id: number;

  /** `org.unit` uuid (durable reference). */
  org_unit: string;
  org_unit_name: string | null;
  region_name: string | null;

  type: number;
  type_code: string;
  type_label: string;
  type_color: string | null;

  patron_name: string | null;
  patron_description: string | null;
  was_instructed: boolean;
  was_warned: boolean;
  notes: string;

  /** When it happened, as distinct from when it was written down. */
  occurred_at: string;
  created_at: string;
  updated_at: string | null;
  /** `auth.usr` uuid (durable reference). */
  created_by: string;
  staff_name: string | null;

  conduct_areas: number[];
  attachments: ShiftNoteAttachment[];

  /** Server-computed: own note, or the caller holds manage_any. */
  can_edit: boolean;
}

export interface ShiftNoteListParams {
  org_unit: string;
  since?: string;
  types?: number[];
  /** Free-text substring match over the note body and patron name. */
  search?: string;
  /** Return only `total` with empty `rows` — used by the 30s poll. */
  count_only?: boolean;
  limit?: number;
  offset?: number;
  /**
   * Opt in to notes older than the retention window. Requires
   * `current.shift_note.read_archived` server-side. The UI deliberately
   * never sets this.
   */
  include_archived?: boolean;
  /** `occurred_at` (default), `created_at`, `org_unit`, `type`, or `staff`. */
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}

export interface ShiftNoteListResponse {
  rows: ShiftNote[];
  total: number;
  retention_days: number;
  /**
   * Whether this response reached past the retention window. Always false
   * here: the UI never sends `include_archived`, so every user — however
   * privileged — sees the same recent window. Retrieving older notes is a
   * deliberate out-of-band request, not something to back into by holding
   * a permission.
   */
  archived_included: boolean;
  /**
   * Whether the caller holds `current.shift_note.read_archived` at the
   * requested scope — i.e. whether asking would work. Scope-dependent, so
   * it is re-read on every list rather than cached as a global.
   */
  can_read_archived: boolean;
}

export interface ShiftNoteWriteParams {
  org_unit: string;
  type: number;
  notes: string;
  patron_name?: string | null;
  patron_description?: string | null;
  was_instructed?: boolean;
  was_warned?: boolean;
  /** When it happened. Omitted means now. */
  occurred_at?: string;
  conduct_areas?: number[];
  /** `asset.file_upload` uuids. */
  attachments?: string[];
}
