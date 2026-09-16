//! Shift Notes -- the "Communication Log".
//!
//! A low-friction bulletin board: staff record things that happened during a
//! shift so coworkers see them. See `design-docs/shift-notes.md`.
//!
//! Two things shape this module:
//!
//!   * **Retention is permission-gated, not archived.** Rows are never moved
//!     or flagged. Every list read caps at the most recent N days
//!     (`config_shift_note_setting.retention_days`). Reaching past it takes
//!     BOTH an explicit `include_archived` on the request AND
//!     `current.shift_note.read_archived` -- the permission alone never
//!     widens a read, so privileged users see the same recent window as
//!     everyone else by default.
//!   * **Ownership decides edit/delete.** Your own note needs only
//!     `current.shift_note.write`; someone else's needs
//!     `current.shift_note.manage_any`. That rule lives here, not in the
//!     schema, because it depends on the acting user.

use axum::Json;
use axum::extract::State;
use odo_client::context::RequestContext;
use odo_client::error::{ApiResult, LocalError, LocalResult};
use sea_orm::prelude::*;
use sea_orm::{
    ActiveValue::Set, Condition, PaginatorTrait, QueryOrder, QuerySelect, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::{
    config_shift_note_conduct_area, config_shift_note_setting, config_shift_note_type, shift_note,
    shift_note_attachment, shift_note_conduct_area,
};

/// Cap on a single page of notes. The UI pages; this stops a caller from
/// asking for the whole 30-day window at once.
const MAX_PAGE: u64 = 200;
const DEFAULT_PAGE: u64 = 50;

/// Field caps. Postgres TEXT is unbounded, so without these one paste of a
/// log file becomes a row every list response has to carry. Generous enough
/// that no real shift note hits them -- the longest seeded example is well
/// under 1 KB.
const MAX_NOTES_LEN: usize = 10_000;
const MAX_PATRON_NAME_LEN: usize = 200;
const MAX_PATRON_DESCRIPTION_LEN: usize = 1_000;

/// Fallback when the settings row is missing. Matches the seeded default so a
/// truncated config table degrades to current policy rather than to "show
/// everything".
const DEFAULT_RETENTION_DAYS: i64 = 30;

// ===========================================================================
// Shared helpers
// ===========================================================================

fn caller_id() -> LocalResult<Uuid> {
    RequestContext::user_uuid().ok_or(LocalError::unauthenticated())
}

/// The configured retention window. Reads the single settings row; falls back
/// to the seeded default if it is missing.
async fn retention_days<C: sea_orm::ConnectionTrait>(db: &C) -> LocalResult<i64> {
    Ok(config_shift_note_setting::Entity::find_by_id(1)
        .one(db)
        .await?
        .map_or(DEFAULT_RETENTION_DAYS, |r| r.retention_days as i64))
}

/// Reject over-long text before it reaches the database.
fn check_len(field: &str, value: &str, max: usize) -> LocalResult<()> {
    if value.chars().count() > max {
        return Err(LocalError::invalid_input(format!(
            "{field} is too long ({} characters, maximum {max})",
            value.chars().count()
        )));
    }
    Ok(())
}

/// Validate the free-text fields shared by create and update.
fn validate_text(
    notes: &str,
    patron_name: Option<&str>,
    patron_description: Option<&str>,
) -> LocalResult<()> {
    if notes.trim().is_empty() {
        return Err(LocalError::invalid_input("notes is required"));
    }
    check_len("notes", notes, MAX_NOTES_LEN)?;
    if let Some(v) = patron_name {
        check_len("patron_name", v, MAX_PATRON_NAME_LEN)?;
    }
    if let Some(v) = patron_description {
        check_len("patron_description", v, MAX_PATRON_DESCRIPTION_LEN)?;
    }
    Ok(())
}

/// Reject an org unit that is not a place someone works.
///
/// An entry records where something happened, so it must be filed at a
/// physical location — a Branch — not at a Region (an organizational
/// grouping of branches) or at Root. `org.unit_type.can_have_staff` is the
/// platform's expression of "staff can be here", so this defers to it
/// rather than hardcoding type names.
///
/// The UI already disables non-staff units in its pickers; this is the
/// guarantee behind that convenience. Best-effort on a lookup failure: if
/// odo-org cannot be reached we allow the write rather than block entry
/// on a transient outage, since the scope check has already run.
async fn validate_staffed_unit(state: &AppState, org_unit: Uuid) -> LocalResult<()> {
    let Ok(detail) = state.org_client.get_unit_detail_by_uuid(&org_unit).await else {
        return Ok(());
    };
    // odo-org nests the unit under `org_unit`, alongside addresses/hours.
    let unit = &detail["org_unit"];
    let can_have_staff = unit["unit_type"]["can_have_staff"].as_bool();
    if can_have_staff == Some(false) {
        let label = unit["label"].as_str().unwrap_or("that location");
        let kind = unit["unit_type"]["label"].as_str().unwrap_or("location");
        return Err(LocalError::invalid_input(format!(
            "{label} is a {kind}, not a staffed location — file the entry at a branch"
        )));
    }
    Ok(())
}

/// Load a note by id, erroring if it is missing or already soft-deleted.
async fn load_active<C: sea_orm::ConnectionTrait>(db: &C, id: i32) -> LocalResult<shift_note::Model> {
    shift_note::Entity::find_by_id(id)
        .filter(shift_note::Column::DeletedAt.is_null())
        .one(db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("shift note id={id}")))
}

