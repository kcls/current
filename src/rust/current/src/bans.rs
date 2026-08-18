//! Patron-ban endpoints: full CRUD, archiving, extending, and letter generation.
//!
//! Ban-letter templates currently live here too; if/when the letter
//! surface grows (CRUD on templates, letter generation flows) we can
//! split them into their own module.

use axum::Json;
use axum::extract::State;
use odo_client::context::RequestContext;
use odo_client::error::{ApiResult, LocalError, LocalResult};
use sea_orm::prelude::*;
use sea_orm::{Condition, QueryOrder, QuerySelect, Set, TransactionTrait};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::{
    activity_log, attachments, ban_letter_template, external_link, generated_ban_letter,
    notification_email_routing, patron_ban, patrons,
};

// ===========================================================================
// Ban letter templates
// ===========================================================================

#[derive(Debug, Serialize, ToSchema)]
pub struct BanLetterTemplateResponse {
    pub id: i32,
    pub name: Option<String>,
    pub subject: Option<String>,
    pub body: String,
    pub is_default: bool,
    pub is_trespass: bool,
    pub operation_type: String,
    pub created_by: Uuid,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_by: Uuid,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

impl From<ban_letter_template::Model> for BanLetterTemplateResponse {
    fn from(m: ban_letter_template::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            subject: m.subject,
            body: m.body,
            is_default: m.is_default,
            is_trespass: m.is_trespass,
            operation_type: m.operation_type,
            created_by: m.created_by,
            created_at: m.created_at,
            updated_by: m.updated_by,
            updated_at: m.updated_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListBanLetterTemplatesResponse {
    pub templates: Vec<BanLetterTemplateResponse>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/letter/template/list",
    responses((
        status = 200,
        body = ListBanLetterTemplatesResponse,
        description = "Ban letter templates"
    )),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn list_ban_letter_templates(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<ListBanLetterTemplatesResponse>> {
    // Templates are not org-scoped. Gate on the global ban-read perm so a
    // user without any ban access doesn't see template contents (which
    // might include policy/legal wording).
    state
        .auth_client
        .permission_required_uuid("current.ban.read", None)
        .await?;

    let templates = ban_letter_template::Entity::find()
        .filter(ban_letter_template::Column::DeletedAt.is_null())
        .order_by_asc(ban_letter_template::Column::Id)
        .all(&state.db)
        .await?
        .into_iter()
        .map(BanLetterTemplateResponse::from)
        .collect();

    Ok(Json(ListBanLetterTemplatesResponse { templates }))
}

// ===========================================================================
// Ban details (ban + associated letters)
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetBanDetailsRequest {
    pub ban_id: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BanDetailRow {
    pub id: i32,
    pub patron: i32,
    pub incident: i32,
    pub org_unit: Uuid,
    pub is_trespass: bool,
    pub starts_at: chrono::DateTime<chrono::FixedOffset>,
    pub lifts_at: chrono::DateTime<chrono::FixedOffset>,
    pub archives_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub archived_by: Option<Uuid>,
    pub lifted_by: Option<Uuid>,
    pub comments: Option<String>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub created_by: Uuid,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,

    // Resolved labels (best-effort).
    pub patron_name: Option<String>,
    pub org_unit_name: Option<String>,
    pub created_by_name: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BanLetterDetailRow {
    pub id: i32,
    pub ban: i32,
    pub template: Option<i32>,
    pub generated_by: Uuid,
    pub generated_at: chrono::DateTime<chrono::FixedOffset>,
    pub activity_log_id: Option<i64>,
    pub incident: Option<i32>,
    pub generated_by_org: Option<Uuid>,

    pub template_name: Option<String>,
    pub generated_by_name: Option<String>,
    pub generated_by_org_name: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BanDetailsResponse {
    pub ban: BanDetailRow,
    pub letters: Vec<BanLetterDetailRow>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/details",
    request_body = GetBanDetailsRequest,
    responses((
        status = 200,
        body = BanDetailsResponse,
        description = "Ban with patron, org, creator, and generated letters")),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn get_ban_details(
    State(state): State<Arc<AppState>>,
    Json(params): Json<GetBanDetailsRequest>,
) -> ApiResult<Json<BanDetailsResponse>> {
    let ban = patron_ban::Entity::find_by_id(params.ban_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("Ban {}", params.ban_id)))?;

    state
        .auth_client
        .permission_required_uuid("current.ban.read", Some(&ban.org_unit))
        .await?;

    // Patron name from local DB.
    let patron_name = patrons::Entity::find_by_id(ban.patron)
        .filter(patrons::Column::DeletedAt.is_null())
        .one(&state.db)
        .await?
        .map(|p| p.display_name);

    // Letters for this ban, newest first. `content` is intentionally
    // omitted — clients fetch letter bodies via ban.letter.get on demand.
    let letter_rows = generated_ban_letter::Entity::find()
        .filter(generated_ban_letter::Column::Ban.eq(ban.id))
        .order_by_desc(generated_ban_letter::Column::GeneratedAt)
        .all(&state.db)
        .await?;

    // Resolve template names in one DB query.
    let template_ids: HashSet<i32> = letter_rows.iter().filter_map(|l| l.template).collect();
    let template_names: HashMap<i32, String> = if template_ids.is_empty() {
        HashMap::new()
    } else {
        ban_letter_template::Entity::find()
            .filter(ban_letter_template::Column::Id.is_in(template_ids))
            .all(&state.db)
            .await?
            .into_iter()
            .filter_map(|t| t.name.map(|n| (t.id, n)))
            .collect()
    };

    // Resolve display names for ban creator + all distinct letter generators
    // in one auth call apiece. Best-effort; missing names render as None.
    let mut user_ids: HashSet<Uuid> = letter_rows.iter().map(|l| l.generated_by).collect();
    user_ids.insert(ban.created_by);
    let mut user_names: HashMap<Uuid, String> = HashMap::with_capacity(user_ids.len());
    for id in user_ids {
        if let Ok(user) = state.auth_client.get_user_by_uuid(&id, true).await
            && let Some(name) = user["display_name"].as_str()
        {
            user_names.insert(id, name.to_string());
        }
    }

    // Resolve org labels for ban's org_unit + all distinct letter
    // generated_by_org units via odo-org.
    let mut org_ids: HashSet<Uuid> = letter_rows
        .iter()
        .filter_map(|l| l.generated_by_org)
        .collect();
    org_ids.insert(ban.org_unit);
    let mut org_names: HashMap<Uuid, String> = HashMap::with_capacity(org_ids.len());
    for id in org_ids {
        if let Ok(detail) = state.org_client.get_unit_detail_by_uuid(&id).await
            && let Some(name) = detail
                .get("org_unit")
                .and_then(|u| u.get("label"))
                .and_then(|v| v.as_str())
        {
            org_names.insert(id, name.to_string());
        }
    }

    let letters: Vec<BanLetterDetailRow> = letter_rows
        .into_iter()
        .map(|l| BanLetterDetailRow {
            template_name: l.template.and_then(|id| template_names.get(&id).cloned()),
            generated_by_name: user_names.get(&l.generated_by).cloned(),
            generated_by_org_name: l
                .generated_by_org
                .and_then(|id| org_names.get(&id).cloned()),
            id: l.id,
            ban: l.ban,
            template: l.template,
            generated_by: l.generated_by,
            generated_at: l.generated_at,
            activity_log_id: l.activity_log_id,
            incident: l.incident,
            generated_by_org: l.generated_by_org,
        })
        .collect();

    let response = BanDetailsResponse {
        ban: BanDetailRow {
            patron_name,
            org_unit_name: org_names.get(&ban.org_unit).cloned(),
            created_by_name: user_names.get(&ban.created_by).cloned(),
            id: ban.id,
            patron: ban.patron,
            incident: ban.incident,
            org_unit: ban.org_unit,
            is_trespass: ban.is_trespass,
            starts_at: ban.starts_at,
            lifts_at: ban.lifts_at,
            archives_at: ban.archives_at,
            archived_by: ban.archived_by,
            lifted_by: ban.lifted_by,
            comments: ban.comments,
            created_at: ban.created_at,
            created_by: ban.created_by,
            updated_at: ban.updated_at,
        },
        letters,
    };

    Ok(Json(response))
}

// ===========================================================================
// Ban activity log
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetBanActivityRequest {
    pub ban_id: i32,
}

/// Attachment metadata as the UI consumes it (`@odo/core` FileUploadResponse
/// shape: numeric file_upload id, original/relative path, derived category).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ActivityAttachment {
    /// The file's stable odo-asset uuid.
    pub id: Uuid,
    pub original_name: String,
    pub relative_path: String,
    pub size: Option<i32>,
    pub mime_type: String,
    /// "photo" | "video" | "document" — derived from mime_type.
    pub category: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ActivityExternalLink {
    pub url: String,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ActivityLetter {
    pub id: i32,
    pub incident: Option<i32>,
    pub generated_at: chrono::DateTime<chrono::FixedOffset>,
    pub generated_by_name: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BanActivityLogEntry {
    pub id: i64,
    pub event_type: String,
    pub actor_id: Uuid,
    pub actor_name: Option<String>,
    pub org_unit: Option<Uuid>,
    pub org_unit_name: Option<String>,
    pub incident_id: Option<i32>,
    pub ban_id: Option<i32>,
    pub event_data: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,

    pub attachments: Vec<ActivityAttachment>,
    pub external_links: Vec<ActivityExternalLink>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter: Option<ActivityLetter>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GetBanActivityResponse {
    pub entries: Vec<BanActivityLogEntry>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/activity",
    request_body = GetBanActivityRequest,
    responses((
        status = 200,
        body = GetBanActivityResponse,
        description = "Activity log for a ban (with attachments, links, and letter refs)"
    )),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn get_ban_activity(
    State(state): State<Arc<AppState>>,
    Json(params): Json<GetBanActivityRequest>,
) -> ApiResult<Json<GetBanActivityResponse>> {
    // Look up the ban first so the permission check is scoped to its org_unit.
    let ban = patron_ban::Entity::find_by_id(params.ban_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("Ban {}", params.ban_id)))?;

    state
        .auth_client
        .permission_required_uuid("current.ban.read", Some(&ban.org_unit))
        .await?;

    // Return every activity row for the ban — no event-type filter. The UI
    // activity tab is meant to be an exhaustive history, and the set of
    // event types inserted by ban operations is open-ended (today's set:
    // ban.created, ban.updated, ban.extended, ban.archived, ban.note,
    // ban.letter_generated, ban.letter_regenerated — but we don't want
    // this list to silently drop rows when a new event type is added).
    let rows = activity_log::Entity::find()
        .filter(activity_log::Column::BanId.eq(params.ban_id))
        .order_by_desc(activity_log::Column::CreatedAt)
        .order_by_desc(activity_log::Column::Id)
        .all(&state.db)
        .await?;

    if rows.is_empty() {
        return Ok(Json(GetBanActivityResponse {
            entries: Vec::new(),
        }));
    }

    // Batched lookups for the decoration sets keyed by activity_log_id.
    let al_ids: Vec<i64> = rows.iter().map(|r| r.id).collect();

    let attachments_by_al = load_activity_attachments(&state, &al_ids).await?;
    let links_by_al = load_activity_links(&state.db, &al_ids).await?;
    let letters_by_al = load_activity_letters(&state, &al_ids).await?;

    // Resolve actor and org-unit display names, one auth/org call per
    // distinct id. Best-effort: missing names render as None.
    let actor_ids: HashSet<Uuid> = rows.iter().map(|r| r.actor_id).collect();
    let mut actor_names: HashMap<Uuid, String> = HashMap::with_capacity(actor_ids.len());
    for id in actor_ids {
        if let Ok(user) = state.auth_client.get_user_by_uuid(&id, true).await
            && let Some(name) = user["display_name"].as_str()
        {
            actor_names.insert(id, name.to_string());
        }
    }

    let org_ids: HashSet<Uuid> = rows.iter().filter_map(|r| r.org_unit).collect();
    let mut org_names: HashMap<Uuid, String> = HashMap::with_capacity(org_ids.len());
    for id in org_ids {
        if let Ok(detail) = state.org_client.get_unit_detail_by_uuid(&id).await
            && let Some(name) = detail
                .get("org_unit")
                .and_then(|u| u.get("label"))
                .and_then(|v| v.as_str())
        {
            org_names.insert(id, name.to_string());
        }
    }

    let entries = rows
        .into_iter()
        .map(|r| BanActivityLogEntry {
            actor_name: actor_names.get(&r.actor_id).cloned(),
            org_unit_name: r.org_unit.and_then(|id| org_names.get(&id).cloned()),
            attachments: attachments_by_al.get(&r.id).cloned().unwrap_or_default(),
            external_links: links_by_al.get(&r.id).cloned().unwrap_or_default(),
            letter: letters_by_al.get(&r.id).cloned(),
            id: r.id,
            event_type: r.event_type,
            actor_id: r.actor_id,
            org_unit: r.org_unit,
            incident_id: r.incident_id,
            ban_id: r.ban_id,
            event_data: r.event_data,
            created_at: r.created_at,
        })
        .collect();

    Ok(Json(GetBanActivityResponse { entries }))
}

// ---------------------------------------------------------------------------
// Batched decoration loaders (activity_log_id → decorations)
// ---------------------------------------------------------------------------

/// "photo" | "video" | "document" derived from the MIME type — mirrors
/// the legacy `derive_category_from_mime` helper.
fn category_from_mime(mime_type: &str) -> &'static str {
    if mime_type.starts_with("image/") {
        "photo"
    } else if mime_type.starts_with("video/") {
        "video"
    } else {
        "document"
    }
}

async fn load_activity_attachments(
    state: &AppState,
    al_ids: &[i64],
) -> ApiResult<HashMap<i64, Vec<ActivityAttachment>>> {
    let attach_rows = attachments::Entity::find()
        .filter(attachments::Column::ActivityLogId.is_in(al_ids.iter().copied()))
        .all(&state.db)
        .await?;

    let file_upload_ids: Vec<Uuid> = attach_rows
        .iter()
        .filter_map(|a| a.file_upload)
        .collect::<HashSet<Uuid>>()
        .into_iter()
        .collect();

    let files: HashMap<Uuid, odo_client::client::FileUploadMetadata> = state
        .asset_client
        .get_files_by_uuid(&file_upload_ids)
        .await?
        .into_iter()
        .map(|f| (f.uuid, f))
        .collect();

    let mut out: HashMap<i64, Vec<ActivityAttachment>> = HashMap::new();
    for a in attach_rows {
        let (Some(al_id), Some(fu_id)) = (a.activity_log_id, a.file_upload) else {
            continue;
        };
        if let Some(file) = files.get(&fu_id) {
            let mime = file.file_type.as_deref().unwrap_or("");
            out.entry(al_id).or_default().push(ActivityAttachment {
                id: file.uuid,
                original_name: file.file_name.clone(),
                relative_path: file.relative_path.clone(),
                size: file.file_size,
                mime_type: mime.to_string(),
                category: category_from_mime(mime).to_string(),
            });
        }
    }

    Ok(out)
}

async fn load_activity_links(
    db: &DatabaseConnection,
    al_ids: &[i64],
) -> ApiResult<HashMap<i64, Vec<ActivityExternalLink>>> {
    let rows = external_link::Entity::find()
        .filter(external_link::Column::ActivityLogId.is_in(al_ids.iter().copied()))
        .all(db)
        .await?;

    let mut out: HashMap<i64, Vec<ActivityExternalLink>> = HashMap::new();
    for l in rows {
        if let Some(al_id) = l.activity_log_id {
            out.entry(al_id).or_default().push(ActivityExternalLink {
                url: l.url,
                title: l.title,
                description: l.description,
            });
        }
    }

    Ok(out)
}

async fn load_activity_letters(
    state: &AppState,
    al_ids: &[i64],
) -> ApiResult<HashMap<i64, ActivityLetter>> {
    let rows = generated_ban_letter::Entity::find()
        .filter(generated_ban_letter::Column::ActivityLogId.is_in(al_ids.iter().copied()))
        .all(&state.db)
        .await?;

    // Resolve distinct generated_by users in one auth call apiece.
    let user_ids: HashSet<Uuid> = rows.iter().map(|l| l.generated_by).collect();
    let mut user_names: HashMap<Uuid, String> = HashMap::with_capacity(user_ids.len());
    for id in user_ids {
        if let Ok(user) = state.auth_client.get_user_by_uuid(&id, true).await
            && let Some(name) = user["display_name"].as_str()
        {
            user_names.insert(id, name.to_string());
        }
    }

    let mut out: HashMap<i64, ActivityLetter> = HashMap::new();
    for l in rows {
        if let Some(al_id) = l.activity_log_id {
            // One letter per activity entry (UI consumes a singular `letter`).
            // If multiple exist, the most recently inserted wins after the
            // entry-order insertion below — but at most one is expected.
            out.entry(al_id).or_insert(ActivityLetter {
                id: l.id,
                incident: l.incident,
                generated_at: l.generated_at,
                generated_by_name: user_names.get(&l.generated_by).cloned(),
            });
        }
    }

    Ok(out)
}

// ===========================================================================
// Single ban letter (content fetch)
// ===========================================================================
//
// `get_ban_details` deliberately omits letter content from its list of
// letters (it can be large boilerplate); this endpoint fetches one letter's
// content on demand. UI callers (view-letter dialog, edit-ban prefill) all
// treat a missing letter as a soft "not present" — so we return
// `{letter: null}` for an unknown id rather than 404'ing.

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetBanLetterRequest {
    pub letter_id: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BanLetterContent {
    pub id: i32,
    pub content: String,
    /// Org unit of the parent ban (handy for clients that want to scope
    /// further actions against the letter without a second round-trip).
    pub org_unit: Uuid,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GetBanLetterResponse {
    /// Null when no letter with the given id exists.
    pub letter: Option<BanLetterContent>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/letter/get",
    request_body = GetBanLetterRequest,
    responses((
        status = 200,
        body = GetBanLetterResponse,
        description = "Letter content, or {letter: null} if no such letter"
    )),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn get_ban_letter(
    State(state): State<Arc<AppState>>,
    Json(params): Json<GetBanLetterRequest>,
) -> ApiResult<Json<GetBanLetterResponse>> {
    let Some(letter) = generated_ban_letter::Entity::find_by_id(params.letter_id)
        .one(&state.db)
        .await?
    else {
        // Match legacy: missing letter returns null, not 404. No perm check
        // needed since the response carries no info beyond "no such id".
        return Ok(Json(GetBanLetterResponse { letter: None }));
    };

    // Resolve the parent ban for org-unit-scoped permission check.
    let ban = patron_ban::Entity::find_by_id(letter.ban)
        .one(&state.db)
        .await?
        .ok_or_else(|| {
            LocalError::internal(format!(
                "letter {} references missing ban {}",
                letter.id, letter.ban
            ))
        })?;

    state
        .auth_client
        .permission_required_uuid("current.ban.read", Some(&ban.org_unit))
        .await?;

    Ok(Json(GetBanLetterResponse {
        letter: Some(BanLetterContent {
            id: letter.id,
            content: letter.content,
            org_unit: ban.org_unit,
        }),
    }))
}

// ===========================================================================
// Ban list (visible bans)
// ===========================================================================
//
// Backed by the same underlying patron_ban table that
// `incidents.visible_patron_ban` was a view over. When `include_archived`
// is false we apply the same filter the view did: archived_by IS NULL AND
// (archives_at IS NULL OR archives_at > now()).

#[derive(Debug, Deserialize, Default, ToSchema)]
pub struct ListBansRequest {
    #[serde(default)]
    pub patron_id: Option<i32>,
    #[serde(default)]
    pub incident_id: Option<i32>,
    /// Scope bans to this org unit and its descendants. Trespasses are
    /// always visible regardless of org_unit (cross-location semantics).
    #[serde(default)]
    pub org_unit: Option<Uuid>,
    #[serde(default)]
    pub limit: Option<u64>,
    /// When false (default), filter out archived bans. Trespasses are
    /// considered archived once `archived_by` is set; non-trespass bans
    /// are considered archived once their `archives_at` is reached.
    #[serde(default)]
    pub include_archived: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BanListRow {
    pub id: i32,
    pub patron: i32,
    pub incident: i32,
    pub org_unit: Uuid,
    pub is_trespass: bool,
    pub comments: Option<String>,
    pub starts_at: chrono::DateTime<chrono::FixedOffset>,
    pub lifts_at: chrono::DateTime<chrono::FixedOffset>,
    pub archives_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
    pub created_by: Uuid,
    pub updated_by: Uuid,
    pub archived_by: Option<Uuid>,

    /// Alias of `patron` (the UI's `getPatronBans` consumers read this).
    pub patron_id: i32,
    pub patron_name: Option<String>,
    pub org_unit_name: Option<String>,

    /// True if at least one row exists in `generated_ban_letter` for
    /// this ban — UI uses this to toggle "view letter" affordances.
    pub has_ban_letter: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListBansResponse {
    pub bans: Vec<BanListRow>,
}

const BAN_LIST_DEFAULT_LIMIT: u64 = 100;
const BAN_LIST_MAX_LIMIT: u64 = 10_000;

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/list",
    request_body = ListBansRequest,
    responses((status = 200, body = ListBansResponse, description = "Bans matching the filters")),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn list_bans(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ListBansRequest>,
) -> ApiResult<Json<ListBansResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.ban.read", params.org_unit.as_ref())
        .await?;

    let limit = std::cmp::min(
        params.limit.unwrap_or(BAN_LIST_DEFAULT_LIMIT),
        BAN_LIST_MAX_LIMIT,
    );

    // Scope: bans at the requested org unit + its descendants. Trespasses
    // are visible cross-location, so they bypass the org filter entirely.
    let org_scope: Option<Vec<Uuid>> = match params.org_unit {
        Some(id) => Some(state.org_client.descendant_uuids(&id).await?),
        None => None,
    };

    let mut q = patron_ban::Entity::find();

    if let Some(pid) = params.patron_id {
        q = q.filter(patron_ban::Column::Patron.eq(pid));
    }
    if let Some(iid) = params.incident_id {
        q = q.filter(patron_ban::Column::Incident.eq(iid));
    }

    if let Some(scope) = org_scope {
        // (is_trespass) OR (org_unit IN scope)
        let in_scope = patron_ban::Column::OrgUnit.is_in(scope);
        let cond = sea_orm::Condition::any()
            .add(patron_ban::Column::IsTrespass.eq(true))
            .add(in_scope);
        q = q.filter(cond);
    }

    if !params.include_archived {
        // visible_patron_ban view semantics: archived_by IS NULL
        // AND (archives_at IS NULL OR archives_at > now())
        let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
        let active = sea_orm::Condition::any()
            .add(patron_ban::Column::ArchivesAt.is_null())
            .add(patron_ban::Column::ArchivesAt.gt(now));
        q = q
            .filter(patron_ban::Column::ArchivedBy.is_null())
            .filter(active);
    }

    let rows = q
        .order_by_desc(patron_ban::Column::CreatedAt)
        .limit(limit)
        .all(&state.db)
        .await?;

    if rows.is_empty() {
        return Ok(Json(ListBansResponse { bans: Vec::new() }));
    }

    // Batch lookups: patron names, org labels, letter-count → bool.
    let patron_ids: HashSet<i32> = rows.iter().map(|r| r.patron).collect();
    let patron_names: HashMap<i32, String> = if patron_ids.is_empty() {
        HashMap::new()
    } else {
        patrons::Entity::find()
            .filter(patrons::Column::Id.is_in(patron_ids))
            .filter(patrons::Column::DeletedAt.is_null())
            .all(&state.db)
            .await?
            .into_iter()
            .map(|p| (p.id, p.display_name))
            .collect()
    };

    let org_ids: HashSet<Uuid> = rows.iter().map(|r| r.org_unit).collect();
    let mut org_names: HashMap<Uuid, String> = HashMap::with_capacity(org_ids.len());
    for id in org_ids {
        if let Ok(detail) = state.org_client.get_unit_detail_by_uuid(&id).await
            && let Some(name) = detail
                .get("org_unit")
                .and_then(|u| u.get("label"))
                .and_then(|v| v.as_str())
        {
            org_names.insert(id, name.to_string());
        }
    }

    // Letters present per ban: one query, fetch distinct ban refs that
    // have at least one letter.
    let ban_ids: Vec<i32> = rows.iter().map(|r| r.id).collect();
    let bans_with_letters: HashSet<i32> = generated_ban_letter::Entity::find()
        .filter(generated_ban_letter::Column::Ban.is_in(ban_ids))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|l| l.ban)
        .collect();

    let bans = rows
        .into_iter()
        .map(|r| BanListRow {
            patron_name: patron_names.get(&r.patron).cloned(),
            org_unit_name: org_names.get(&r.org_unit).cloned(),
            has_ban_letter: bans_with_letters.contains(&r.id),
            patron_id: r.patron,
            id: r.id,
            patron: r.patron,
            incident: r.incident,
            org_unit: r.org_unit,
            is_trespass: r.is_trespass,
            comments: r.comments,
            starts_at: r.starts_at,
            lifts_at: r.lifts_at,
            archives_at: r.archives_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
            created_by: r.created_by,
            updated_by: r.updated_by,
            archived_by: r.archived_by,
        })
        .collect();

    Ok(Json(ListBansResponse { bans }))
}

// ===========================================================================
// Shared constants
// ===========================================================================

/// Legacy defaults for ban / trespass lifetime when caller doesn't pass
/// an explicit `lifts_at`. Kept in days to match the legacy code.
const DEFAULT_BAN_LIFT_DAYS: i64 = 30;
const DEFAULT_TRESPASS_LIFT_DAYS: i64 = 30;
/// How long after `lifts_at` a (non-trespass) ban defaults to
/// auto-archiving. Trespasses don't auto-archive at all.
const DEFAULT_BAN_ARCHIVE_DAYS: i64 = 30;

// ===========================================================================
// create_ban
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateBanRequest {
    pub patron: i32,
    pub incident: i32,
    pub org_unit: Uuid,

    /// All ISO-8601 timestamps with offset. Omitted dates default per
    /// the constants above (lifts_at = now + 30d; archives_at = lifts_at
    /// + 30d for bans, never auto-archives for trespasses).
    #[serde(default)]
    pub starts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(default)]
    pub lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(default)]
    pub archives_at: Option<chrono::DateTime<chrono::FixedOffset>>,

    #[serde(default)]
    pub comments: Option<String>,
    #[serde(default)]
    pub is_trespass: Option<bool>,

    /// Stored in the `ban.created` activity_log event_data, not on the
    /// patron_ban row. Read back via the activity feed.
    #[serde(default)]
    pub case_number: Option<String>,
    #[serde(default)]
    pub law_enforcement_agency: Option<String>,

    /// If both `ban_letter_template` and `ban_letter_content` are set,
    /// a `generated_ban_letter` row is created in the same transaction
    /// and surfaced via the response's `ban_letter_id`.
    #[serde(default)]
    pub ban_letter_template: Option<i32>,
    #[serde(default)]
    pub ban_letter_content: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronBanResponse {
    pub id: i32,
    pub patron: i32,
    pub incident: i32,
    pub org_unit: Uuid,
    pub is_trespass: bool,
    pub starts_at: chrono::DateTime<chrono::FixedOffset>,
    pub lifts_at: chrono::DateTime<chrono::FixedOffset>,
    pub archives_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub archived_by: Option<Uuid>,
    pub lifted_by: Option<Uuid>,
    pub comments: Option<String>,
    pub created_by: Uuid,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_by: Uuid,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

impl From<patron_ban::Model> for PatronBanResponse {
    fn from(m: patron_ban::Model) -> Self {
        Self {
            id: m.id,
            patron: m.patron,
            incident: m.incident,
            org_unit: m.org_unit,
            is_trespass: m.is_trespass,
            starts_at: m.starts_at,
            lifts_at: m.lifts_at,
            archives_at: m.archives_at,
            archived_by: m.archived_by,
            lifted_by: m.lifted_by,
            comments: m.comments,
            created_by: m.created_by,
            created_at: m.created_at,
            updated_by: m.updated_by,
            updated_at: m.updated_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateBanResponse {
    pub patron_ban: PatronBanResponse,
    /// id of the `generated_ban_letter` row that was created alongside
    /// the ban, if the caller passed `ban_letter_content`. None otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ban_letter_id: Option<i32>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/create",
    request_body = CreateBanRequest,
    responses((
        status = 200,
        body = CreateBanResponse,
        description = "Newly created ban; ban_letter_id set when caller passed letter content"
    )),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn create_ban(
    State(state): State<Arc<AppState>>,
    Json(params): Json<CreateBanRequest>,
) -> ApiResult<Json<CreateBanResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    state
        .auth_client
        .permission_required_uuid("current.ban.write", Some(&params.org_unit))
        .await?;

    let is_trespass = params.is_trespass.unwrap_or(false);
    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();

    // Default lifts_at: 30d out for both bans and trespasses. The two
    // constants are kept distinct so they can drift later without
    // touching the call site.
    let default_lift_days = if is_trespass {
        DEFAULT_TRESPASS_LIFT_DAYS
    } else {
        DEFAULT_BAN_LIFT_DAYS
    };
    let lifts_at = params
        .lifts_at
        .unwrap_or_else(|| now + chrono::Duration::days(default_lift_days));

    // archives_at default: bans auto-archive lifts_at + 30d. Trespasses
    // never auto-archive (archives_at stays NULL).
    let archives_at = match params.archives_at {
        Some(v) => Some(v),
        None if !is_trespass => Some(lifts_at + chrono::Duration::days(DEFAULT_BAN_ARCHIVE_DAYS)),
        None => None,
    };
    let starts_at = params.starts_at.unwrap_or(now);

    // Reject overlap: same patron + same org_unit + same kind, where
    // the existing ban hasn't been lifted yet and hasn't been archived.
    // Mirrors the legacy `incidents.active_patron_ban` view predicate.
    let overlap = patron_ban::Entity::find()
        .filter(patron_ban::Column::Patron.eq(params.patron))
        .filter(patron_ban::Column::OrgUnit.eq(params.org_unit))
        .filter(patron_ban::Column::IsTrespass.eq(is_trespass))
        .filter(patron_ban::Column::LiftsAt.gt(now))
        .filter(
            Condition::any()
                .add(patron_ban::Column::ArchivesAt.is_null())
                .add(patron_ban::Column::ArchivesAt.gt(now)),
        )
        .one(&state.db)
        .await?;
    if overlap.is_some() {
        let label = if is_trespass { "trespass" } else { "ban" };
        return Err(LocalError::invalid_input(format!(
            "An active {label} already exists for this patron at this location"
        ))
        .into());
    }

    let txn = state.db.begin().await?;

    let new_ban = patron_ban::ActiveModel {
        patron: Set(params.patron),
        incident: Set(params.incident),
        org_unit: Set(params.org_unit),
        starts_at: Set(starts_at),
        lifts_at: Set(lifts_at),
        archives_at: Set(archives_at),
        comments: Set(params.comments.clone()),
        is_trespass: Set(is_trespass),
        created_by: Set(user_id),
        updated_by: Set(user_id),
        ..Default::default()
    };
    let inserted = new_ban.insert(&txn).await?;
    let ban_id = inserted.id;

    log_ban_activity(
        &txn,
        "ban.created",
        user_id,
        Some(params.org_unit),
        Some(params.incident),
        Some(ban_id),
        serde_json::json!({
            "starts_at": params.starts_at,
            "lifts_at": params.lifts_at,
            "archives_at": params.archives_at,
            "comments": params.comments,
            "case_number": params.case_number,
            "law_enforcement_agency": params.law_enforcement_agency,
        }),
    )
    .await?;

    // Optional letter: legacy writes a second activity_log row tagged
    // `ban.letter_generated` and a `generated_ban_letter` row pointing
    // at it. The letter row carries activity_log_id so the activity
    // feed can re-decorate it.
    let ban_letter_id = if let Some(content) = params.ban_letter_content.as_ref() {
        let letter_al_id = log_ban_activity(
            &txn,
            "ban.letter_generated",
            user_id,
            Some(params.org_unit),
            Some(params.incident),
            Some(ban_id),
            serde_json::json!({}),
        )
        .await?;
        let letter = generated_ban_letter::ActiveModel {
            ban: Set(ban_id),
            template: Set(params.ban_letter_template),
            content: Set(content.clone()),
            generated_by: Set(user_id),
            incident: Set(Some(params.incident)),
            generated_by_org: Set(Some(params.org_unit)),
            activity_log_id: Set(Some(letter_al_id)),
            ..Default::default()
        };
        Some(letter.insert(&txn).await?.id)
    } else {
        None
    };

    txn.commit().await?;

    // Notification fan-out is post-commit and best-effort — a failure
    // here must not roll back the ban itself.
    if let Err(e) = send_ban_notification(
        &state,
        BanNotificationParams {
            ban_id,
            incident_id: params.incident,
            org_unit_id: params.org_unit,
            is_trespass,
            starts_at: Some(starts_at),
            lifts_at: Some(lifts_at),
        },
    )
    .await
    {
        tracing::error!(ban_id, error = %e, "ban notification fan-out failed");
    }

    tracing::info!(ban_id, is_trespass, "CreateBan");

    Ok(Json(CreateBanResponse {
        patron_ban: inserted.into(),
        ban_letter_id,
    }))
}

// ---------------------------------------------------------------------------
// Inline-ban helpers used by incident.create
// ---------------------------------------------------------------------------
//
// The UI's New Incident form lets the user toggle bans / extensions for
// involved patrons inline. The metadata blob carries them as
// `pending_bans[]` and `pending_extends[]`; we apply them inside the
// incident-create transaction so the audit log links each ban to the
// incident that produced it.
//
// These helpers mirror `create_ban` / `extend_ban` but skip the
// permission check (the caller has already cleared
// `incident.incident.write` at the same org_unit) and don't fan out
// notifications themselves — `apply_pending_bans` queues them and the
// caller fires them post-commit.

/// One pending ban as the UI embeds them under `metadata.pending_bans`.
#[derive(Debug, Deserialize)]
struct PendingBanIntent {
    patron_ref: Option<serde_json::Value>,
    ban_type: Option<String>,
    starts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    comments: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PendingExtendIntent {
    ban_id: Option<i32>,
    lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    comments: Option<String>,
}

/// Outcome of applying inline bans/extends: the ids written and a list
/// of notification params for the caller to fire post-commit.
pub(crate) struct PendingBansOutcome {
    pub created_ban_ids: Vec<i32>,
    pub extended_ban_ids: Vec<i32>,
    pub notifications: Vec<BanNotificationParams>,
}

/// Process `metadata.pending_bans[]` and `metadata.pending_extends[]`
/// inside the caller's transaction. Per-row failures (missing
/// patron_ref, overlap with an existing ban, etc.) are skipped with a
/// warn-log rather than failing the whole incident create — same
/// best-effort semantics as legacy.
///
/// Caller must:
///   1. Have already verified `incident.incident.write` at `org_unit`.
///   2. Fire `outcome.notifications` post-commit (we can't safely call
///      odo-notify from inside the txn).
pub(crate) async fn apply_pending_bans<C: sea_orm::ConnectionTrait>(
    txn: &C,
    metadata: Option<&serde_json::Value>,
    incident_id: i32,
    org_unit: Uuid,
    user_id: Uuid,
) -> LocalResult<PendingBansOutcome> {
    let mut out = PendingBansOutcome {
        created_ban_ids: Vec::new(),
        extended_ban_ids: Vec::new(),
        notifications: Vec::new(),
    };

    let Some(meta) = metadata else { return Ok(out) };

    // --- pending_bans[] ---
    if let Some(bans) = meta.get("pending_bans").and_then(|v| v.as_array()) {
        for (index, raw) in bans.iter().enumerate() {
            let intent: PendingBanIntent = match serde_json::from_value(raw.clone()) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(
                        incident_id, index, error = %e,
                        "pending_bans: skipping malformed entry"
                    );
                    continue;
                }
            };

            // patron_ref may arrive as int or stringified-int.
            let patron_id = intent.patron_ref.as_ref().and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
                    .map(|n| n as i32)
            });
            let Some(patron_id) = patron_id else {
                tracing::warn!(
                    incident_id,
                    index,
                    "pending_bans: skipping entry with missing or invalid patron_ref"
                );
                continue;
            };

            let is_trespass = intent.ban_type.as_deref() == Some("trespass");
            let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
            let lifts_at = intent
                .lifts_at
                .unwrap_or_else(|| now + chrono::Duration::days(DEFAULT_BAN_LIFT_DAYS));
            let archives_at = if is_trespass {
                None
            } else {
                Some(lifts_at + chrono::Duration::days(DEFAULT_BAN_ARCHIVE_DAYS))
            };
            let starts_at = intent.starts_at.unwrap_or(now);

            // Skip if an active ban/trespass of the same kind already
            // exists for this patron + org. Matches the standalone
            // create_ban check — same predicate, just inlined.
            let overlap = patron_ban::Entity::find()
                .filter(patron_ban::Column::Patron.eq(patron_id))
                .filter(patron_ban::Column::OrgUnit.eq(org_unit))
                .filter(patron_ban::Column::IsTrespass.eq(is_trespass))
                .filter(patron_ban::Column::LiftsAt.gt(now))
                .filter(
                    Condition::any()
                        .add(patron_ban::Column::ArchivesAt.is_null())
                        .add(patron_ban::Column::ArchivesAt.gt(now)),
                )
                .one(txn)
                .await?;
            if overlap.is_some() {
                let label = if is_trespass { "trespass" } else { "ban" };
                tracing::warn!(
                    incident_id,
                    patron_id,
                    %org_unit,
                    "pending_bans: skipping duplicate active {label} for patron at org_unit"
                );
                continue;
            }

            let new_ban = patron_ban::ActiveModel {
                patron: Set(patron_id),
                incident: Set(incident_id),
                org_unit: Set(org_unit),
                starts_at: Set(starts_at),
                lifts_at: Set(lifts_at),
                archives_at: Set(archives_at),
                comments: Set(intent.comments.clone()),
                is_trespass: Set(is_trespass),
                created_by: Set(user_id),
                updated_by: Set(user_id),
                ..Default::default()
            };
            let inserted = new_ban.insert(txn).await?;
            let ban_id = inserted.id;

            log_ban_activity(
                txn,
                "ban.created",
                user_id,
                Some(org_unit),
                Some(incident_id),
                Some(ban_id),
                serde_json::json!({
                    "starts_at": intent.starts_at,
                    "lifts_at": intent.lifts_at,
                    "comments": intent.comments,
                    // case_number / law_enforcement_agency aren't on
                    // the inline-ban form today; keep null placeholders
                    // so the event_data shape matches standalone
                    // create_ban for readers walking the activity feed.
                    "case_number": serde_json::Value::Null,
                    "law_enforcement_agency": serde_json::Value::Null,
                }),
            )
            .await?;

            out.created_ban_ids.push(ban_id);
            out.notifications.push(BanNotificationParams {
                ban_id,
                incident_id,
                org_unit_id: org_unit,
                is_trespass,
                starts_at: Some(starts_at),
                lifts_at: Some(lifts_at),
            });
        }
    }

    // --- pending_extends[] ---
    if let Some(extends) = meta.get("pending_extends").and_then(|v| v.as_array()) {
        for (index, raw) in extends.iter().enumerate() {
            let intent: PendingExtendIntent = match serde_json::from_value(raw.clone()) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(
                        incident_id, index, error = %e,
                        "pending_extends: skipping malformed entry"
                    );
                    continue;
                }
            };
            let (Some(ban_id), Some(new_lifts_at)) = (intent.ban_id, intent.lifts_at) else {
                tracing::warn!(
                    incident_id,
                    index,
                    "pending_extends: skipping entry missing ban_id or lifts_at"
                );
                continue;
            };
            let Some(existing) = patron_ban::Entity::find_by_id(ban_id).one(txn).await? else {
                tracing::warn!(incident_id, ban_id, "pending_extends: ban not found");
                continue;
            };
            let previous_lifts_at = existing.lifts_at;
            let is_trespass = existing.is_trespass;
            let archives_at = if is_trespass {
                None
            } else {
                Some(new_lifts_at + chrono::Duration::days(DEFAULT_BAN_ARCHIVE_DAYS))
            };

            let mut active: patron_ban::ActiveModel = existing.into();
            active.lifts_at = Set(new_lifts_at);
            active.updated_by = Set(user_id);
            if archives_at.is_some() {
                active.archives_at = Set(archives_at);
            }
            active.update(txn).await?;

            log_ban_activity(
                txn,
                "ban.extended",
                user_id,
                Some(org_unit),
                Some(incident_id),
                Some(ban_id),
                serde_json::json!({
                    "previous_lifts_at": previous_lifts_at.to_rfc3339(),
                    "lifts_at": new_lifts_at,
                    "archives_at": archives_at,
                    "comments": intent.comments,
                    "case_number": serde_json::Value::Null,
                    "law_enforcement_agency": serde_json::Value::Null,
                }),
            )
            .await?;

            out.extended_ban_ids.push(ban_id);
        }
    }

    Ok(out)
}

/// Post-commit fan-out helper for [`apply_pending_bans`]. Each call is
/// independent and best-effort — failures are logged and skipped.
pub(crate) async fn fire_pending_ban_notifications(
    state: &AppState,
    notifications: Vec<BanNotificationParams>,
) {
    for n in notifications {
        let ban_id = n.ban_id;
        if let Err(e) = send_ban_notification(state, n).await {
            tracing::error!(ban_id, error = %e, "pending-ban notification failed");
        }
    }
}

// ===========================================================================
// edit_ban
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct EditBanRequest {
    pub ban_id: i32,
    #[serde(default)]
    pub starts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(default)]
    pub lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(default)]
    pub archives_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    /// Allows manually marking a ban archived via this endpoint.
    /// `archive_ban` is the preferred path; this exists for the rare
    /// edit-and-archive-in-one-call flow.
    #[serde(default)]
    pub archived_by: Option<Uuid>,
    #[serde(default)]
    pub comments: Option<String>,
    #[serde(default)]
    pub is_trespass: Option<bool>,

    /// Stored in the `ban.updated` event_data when changed. We compare
    /// against the most recent value of the same key in the ban's
    /// activity feed (case_number / law_enforcement_agency don't live
    /// on the patron_ban row).
    #[serde(default)]
    pub case_number: Option<String>,
    #[serde(default)]
    pub law_enforcement_agency: Option<String>,

    /// Same letter-attach flow as create. Triggers
    /// `ban.letter_regenerated` rather than `ban.letter_generated`.
    #[serde(default)]
    pub ban_letter_template: Option<i32>,
    #[serde(default)]
    pub ban_letter_content: Option<String>,
    // NOTE: legacy accepted an `org_unit` field that would relocate the
    // ban to another org. Same security-shape issue we already fixed in
    // incident.update — the perm check runs against the source org. We
    // intentionally omit the field here. If a real use case appears,
    // it should be its own gated endpoint.
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EditBanResponse {
    pub patron_ban: PatronBanResponse,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ban_letter_id: Option<i32>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/edit",
    request_body = EditBanRequest,
    responses((
        status = 200,
        body = EditBanResponse,
        description = "Updated ban; ban_letter_id set when caller regenerated the letter"
    )),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn edit_ban(
    State(state): State<Arc<AppState>>,
    Json(params): Json<EditBanRequest>,
) -> ApiResult<Json<EditBanResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    let existing = patron_ban::Entity::find_by_id(params.ban_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("ban {}", params.ban_id)))?;

    state
        .auth_client
        .permission_required_uuid("current.ban.write", Some(&existing.org_unit))
        .await?;

    // Snapshot previous values for the changes-diff in activity_log.
    let prev_starts_at = existing.starts_at;
    let prev_lifts_at = existing.lifts_at;
    let prev_archives_at = existing.archives_at;
    let prev_comments = existing.comments.clone();
    let (prev_case_number, prev_agency) = latest_ban_metadata(&state.db, params.ban_id).await?;

    let txn = state.db.begin().await?;

    let mut active: patron_ban::ActiveModel = existing.into();
    active.updated_by = Set(user_id);

    // Track the effective lifts_at for use in the is_trespass branch's
    // archives_at default; otherwise we'd compute against the stale
    // pre-update value when both lifts_at and is_trespass are changed
    // in the same call.
    let mut effective_lifts_at = prev_lifts_at;

    if let Some(v) = params.starts_at {
        active.starts_at = Set(v);
    }
    if let Some(v) = params.lifts_at {
        effective_lifts_at = v;
        active.lifts_at = Set(v);
    }
    if let Some(v) = params.archives_at {
        active.archives_at = Set(Some(v));
    }
    if let Some(v) = params.archived_by {
        active.archived_by = Set(Some(v));
    }
    if let Some(v) = params.comments.clone() {
        active.comments = Set(Some(v));
    }

    // is_trespass flip recomputes the archives_at default unless the
    // caller passed one explicitly: trespasses have no auto-archive,
    // bans get lifts_at + 30d.
    if let Some(v) = params.is_trespass {
        active.is_trespass = Set(v);
        if params.archives_at.is_none() {
            let recomputed = if v {
                None
            } else {
                Some(effective_lifts_at + chrono::Duration::days(DEFAULT_BAN_ARCHIVE_DAYS))
            };
            active.archives_at = Set(recomputed);
        }
    }

    let updated = active.update(&txn).await?;
    let incident_id = updated.incident;
    let org_unit_id = updated.org_unit;

    // Build a structured changes map. Each field's "from" is the
    // pre-update value; "to" is what the caller sent. Date fields
    // compare on YYYY-MM-DD to match legacy (drops timezone /
    // sub-day churn from the no-op diff).
    let mut changes = serde_json::Map::new();
    let push_date_change =
        |changes: &mut serde_json::Map<String, serde_json::Value>,
         key: &str,
         prev: chrono::DateTime<chrono::FixedOffset>,
         next: Option<chrono::DateTime<chrono::FixedOffset>>| {
            if let Some(n) = next
                && prev.date_naive() != n.date_naive()
            {
                changes.insert(
                    key.to_string(),
                    serde_json::json!({
                        "from": prev.to_rfc3339(),
                        "to": n.to_rfc3339(),
                    }),
                );
            }
        };
    push_date_change(&mut changes, "starts_at", prev_starts_at, params.starts_at);
    push_date_change(&mut changes, "lifts_at", prev_lifts_at, params.lifts_at);
    if let Some(next) = params.archives_at
        && prev_archives_at.map(|d| d.date_naive()) != Some(next.date_naive())
    {
        changes.insert(
            "archives_at".to_string(),
            serde_json::json!({
                "from": prev_archives_at.map(|d| d.to_rfc3339()),
                "to": next.to_rfc3339(),
            }),
        );
    }
    if let Some(next) = params.comments.as_ref()
        && prev_comments.as_deref() != Some(next.as_str())
    {
        changes.insert(
            "comments".to_string(),
            serde_json::json!({ "from": prev_comments, "to": next }),
        );
    }
    if let Some(next) = params.case_number.as_ref()
        && prev_case_number.as_deref() != Some(next.as_str())
    {
        changes.insert(
            "case_number".to_string(),
            serde_json::json!({ "from": prev_case_number, "to": next }),
        );
    }
    if let Some(next) = params.law_enforcement_agency.as_ref()
        && prev_agency.as_deref() != Some(next.as_str())
    {
        changes.insert(
            "law_enforcement_agency".to_string(),
            serde_json::json!({ "from": prev_agency, "to": next }),
        );
    }

    if !changes.is_empty() {
        log_ban_activity(
            &txn,
            "ban.updated",
            user_id,
            Some(org_unit_id),
            None,
            Some(params.ban_id),
            serde_json::json!({ "changes": changes }),
        )
        .await?;
    }

    // Re-issue a ban letter against this ban: same activity-log linkage
    // pattern as create, but tagged `ban.letter_regenerated` so the
    // activity feed can distinguish "fresh ban" vs "letter reprint".
    let ban_letter_id = if let Some(content) = params.ban_letter_content.as_ref() {
        let letter_al_id = log_ban_activity(
            &txn,
            "ban.letter_regenerated",
            user_id,
            Some(org_unit_id),
            Some(incident_id),
            Some(params.ban_id),
            serde_json::json!({
                "case_number": params.case_number,
                "law_enforcement_agency": params.law_enforcement_agency,
            }),
        )
        .await?;
        let letter = generated_ban_letter::ActiveModel {
            ban: Set(params.ban_id),
            template: Set(params.ban_letter_template),
            content: Set(content.clone()),
            generated_by: Set(user_id),
            activity_log_id: Set(Some(letter_al_id)),
            generated_by_org: Set(Some(org_unit_id)),
            incident: Set(Some(incident_id)),
            ..Default::default()
        };
        Some(letter.insert(&txn).await?.id)
    } else {
        None
    };

    txn.commit().await?;

    tracing::info!(ban_id = params.ban_id, "EditBan");

    Ok(Json(EditBanResponse {
        patron_ban: updated.into(),
        ban_letter_id,
    }))
}

// ===========================================================================
// archive_ban
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct ArchiveBanRequest {
    pub ban_id: i32,
    #[serde(default)]
    pub comments: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ArchiveBanResponse {
    pub patron_ban: PatronBanResponse,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/archive",
    request_body = ArchiveBanRequest,
    responses((status = 200, body = ArchiveBanResponse, description = "Archived ban row")),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn archive_ban(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ArchiveBanRequest>,
) -> ApiResult<Json<ArchiveBanResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    let existing = patron_ban::Entity::find_by_id(params.ban_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("ban {}", params.ban_id)))?;

    if existing.archived_by.is_some() {
        let kind = if existing.is_trespass {
            "trespass"
        } else {
            "ban"
        };
        return Err(
            LocalError::invalid_input(format!("This {kind} has already been archived")).into(),
        );
    }

    // Distinct perms by kind: trespasses (cross-location, long-lived)
    // need a higher-trust role than ordinary bans.
    let perm = if existing.is_trespass {
        "current.trespass.archive"
    } else {
        "current.ban.archive"
    };
    state
        .auth_client
        .permission_required_uuid(perm, Some(&existing.org_unit))
        .await?;

    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
    let org_unit = existing.org_unit;

    let txn = state.db.begin().await?;

    let mut active: patron_ban::ActiveModel = existing.into();
    active.archived_by = Set(Some(user_id));
    active.archives_at = Set(Some(now));
    active.updated_by = Set(user_id);
    let updated = active.update(&txn).await?;

    log_ban_activity(
        &txn,
        "ban.archived",
        user_id,
        Some(org_unit),
        None,
        Some(params.ban_id),
        serde_json::json!({
            "archives_at": now.to_rfc3339(),
            "comments": params.comments,
        }),
    )
    .await?;

    txn.commit().await?;

    tracing::info!(ban_id = params.ban_id, "ArchiveBan");
    Ok(Json(ArchiveBanResponse {
        patron_ban: updated.into(),
    }))
}

// ===========================================================================
// extend_ban
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct ExtendBanRequest {
    pub ban_id: i32,
    /// New end date. Required — extend without a target is meaningless.
    pub lifts_at: chrono::DateTime<chrono::FixedOffset>,
    #[serde(default)]
    pub starts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(default)]
    pub archives_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(default)]
    pub comments: Option<String>,
    /// Optionally associates the extension with an incident — usually
    /// the incident that prompted the extension. Persisted in the
    /// activity log row and on any generated letter.
    #[serde(default)]
    pub incident: Option<i32>,
    #[serde(default)]
    pub case_number: Option<String>,
    #[serde(default)]
    pub law_enforcement_agency: Option<String>,
    #[serde(default)]
    pub ban_letter_template: Option<i32>,
    #[serde(default)]
    pub ban_letter_content: Option<String>,
    /// Org that issued the letter; usually equals the ban's org_unit
    /// but the legacy lets the caller distinguish so we do too.
    #[serde(default)]
    pub generated_by_org: Option<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ExtendBanResponse {
    pub patron_ban: PatronBanResponse,
    pub activity_log_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter_id: Option<i32>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/extend",
    request_body = ExtendBanRequest,
    responses((
        status = 200,
        body = ExtendBanResponse,
        description = "Extended ban + activity log id + optional letter id"
    )),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn extend_ban(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ExtendBanRequest>,
) -> ApiResult<Json<ExtendBanResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    let existing = patron_ban::Entity::find_by_id(params.ban_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("ban {}", params.ban_id)))?;

    state
        .auth_client
        .permission_required_uuid("current.ban.write", Some(&existing.org_unit))
        .await?;

    let is_trespass = existing.is_trespass;
    let previous_lifts_at = existing.lifts_at;
    let org_unit = existing.org_unit;

    let txn = state.db.begin().await?;

    let mut active: patron_ban::ActiveModel = existing.into();
    active.lifts_at = Set(params.lifts_at);
    active.updated_by = Set(user_id);
    if let Some(v) = params.starts_at {
        active.starts_at = Set(v);
    }

    // archives_at: explicit wins. Otherwise bans get lifts_at + 30d
    // recomputed, trespasses untouched.
    if let Some(v) = params.archives_at {
        active.archives_at = Set(Some(v));
    } else if !is_trespass {
        active.archives_at = Set(Some(
            params.lifts_at + chrono::Duration::days(DEFAULT_BAN_ARCHIVE_DAYS),
        ));
    }

    let updated = active.update(&txn).await?;

    let activity_log_id = log_ban_activity(
        &txn,
        "ban.extended",
        user_id,
        Some(org_unit),
        params.incident,
        Some(params.ban_id),
        serde_json::json!({
            "previous_lifts_at": previous_lifts_at.to_rfc3339(),
            "starts_at": params.starts_at,
            "lifts_at": params.lifts_at,
            "archives_at": params.archives_at,
            "comments": params.comments,
            "case_number": params.case_number,
            "law_enforcement_agency": params.law_enforcement_agency,
        }),
    )
    .await?;

    let letter_id = if let Some(content) = params.ban_letter_content.as_ref() {
        let letter = generated_ban_letter::ActiveModel {
            ban: Set(params.ban_id),
            template: Set(params.ban_letter_template),
            content: Set(content.clone()),
            generated_by: Set(user_id),
            activity_log_id: Set(Some(activity_log_id)),
            incident: Set(params.incident),
            generated_by_org: Set(params.generated_by_org),
            ..Default::default()
        };
        Some(letter.insert(&txn).await?.id)
    } else {
        None
    };

    txn.commit().await?;

    tracing::info!(ban_id = params.ban_id, "ExtendBan");
    Ok(Json(ExtendBanResponse {
        patron_ban: updated.into(),
        activity_log_id,
        letter_id,
    }))
}

// ===========================================================================
// add_to_ban
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddToBanRequest {
    pub ban_id: i32,
    /// At least one of comments / attachments / external_links must be
    /// provided; a no-op note isn't useful and would just add audit noise.
    #[serde(default)]
    pub comments: Option<String>,
    /// Each id refers to a row already in `asset.file_upload` (the UI
    /// uploads through odo-asset first). Mirrors the contract on
    /// `patron.photo.create`.
    #[serde(default)]
    pub attachment_file_upload_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    pub external_links: Option<Vec<AddToBanExternalLink>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddToBanExternalLink {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AddToBanResponse {
    pub activity_log_id: i64,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/add-to",
    request_body = AddToBanRequest,
    responses((
        status = 200,
        body = AddToBanResponse,
        description = "The activity_log row id; attachments and links are linked to it"
    )),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn add_to_ban(
    State(state): State<Arc<AppState>>,
    Json(params): Json<AddToBanRequest>,
) -> ApiResult<Json<AddToBanResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    let has_comments = params.comments.is_some();
    let has_attachments = params
        .attachment_file_upload_ids
        .as_ref()
        .is_some_and(|v| !v.is_empty());
    let has_links = params
        .external_links
        .as_ref()
        .is_some_and(|v| !v.is_empty());
    if !(has_comments || has_attachments || has_links) {
        return Err(LocalError::invalid_input(
            "At least one of comments, attachments, or external_links must be provided",
        )
        .into());
    }

    let existing = patron_ban::Entity::find_by_id(params.ban_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("ban {}", params.ban_id)))?;

    state
        .auth_client
        .permission_required_uuid("current.ban.write", Some(&existing.org_unit))
        .await?;

    let txn = state.db.begin().await?;

    let al_id = log_ban_activity(
        &txn,
        "ban.note",
        user_id,
        Some(existing.org_unit),
        None,
        Some(params.ban_id),
        serde_json::json!({ "comments": params.comments }),
    )
    .await?;

    if let Some(ids) = params.attachment_file_upload_ids.as_ref() {
        let rows: Vec<attachments::ActiveModel> = ids
            .iter()
            .map(|file_upload_id| attachments::ActiveModel {
                activity_log_id: Set(Some(al_id)),
                file_upload: Set(Some(*file_upload_id)),
                ..Default::default()
            })
            .collect();
        if !rows.is_empty() {
            attachments::Entity::insert_many(rows).exec(&txn).await?;
        }
    }

    if let Some(links) = params.external_links.as_ref() {
        let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
        let rows: Vec<external_link::ActiveModel> = links
            .iter()
            .map(|l| external_link::ActiveModel {
                activity_log_id: Set(Some(al_id)),
                url: Set(l.url.clone()),
                title: Set(l.title.clone()),
                description: Set(l.description.clone()),
                added_by: Set(Some(user_id)),
                added_at: Set(now),
                // Same NOT-NULL-with-DB-default situation as
                // incidents.rs::insert_external_links — set explicitly.
                restricted_access: Set(false),
                ..Default::default()
            })
            .collect();
        if !rows.is_empty() {
            external_link::Entity::insert_many(rows).exec(&txn).await?;
        }
    }

    txn.commit().await?;

    tracing::info!(ban_id = params.ban_id, activity_log_id = al_id, "AddToBan");
    Ok(Json(AddToBanResponse {
        activity_log_id: al_id,
    }))
}

// ===========================================================================
// create_ban_letter
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateBanLetterRequest {
    pub ban_id: i32,
    pub content: String,
    #[serde(default)]
    pub template: Option<i32>,
    #[serde(default)]
    pub generated_by_org: Option<Uuid>,
    #[serde(default)]
    pub incident: Option<i32>,
    #[serde(default)]
    pub case_number: Option<String>,
    #[serde(default)]
    pub law_enforcement_agency: Option<String>,
    #[serde(default)]
    pub comments: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateBanLetterResponse {
    pub letter_id: i32,
    pub activity_log_id: i64,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/ban/letter/create",
    request_body = CreateBanLetterRequest,
    responses((
        status = 200,
        body = CreateBanLetterResponse,
        description = "Created letter id + linked activity_log row id"
    )),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn create_ban_letter(
    State(state): State<Arc<AppState>>,
    Json(params): Json<CreateBanLetterRequest>,
) -> ApiResult<Json<CreateBanLetterResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    let existing = patron_ban::Entity::find_by_id(params.ban_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("ban {}", params.ban_id)))?;

    state
        .auth_client
        .permission_required_uuid("current.ban.write", Some(&existing.org_unit))
        .await?;

    let txn = state.db.begin().await?;

    let activity_log_id = log_ban_activity(
        &txn,
        "ban.letter_generated",
        user_id,
        params.generated_by_org,
        params.incident,
        Some(params.ban_id),
        serde_json::json!({
            "case_number": params.case_number,
            "law_enforcement_agency": params.law_enforcement_agency,
            "comments": params.comments,
        }),
    )
    .await?;

    let letter = generated_ban_letter::ActiveModel {
        ban: Set(params.ban_id),
        template: Set(params.template),
        content: Set(params.content.clone()),
        generated_by: Set(user_id),
        activity_log_id: Set(Some(activity_log_id)),
        incident: Set(params.incident),
        generated_by_org: Set(params.generated_by_org),
        ..Default::default()
    };
    let letter_id = letter.insert(&txn).await?.id;

    txn.commit().await?;

    tracing::info!(ban_id = params.ban_id, letter_id, "CreateBanLetter");
    Ok(Json(CreateBanLetterResponse {
        letter_id,
        activity_log_id,
    }))
}

// ===========================================================================
// Helpers
// ===========================================================================

/// Insert a row into `incidents.activity_log` and return its id.
async fn log_ban_activity<C: sea_orm::ConnectionTrait>(
    txn: &C,
    event_type: &str,
    actor_id: Uuid,
    org_unit: Option<Uuid>,
    incident_id: Option<i32>,
    ban_id: Option<i32>,
    event_data: serde_json::Value,
) -> LocalResult<i64> {
    let row = activity_log::ActiveModel {
        event_type: Set(event_type.to_string()),
        actor_id: Set(actor_id),
        org_unit: Set(org_unit),
        incident_id: Set(incident_id),
        ban_id: Set(ban_id),
        event_data: Set(event_data),
        ..Default::default()
    };
    Ok(row.insert(txn).await?.id)
}

/// Walk the most recent ban activity-log rows to recover the latest
/// `case_number` / `law_enforcement_agency` values. Those don't live on
/// `patron_ban` — they're written into event_data on create / update /
/// letter rows. Returns `(case_number, agency)` once both are found
/// (or the lookup window is exhausted).
async fn latest_ban_metadata(
    db: &DatabaseConnection,
    ban_id: i32,
) -> LocalResult<(Option<String>, Option<String>)> {
    let rows = activity_log::Entity::find()
        .filter(activity_log::Column::BanId.eq(ban_id))
        .filter(activity_log::Column::EventType.is_in([
            "ban.created",
            "ban.updated",
            "ban.letter_generated",
            "ban.letter_regenerated",
        ]))
        .order_by_desc(activity_log::Column::CreatedAt)
        .order_by_desc(activity_log::Column::Id)
        .limit(5)
        .all(db)
        .await?;

    let mut case_number: Option<String> = None;
    let mut agency: Option<String> = None;
    // Handle both shapes: flat top-level keys (legacy create/extend
    // events) and the nested `changes.{field}.to` form that
    // `ban.updated` events emit. First non-null hit wins because we
    // iterate newest → oldest.
    let find = |row: &serde_json::Value, key: &str| -> Option<String> {
        row.get(key)
            .and_then(|v| v.as_str())
            .map(String::from)
            .or_else(|| {
                row.get("changes")
                    .and_then(|c| c.get(key))
                    .and_then(|f| f.get("to"))
                    .and_then(|v| v.as_str())
                    .map(String::from)
            })
    };
    for row in &rows {
        if case_number.is_none() {
            case_number = find(&row.event_data, "case_number");
        }
        if agency.is_none() {
            agency = find(&row.event_data, "law_enforcement_agency");
        }
        if case_number.is_some() && agency.is_some() {
            break;
        }
    }
    Ok((case_number, agency))
}

// ---------------------------------------------------------------------------
// Notification fan-out
// ---------------------------------------------------------------------------

/// Format a "30 days" / "No end date" string from optional start/end
/// timestamps. Days computed on calendar dates so DST / timezone
/// jitter doesn't flip 29 ↔ 30.
fn format_ban_duration(
    starts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
) -> String {
    match (starts_at, lifts_at) {
        (Some(s), Some(l)) => {
            let days = l
                .date_naive()
                .signed_duration_since(s.date_naive())
                .num_days();
            if days == 1 {
                "1 day".to_string()
            } else {
                format!("{days} days")
            }
        }
        _ => "No end date".to_string(),
    }
}

pub(crate) struct BanNotificationParams {
    pub ban_id: i32,
    pub incident_id: i32,
    pub org_unit_id: Uuid,
    pub is_trespass: bool,
    pub starts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
}

/// Look up email-group routing rows for this ban-type and org, then
/// fire a single `notification.enqueue` per matched email-group. Each
/// failure is logged but doesn't fail the caller — notifications are
/// best-effort by design (the ban is already committed).
async fn send_ban_notification(state: &AppState, params: BanNotificationParams) -> LocalResult<()> {
    let (location_name, timezone) = match state
        .org_client
        .get_unit_detail_by_uuid(&params.org_unit_id)
        .await
    {
        Ok(detail) => {
            let unit = detail.get("org_unit");
            (
                unit.and_then(|u| u.get("label"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                unit.and_then(|u| u.get("timezone"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("America/Los_Angeles")
                    .to_string(),
            )
        }
        Err(_) => ("Unknown".to_string(), "America/Los_Angeles".to_string()),
    };

    let template_code = if params.is_trespass {
        "patron-trespass-created"
    } else {
        "patron-ban-created"
    };
    let ban_type = if params.is_trespass {
        "trespass"
    } else {
        "ban"
    };
    let start_date = params
        .starts_at
        .map(|d| d.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let lift_date = params
        .lifts_at
        .map(|d| serde_json::Value::String(d.to_rfc3339()))
        .unwrap_or(serde_json::Value::Null);
    let incident_url = format!("{}/incidents/{}", state.public_url, params.incident_id);
    let duration = format_ban_duration(params.starts_at, params.lifts_at);

    let template_variables = serde_json::json!({
        "location_name": location_name,
        "duration": duration,
        "start_date": start_date,
        "lift_date": lift_date,
        "timezone": timezone,
        "incident_url": incident_url,
        "action_url": format!("/incidents/{}", params.incident_id),
    });

    // Route rules: rows with `incident_org_unit = $org` are scoped
    // matches; rows with NULL `incident_org_unit` are broadcast (match
    // every org). Either qualifies.
    let routes = notification_email_routing::Entity::find()
        .filter(notification_email_routing::Column::TemplateCode.eq(template_code))
        .filter(notification_email_routing::Column::IsActive.eq(true))
        .filter(
            Condition::any()
                .add(notification_email_routing::Column::IncidentOrgUnit.eq(params.org_unit_id))
                .add(notification_email_routing::Column::IncidentOrgUnit.is_null()),
        )
        .all(&state.db)
        .await?;

    if routes.is_empty() {
        tracing::warn!(
            template_code,
            ban_id = params.ban_id,
            "no email_groups configured for ban/trespass notification"
        );
        return Ok(());
    }

    for route in &routes {
        let payload = serde_json::json!({
            "recipients": [{
                "type": "email_group",
                "email_group_id": route.email_group,
                "channels": ["email"],
            }],
            "template_code": template_code,
            "template_variables": template_variables,
            "source_service": "current",
            "source_entity_type": ban_type,
            "source_entity_id": params.ban_id,
            "dedup_key": format!("{ban_type}:{}:{}", params.ban_id, route.email_group),
        });

        if let Err(e) = state
            .notify_client
            .post::<serde_json::Value, _>("/api/v1/odo/notify/enqueue", &payload)
            .await
        {
            tracing::warn!(
                ban_id = params.ban_id,
                email_group = %route.email_group,
                error = %e,
                "ban notification enqueue failed",
            );
        }
    }

    Ok(())
}