/// Authorize a mutation of `note` by `user_id`.
///
/// Your own note needs only `current.shift_note.write` at the note's org
/// unit. Someone else's additionally needs `current.shift_note.manage_any`.
async fn authorize_mutation(
    state: &AppState,
    note: &shift_note::Model,
    user_id: Uuid,
) -> LocalResult<()> {
    state
        .auth_client
        .permission_required_uuid("current.shift_note.write", Some(&note.org_unit))
        .await?;

    if note.created_by != user_id {
        state
            .auth_client
            .permission_required_uuid("current.shift_note.manage_any", Some(&note.org_unit))
            .await?;
    }
    Ok(())
}

/// Validate that every referenced type/conduct-area id exists and is active.
/// Inactive ids are rejected on write but still render on read, so retiring a
/// type never breaks history.
async fn validate_type<C: sea_orm::ConnectionTrait>(db: &C, type_id: i32) -> LocalResult<()> {
    let ok = config_shift_note_type::Entity::find_by_id(type_id)
        .filter(config_shift_note_type::Column::IsActive.eq(true))
        .one(db)
        .await?
        .is_some();
    if !ok {
        return Err(LocalError::invalid_input(format!(
            "unknown or inactive shift note type id={type_id}"
        )));
    }
    Ok(())
}

async fn validate_conduct_areas<C: sea_orm::ConnectionTrait>(
    db: &C,
    ids: &[i32],
) -> LocalResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let found: HashSet<i32> = config_shift_note_conduct_area::Entity::find()
        .filter(config_shift_note_conduct_area::Column::Id.is_in(ids.to_vec()))
        .filter(config_shift_note_conduct_area::Column::IsActive.eq(true))
        .all(db)
        .await?
        .into_iter()
        .map(|m| m.id)
        .collect();

    let mut missing: Vec<i32> = ids.iter().copied().filter(|i| !found.contains(i)).collect();
    if !missing.is_empty() {
        missing.sort_unstable();
        missing.dedup();
        return Err(LocalError::invalid_input(format!(
            "unknown or inactive conduct area id(s): {missing:?}"
        )));
    }
    Ok(())
}

/// Verify the caller owns every referenced upload. Mirrors the incident
/// attachment check: a file id the caller did not upload must not be
/// attachable to their note.
async fn validate_attachments(state: &AppState, user_id: Uuid, ids: &[Uuid]) -> LocalResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    // uploaded_by_uuid is optional on the asset contract; a file with no
    // recorded uploader can never match the caller, so it stays out of the
    // map and the ownership check below rejects it.
    let owners: HashMap<Uuid, Uuid> = state
        .asset_client
        .get_files_by_uuid(ids)
        .await?
        .into_iter()
        .filter_map(|f| f.uploaded_by_uuid.map(|u| (f.uuid, u)))
        .collect();

    let mut missing: Vec<Uuid> = ids.iter().copied().filter(|id| !owners.contains_key(id)).collect();
    if !missing.is_empty() {
        missing.sort_unstable();
        missing.dedup();
        return Err(LocalError::invalid_input(format!(
            "unknown or deleted file_upload id(s): {missing:?}"
        )));
    }

    let mut not_owned: Vec<Uuid> = ids
        .iter()
        .copied()
        .filter(|id| owners.get(id) != Some(&user_id))
        .collect();
    if !not_owned.is_empty() {
        not_owned.sort_unstable();
        not_owned.dedup();
        return Err(LocalError::invalid_input(format!(
            "file_upload id(s) not owned by caller: {not_owned:?}"
        )));
    }
    Ok(())
}

/// Replace a note's conduct-area links with `ids`.
async fn set_conduct_areas<C: sea_orm::ConnectionTrait>(
    db: &C,
    note_id: i32,
    ids: &[i32],
) -> LocalResult<()> {
    shift_note_conduct_area::Entity::delete_many()
        .filter(shift_note_conduct_area::Column::ShiftNote.eq(note_id))
        .exec(db)
        .await?;

    let mut unique: Vec<i32> = ids.to_vec();
    unique.sort_unstable();
    unique.dedup();

    for area in unique {
        shift_note_conduct_area::ActiveModel {
            shift_note: Set(note_id),
            conduct_area: Set(area),
            ..Default::default()
        }
        .insert(db)
        .await?;
    }
    Ok(())
}

/// Replace a note's attachment links with `ids`.
async fn set_attachments<C: sea_orm::ConnectionTrait>(
    db: &C,
    note_id: i32,
    ids: &[Uuid],
) -> LocalResult<()> {
    shift_note_attachment::Entity::delete_many()
        .filter(shift_note_attachment::Column::ShiftNote.eq(note_id))
        .exec(db)
        .await?;

    let mut unique: Vec<Uuid> = ids.to_vec();
    unique.sort_unstable();
    unique.dedup();

    for file in unique {
        shift_note_attachment::ActiveModel {
            shift_note: Set(note_id),
            file_upload: Set(file),
            ..Default::default()
        }
        .insert(db)
        .await?;
    }
    Ok(())
}

// ===========================================================================
// Response shapes
// ===========================================================================

#[derive(Debug, Serialize, ToSchema)]
pub struct ShiftNoteTypeResponse {
    pub id: i32,
    pub code: String,
    pub label: String,
    pub color: Option<String>,
    pub display_order: i32,
    pub is_active: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListShiftNoteTypesResponse {
    pub items: Vec<ShiftNoteTypeResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShiftNoteConductAreaResponse {
    pub id: i32,
    pub code: String,
    pub label: String,
    pub display_order: i32,
    pub is_active: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListShiftNoteConductAreasResponse {
    pub items: Vec<ShiftNoteConductAreaResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShiftNoteAttachmentResponse {
    pub file_upload: Uuid,
    pub file_name: String,
    pub file_type: Option<String>,
    pub file_size: Option<i32>,
    pub relative_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShiftNoteRow {
    pub id: i32,

    pub org_unit: Uuid,
    /// Branch label, resolved via odo-org. None when the unit no longer
    /// resolves (see the db-decoupling note in migration 101).
    pub org_unit_name: Option<String>,
    /// Label of the note's Region-type ancestor, resolved via odo-org.
    pub region_name: Option<String>,

    pub r#type: i32,
    pub type_code: String,
    pub type_label: String,
    pub type_color: Option<String>,

    pub patron_name: Option<String>,
    pub patron_description: Option<String>,
    pub was_instructed: bool,
    pub was_warned: bool,
    pub notes: String,

    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub created_by: Uuid,
    /// Author's display name, resolved via odo-auth. None when the user no
    /// longer resolves.
    pub staff_name: Option<String>,

    pub conduct_areas: Vec<i32>,
    pub attachments: Vec<ShiftNoteAttachmentResponse>,

    /// True when the caller may edit/delete this row -- own note, or
    /// `manage_any`. Saves the UI from re-deriving the ownership rule.
    pub can_edit: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListShiftNotesResponse {
    pub rows: Vec<ShiftNoteRow>,
    /// Total matching the filters, ignoring limit/offset.
    pub total: u64,
    /// The retention window applied to this response, so the UI can say
    /// "showing the last 30 days".
    pub retention_days: i64,
    /// True when this response actually spans beyond the retention window
    /// -- the caller asked via `include_archived` and holds the permission.
    pub archived_included: bool,
    /// Whether the caller holds `current.shift_note.read_archived` at the
    /// requested scope, i.e. whether asking would work. Lets the UI offer
    /// the "include archived" control only to those who can use it, and
    /// re-evaluate per location rather than assuming it is global.
    pub can_read_archived: bool,
}

// ===========================================================================
// Config list endpoints
// ===========================================================================

#[utoipa::path(
    post,
    path = "/api/v1/current/shift-note/type/list",
    responses((
        status = 200,
        body = ListShiftNoteTypesResponse,
        description = "Active shift note types, ordered for display"
    )),
    security(("bearer" = [])),
    tag = "shift-notes"
)]
pub async fn list_shift_note_types(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<ListShiftNoteTypesResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.shift_note.read", None)
        .await?;

    let items = config_shift_note_type::Entity::find()
        .filter(config_shift_note_type::Column::IsActive.eq(true))
        .order_by_asc(config_shift_note_type::Column::DisplayOrder)
        .all(&state.db)
        .await?
        .into_iter()
        .map(|m| ShiftNoteTypeResponse {
            id: m.id,
            code: m.code,
            label: m.label,
            color: m.color,
            display_order: m.display_order,
            is_active: m.is_active,
        })
        .collect();

    Ok(Json(ListShiftNoteTypesResponse { items }))
}

#[utoipa::path(
    post,
    path = "/api/v1/current/shift-note/conduct-area/list",
    responses((
        status = 200,
        body = ListShiftNoteConductAreasResponse,
        description = "Active Code of Conduct areas, ordered for display"
    )),
    security(("bearer" = [])),
    tag = "shift-notes"
)]
pub async fn list_shift_note_conduct_areas(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<ListShiftNoteConductAreasResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.shift_note.read", None)
        .await?;

    let items = config_shift_note_conduct_area::Entity::find()
        .filter(config_shift_note_conduct_area::Column::IsActive.eq(true))
        .order_by_asc(config_shift_note_conduct_area::Column::DisplayOrder)
        .all(&state.db)
        .await?
        .into_iter()
        .map(|m| ShiftNoteConductAreaResponse {
            id: m.id,
            code: m.code,
            label: m.label,
            display_order: m.display_order,
            is_active: m.is_active,
        })
        .collect();

    Ok(Json(ListShiftNoteConductAreasResponse { items }))
}

// ===========================================================================
// List
// ===========================================================================

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ListShiftNotesRequest {
    /// Scope to this org unit and its descendants. Required -- the UI passes
    /// the user's region by default.
    pub org_unit: Uuid,
    /// Only notes created strictly after this timestamp. The 30s poll passes
    /// the newest `created_at` it has seen, so a quiet poll returns no rows.
    #[serde(default)]
    pub since: Option<chrono::DateTime<chrono::FixedOffset>>,
    /// Restrict to these entry types.
    #[serde(default)]
    pub types: Option<Vec<i32>>,
    /// Opt in to notes older than the retention window. Requires
    /// `current.shift_note.read_archived`; ignored (not an error) without
    /// it, so a caller never silently gets a wider result than it asked
    /// for. Default false means every caller — however privileged — sees
    /// only the recent window unless it deliberately asks otherwise.
    #[serde(default)]
    pub include_archived: bool,
    /// Return only `total`, with an empty `rows`. The 30s poll needs a
    /// count, not content -- without this it drags a full row body across
    /// the wire every tick, for every user on shift.
    #[serde(default)]
    pub count_only: bool,
    /// Free-text search over the note body and patron name. Matched as a
    /// case-insensitive substring against both, so a phrase the author
    /// typed finds the note whichever field it landed in. Blank or
    /// whitespace-only is treated as no search.
    #[serde(default)]
    pub search: Option<String>,
    /// Sort column: `created_at` (default), `org_unit`, `type`, or
    /// `staff`. Anything else is rejected rather than silently ignored, so
    /// a typo in a caller does not quietly return date-ordered rows.
    #[serde(default)]
    pub sort_by: Option<String>,
    /// `asc` or `desc`. Defaults to `desc` for dates (newest first) and
    /// `asc` otherwise, which is what each reads naturally as.
    #[serde(default)]
    pub sort_dir: Option<String>,
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub offset: Option<u64>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/shift-note/list",
    request_body = ListShiftNotesRequest,
    responses((
        status = 200,
        body = ListShiftNotesResponse,
        description = "Shift notes at or below the org unit, newest first"
    )),
    security(("bearer" = [])),
    tag = "shift-notes"
)]
pub async fn list_shift_notes(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ListShiftNotesRequest>,
) -> ApiResult<Json<ListShiftNotesResponse>> {
    let user_id = caller_id()?;

    state
        .auth_client
        .permission_required_uuid("current.shift_note.read", Some(&params.org_unit))
        .await?;

    // Retention: the window applies unless the caller BOTH asks for
    // archived notes and holds the permission. Holding the permission is
    // not enough on its own -- widening the window for every read by a
    // privileged user is how a coordinator ends up scrolling a year of
    // history when they wanted this week's.
    let can_read_archived = state
        .auth_client
        .user_has_permission_uuid("current.shift_note.read_archived", Some(&params.org_unit))
        .await
        .unwrap_or(false);
    let archived_included = params.include_archived && can_read_archived;
    let days = retention_days(&state.db).await?;

    // Whether the caller can mutate other people's notes in this scope. Used
    // only to populate `can_edit`; the real check happens on write.
    let manage_any = state
        .auth_client
        .user_has_permission_uuid("current.shift_note.manage_any", Some(&params.org_unit))
        .await
        .unwrap_or(false);

    let scope = state.org_client.descendant_uuids(&params.org_unit).await?;

    let mut cond = Condition::all()
        .add(shift_note::Column::DeletedAt.is_null())
        .add(shift_note::Column::OrgUnit.is_in(scope));

    if !archived_included {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days);
        cond = cond.add(shift_note::Column::CreatedAt.gte(cutoff.fixed_offset()));
    }
    if let Some(since) = params.since {
        cond = cond.add(shift_note::Column::CreatedAt.gt(since));
    }
    if let Some(types) = params.types.as_ref().filter(|t| !t.is_empty()) {
        cond = cond.add(shift_note::Column::Type.is_in(types.clone()));
    }

    // Free text: substring match on the body OR the patron name.
    //
    // ILIKE rather than the `contains` helper -- that one emits a
    // case-sensitive LIKE, so "bicycle" would miss "Bicycle". The
    // gin_trgm_ops indexes on LOWER(notes) and LOWER(patron_name)
    // (migrations 101 and 102) support ILIKE substring matching.
    //
    // The term is escaped first: % and _ are LIKE wildcards, so an
    // unescaped "100%" would match far more than the user meant.
    // Backslash is replaced first so it does not re-escape the escapes.
    if let Some(term) = params.search.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        let escaped = term
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{escaped}%");
        cond = cond.add(
            Condition::any()
                .add(shift_note::Column::Notes.ilike(&pattern))
                .add(shift_note::Column::PatronName.ilike(&pattern)),
        );
    }

    let limit = params.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let offset = params.offset.unwrap_or(0);

    let total = shift_note::Entity::find()
        .filter(cond.clone())
        .count(&state.db)
        .await?;

    // Count-only: skip the row fetch and every cross-service lookup that
    // decorates it.
    if params.count_only {
        return Ok(Json(ListShiftNotesResponse {
            rows: vec![],
            total,
            retention_days: days,
            archived_included,
            can_read_archived,
        }));
    }

    // Sorting happens in the database so it spans the whole result set,
    // not just the page in hand.
    //
    // `staff` sorts by created_by, not by display name: the name lives in
    // odo-auth and is resolved per page, so ordering by it would only ever
    // order the rows already fetched. Grouping a person's notes together
    // is what the sort is for, and created_by does that; the caveat is
    // that the groups are not alphabetical.
    let sort_key = params.sort_by.as_deref().unwrap_or("created_at");
    let descending = match params.sort_dir.as_deref() {
        Some("desc") => true,
        Some("asc") => false,
        None => sort_key == "created_at",
        Some(other) => {
            return Err(LocalError::invalid_input(format!(
                "unknown sort_dir '{other}' (expected 'asc' or 'desc')"
            ))
            .into());
        }
    };

    let sort_col = match sort_key {
        "created_at" => shift_note::Column::CreatedAt,
        "org_unit" => shift_note::Column::OrgUnit,
        "type" => shift_note::Column::Type,
        "staff" => shift_note::Column::CreatedBy,
        other => {
            return Err(LocalError::invalid_input(format!(
                "unknown sort_by '{other}' (expected created_at, org_unit, type, or staff)"
            ))
            .into());
        }
    };

    let mut query = shift_note::Entity::find().filter(cond);
    query = if descending {
        query.order_by_desc(sort_col)
    } else {
        query.order_by_asc(sort_col)
    };
    // Id breaks ties so paging is stable — without it, rows sharing a sort
    // value can reshuffle between pages and appear twice or not at all.
    let notes = query
        .order_by_desc(shift_note::Column::Id)
        .limit(limit)
        .offset(offset)
        .all(&state.db)
        .await?;

    let rows = decorate(&state, notes, user_id, manage_any).await?;

    Ok(Json(ListShiftNotesResponse {
        rows,
        total,
        retention_days: days,
        archived_included,
        can_read_archived,
    }))
}

/// Turn note models into response rows, batch-resolving everything that lives
/// outside this table: types, conduct areas, attachments, org labels (branch
/// + region), and author names.
///
/// Every cross-service lookup here is batched. This endpoint is polled every
/// 30 seconds by every user on shift, so an N+1 would multiply out fast.
async fn decorate(
    state: &AppState,
    notes: Vec<shift_note::Model>,
    user_id: Uuid,
    manage_any: bool,
) -> LocalResult<Vec<ShiftNoteRow>> {
    if notes.is_empty() {
        return Ok(vec![]);
    }
    let note_ids: Vec<i32> = notes.iter().map(|n| n.id).collect();

    // Types: read *all* types, not just active ones, so a retired type still
    // renders on the notes that used it.
    let types: HashMap<i32, config_shift_note_type::Model> = config_shift_note_type::Entity::find()
        .all(&state.db)
        .await?
        .into_iter()
        .map(|t| (t.id, t))
        .collect();

    // Conduct areas per note.
    let mut areas: HashMap<i32, Vec<i32>> = HashMap::new();
    for link in shift_note_conduct_area::Entity::find()
        .filter(shift_note_conduct_area::Column::ShiftNote.is_in(note_ids.clone()))
        .all(&state.db)
        .await?
    {
        areas.entry(link.shift_note).or_default().push(link.conduct_area);
    }

    // Attachments per note, with file metadata resolved in one asset call.
    let links = shift_note_attachment::Entity::find()
        .filter(shift_note_attachment::Column::ShiftNote.is_in(note_ids))
        .all(&state.db)
        .await?;
    let file_ids: Vec<Uuid> = {
        let mut v: Vec<Uuid> = links.iter().map(|l| l.file_upload).collect();
        v.sort_unstable();
        v.dedup();
        v
    };
    let files: HashMap<Uuid, odo_client::client::FileUploadMetadata> = if file_ids.is_empty() {
        HashMap::new()
    } else {
        state
            .asset_client
            .get_files_by_uuid(&file_ids)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|f| (f.uuid, f))
            .collect()
    };
    let mut attachments: HashMap<i32, Vec<ShiftNoteAttachmentResponse>> = HashMap::new();
    for link in links {
        if let Some(f) = files.get(&link.file_upload) {
            attachments
                .entry(link.shift_note)
                .or_default()
                .push(ShiftNoteAttachmentResponse {
                    file_upload: f.uuid,
                    file_name: f.file_name.clone(),
                    file_type: f.file_type.clone(),
                    file_size: f.file_size,
                    relative_path: f.relative_path.clone(),
                });
        }
    }

    // Author display names -- one batched call.
    let user_ids: Vec<Uuid> = {
        let mut v: Vec<Uuid> = notes.iter().map(|n| n.created_by).collect();
        v.sort_unstable();
        v.dedup();
        v
    };
    let user_names = state
        .auth_client
        .fetch_display_names_by_uuid(&user_ids, true)
        .await
        .unwrap_or_default();

    // Branch + region labels. The region is the Region-type ancestor of the
    // note's unit; ancestors are fetched per distinct unit (a page usually
    // spans few), then all labels resolve in one batch.
    let unit_ids: Vec<Uuid> = {
        let mut v: Vec<Uuid> = notes.iter().map(|n| n.org_unit).collect();
        v.sort_unstable();
        v.dedup();
        v
    };
    let regions = resolve_regions(state, &unit_ids).await;
    let label_ids: Vec<Uuid> = {
        let mut v = unit_ids.clone();
        v.extend(regions.values().copied());
        v.sort_unstable();
        v.dedup();
        v
    };
    let labels = state
        .org_client
        .fetch_labels_by_uuid(&label_ids)
        .await
        .unwrap_or_default();

    Ok(notes
        .into_iter()
        .map(|n| {
            let t = types.get(&n.r#type);
            ShiftNoteRow {
                can_edit: manage_any || n.created_by == user_id,

                org_unit_name: labels.get(&n.org_unit).cloned(),
                region_name: regions
                    .get(&n.org_unit)
                    .and_then(|r| labels.get(r))
                    .cloned(),

                type_code: t.map(|t| t.code.clone()).unwrap_or_default(),
                type_label: t.map(|t| t.label.clone()).unwrap_or_default(),
                type_color: t.and_then(|t| t.color.clone()),

                staff_name: user_names.get(&n.created_by).cloned(),
                conduct_areas: areas.get(&n.id).cloned().unwrap_or_default(),
                attachments: attachments.remove_entry(&n.id).map(|(_, v)| v).unwrap_or_default(),

                id: n.id,
                org_unit: n.org_unit,
                r#type: n.r#type,
                patron_name: n.patron_name,
                patron_description: n.patron_description,
                was_instructed: n.was_instructed,
                was_warned: n.was_warned,
                notes: n.notes,
                created_at: n.created_at,
                updated_at: n.updated_at,
                created_by: n.created_by,
            }
        })
        .collect())
}

/// Map each org unit to its Region-type ancestor.
///
/// odo-org's ancestor list is root-first and carries no unit_type, so the
/// region is taken positionally: root is depth 0, region depth 1. A unit that
/// *is* a region maps to itself; a unit directly under root (or an
/// unresolvable one) maps to nothing.
///
/// Best-effort: a failed lookup drops the region label rather than failing
/// the list.
async fn resolve_regions(state: &AppState, unit_ids: &[Uuid]) -> HashMap<Uuid, Uuid> {
    let mut out = HashMap::new();
    for &id in unit_ids {
        if let Ok(ancestors) = state.org_client.ancestor_uuids(&id).await
            && let Some(&region) = ancestors.get(1)
        {
            out.insert(id, region);
        }
    }
    out
}

// ===========================================================================
// Create
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateShiftNoteRequest {
    /// Where it happened. Defaults to the caller's working location in the
    /// UI, but is explicit here so back-filling from another branch works.
    pub org_unit: Uuid,
    pub r#type: i32,
    pub notes: String,
    #[serde(default)]
    pub patron_name: Option<String>,
    #[serde(default)]
    pub patron_description: Option<String>,
    #[serde(default)]
    pub was_instructed: bool,
    #[serde(default)]
    pub was_warned: bool,
    #[serde(default)]
    pub conduct_areas: Vec<i32>,
    /// `asset.file_upload` uuids, already uploaded by the caller.
    #[serde(default)]
    pub attachments: Vec<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateShiftNoteResponse {
    pub id: i32,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/shift-note/create",
    request_body = CreateShiftNoteRequest,
    responses((status = 200, body = CreateShiftNoteResponse, description = "Created shift note")),
    security(("bearer" = [])),
    tag = "shift-notes"
)]
pub async fn create_shift_note(
    State(state): State<Arc<AppState>>,
    Json(params): Json<CreateShiftNoteRequest>,
) -> ApiResult<Json<CreateShiftNoteResponse>> {
    let user_id = caller_id()?;

    state
        .auth_client
        .permission_required_uuid("current.shift_note.write", Some(&params.org_unit))
        .await?;

    validate_text(
        &params.notes,
        params.patron_name.as_deref(),
        params.patron_description.as_deref(),
    )?;

    validate_staffed_unit(&state, params.org_unit).await?;
    validate_type(&state.db, params.r#type).await?;
    validate_conduct_areas(&state.db, &params.conduct_areas).await?;
    validate_attachments(&state, user_id, &params.attachments).await?;

    let txn = state.db.begin().await?;

    let note = shift_note::ActiveModel {
        org_unit: Set(params.org_unit),
        r#type: Set(params.r#type),
        patron_name: Set(params.patron_name.filter(|s| !s.trim().is_empty())),
        patron_description: Set(params.patron_description.filter(|s| !s.trim().is_empty())),
        was_instructed: Set(params.was_instructed),
        was_warned: Set(params.was_warned),
        notes: Set(params.notes),
        created_by: Set(user_id),
        ..Default::default()
    }
    .insert(&txn)
    .await?;

    set_conduct_areas(&txn, note.id, &params.conduct_areas).await?;
    set_attachments(&txn, note.id, &params.attachments).await?;

    txn.commit().await?;

    Ok(Json(CreateShiftNoteResponse { id: note.id }))
}

// ===========================================================================
// Update
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateShiftNoteRequest {
    pub id: i32,
    pub r#type: i32,
    pub notes: String,
    #[serde(default)]
    pub patron_name: Option<String>,
    #[serde(default)]
    pub patron_description: Option<String>,
    #[serde(default)]
    pub was_instructed: bool,
    #[serde(default)]
    pub was_warned: bool,
    #[serde(default)]
    pub conduct_areas: Vec<i32>,
    #[serde(default)]
    pub attachments: Vec<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateShiftNoteResponse {
    pub id: i32,
}

/// Edit a note. `org_unit` and `created_by` are deliberately **not**
/// editable: moving a note after the fact rewrites history other people have
/// already read.
#[utoipa::path(
    post,
    path = "/api/v1/current/shift-note/update",
    request_body = UpdateShiftNoteRequest,
    responses((status = 200, body = UpdateShiftNoteResponse, description = "Updated shift note")),
    security(("bearer" = [])),
    tag = "shift-notes"
)]
pub async fn update_shift_note(
    State(state): State<Arc<AppState>>,
    Json(params): Json<UpdateShiftNoteRequest>,
) -> ApiResult<Json<UpdateShiftNoteResponse>> {
    let user_id = caller_id()?;

    let note = load_active(&state.db, params.id).await?;
    authorize_mutation(&state, &note, user_id).await?;

    validate_text(
        &params.notes,
        params.patron_name.as_deref(),
        params.patron_description.as_deref(),
    )?;

    validate_type(&state.db, params.r#type).await?;
    validate_conduct_areas(&state.db, &params.conduct_areas).await?;

    // Only *newly added* files are ownership-checked. update replaces the
    // attachment set, so the payload also carries files already on the note
    // -- which a coordinator editing someone else's note did not upload and
    // never could. Re-checking those would make every such edit fail.
    // Keeping an existing attachment is not the same act as attaching a new
    // file, and the right to edit the note already covers it.
    let existing: HashSet<Uuid> = shift_note_attachment::Entity::find()
        .filter(shift_note_attachment::Column::ShiftNote.eq(params.id))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|a| a.file_upload)
        .collect();
    let newly_added: Vec<Uuid> = params
        .attachments
        .iter()
        .copied()
        .filter(|id| !existing.contains(id))
        .collect();
    validate_attachments(&state, user_id, &newly_added).await?;

    let txn = state.db.begin().await?;

    let mut active: shift_note::ActiveModel = note.into();
    active.r#type = Set(params.r#type);
    active.notes = Set(params.notes);
    active.patron_name = Set(params.patron_name.filter(|s| !s.trim().is_empty()));
    active.patron_description = Set(params.patron_description.filter(|s| !s.trim().is_empty()));
    active.was_instructed = Set(params.was_instructed);
    active.was_warned = Set(params.was_warned);
    active.updated_at = Set(Some(chrono::Utc::now().fixed_offset()));
    active.updated_by = Set(Some(user_id));
    active.update(&txn).await?;

    set_conduct_areas(&txn, params.id, &params.conduct_areas).await?;
    set_attachments(&txn, params.id, &params.attachments).await?;

    txn.commit().await?;

    Ok(Json(UpdateShiftNoteResponse { id: params.id }))
}

// ===========================================================================
// Delete (soft)
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteShiftNoteRequest {
    pub id: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteShiftNoteResponse {
    pub id: i32,
    pub deleted: bool,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/shift-note/delete",
    request_body = DeleteShiftNoteRequest,
    responses((status = 200, body = DeleteShiftNoteResponse, description = "Soft-deleted shift note")),
    security(("bearer" = [])),
    tag = "shift-notes"
)]
pub async fn delete_shift_note(
    State(state): State<Arc<AppState>>,
    Json(params): Json<DeleteShiftNoteRequest>,
) -> ApiResult<Json<DeleteShiftNoteResponse>> {
    let user_id = caller_id()?;

    let note = load_active(&state.db, params.id).await?;
    authorize_mutation(&state, &note, user_id).await?;

    let mut active: shift_note::ActiveModel = note.into();
    active.deleted_at = Set(Some(chrono::Utc::now().fixed_offset()));
    active.deleted_by = Set(Some(user_id));
    active.update(&state.db).await?;

    Ok(Json(DeleteShiftNoteResponse {
        id: params.id,
        deleted: true,
    }))
}
