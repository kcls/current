use axum::Json;
use axum::extract::State;
use odo_client::context::RequestContext;
use odo_client::error::{ApiResult, LocalError, LocalResult};
use sea_orm::prelude::*;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveValue, ExprTrait, Order, PaginatorTrait, QueryOrder, QuerySelect, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::{
    activity_log, attachments, external_link, external_link_type, incident_template_map, incidents,
    involved_parties, patron_ban, patrons, sub_locations,
};
use crate::review::{self, ReviewActionFlags};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Default, ToSchema)]
pub struct IncidentGetOptions {
    #[serde(default)]
    pub with_involved_parties: bool,
    #[serde(default)]
    pub with_external_links: bool,
    #[serde(default)]
    pub with_attachments: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetIncidentRequest {
    pub id: i32,
    #[serde(default)]
    pub options: Option<IncidentGetOptions>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct InvolvedPartyResponse {
    pub id: i32,
    pub patron_id: Option<i32>,
    pub staff_id: Option<Uuid>,
    pub is_unknown_patron: Option<bool>,
    pub party_type: String,
    pub role: Option<String>,
    pub notes: Option<String>,
    pub patron_display_name: Option<String>,
    pub staff_display_name: Option<String>,
    /// Populated for `party_type = "external"` rows (the schema's check
    /// constraint requires it). The legacy read path silently dropped this
    /// — the UI's external-party display logic was relying on a field
    /// the server never sent.
    pub external_name: Option<String>,
    pub external_contact: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ExternalLinkResponse {
    pub id: i32,
    pub incident: Option<i32>,
    pub url: String,
    pub title: String,
    pub link_type: Option<i32>,
    pub description: Option<String>,
    pub restricted_access: bool,
    pub added_by: Option<Uuid>,
    pub added_at: chrono::DateTime<chrono::FixedOffset>,
    pub link_type_label: Option<String>,
    pub link_type_description: Option<String>,
    pub link_type_display_order: Option<i32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IncidentResponse {
    pub id: i32,
    pub org_unit: Uuid,
    pub sub_location: Option<i32>,
    pub title: String,
    pub description: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub custom_fields: Option<serde_json::Value>,
    pub ai_analysis: Option<serde_json::Value>,
    pub emergency_capture: Option<bool>,
    pub called_emergency: Option<bool>,
    pub created_by: Uuid,
    pub resolved_by: Option<Uuid>,
    pub created_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub occurred_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub resolved_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub deleted_at: Option<chrono::DateTime<chrono::FixedOffset>>,

    // Joined / derived fields
    pub created_by_name: Option<String>,
    pub sub_location_name: Option<String>,
    pub code: Option<String>,
    pub label: Option<String>,
    pub org_address_line1: Option<String>,
    pub org_address_line2: Option<String>,
    pub org_city: Option<String>,
    pub org_state: Option<String>,
    pub org_postal_code: Option<String>,
    pub template_ids: Vec<i32>,

    // Review state
    pub creator_level: i32,
    pub user_review_level: i32,
    pub is_final_review: bool,
    pub can_review: bool,

    // Optional includes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub involved_parties: Option<Vec<InvolvedPartyResponse>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_links: Option<Vec<ExternalLinkResponse>>,
    /// Attachments bound to this incident, decorated with file
    /// metadata fetched from odo-asset. Returned when
    /// `options.with_attachments = true`. None means the caller didn't
    /// ask, not that there are no attachments.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<AttachmentResponse>>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/v1/current/incident/get",
    request_body = GetIncidentRequest,
    responses((status = 200, body = IncidentResponse, description = "Incident detail")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn get_incident(
    State(state): State<Arc<AppState>>,
    Json(params): Json<GetIncidentRequest>,
) -> ApiResult<Json<IncidentResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    let options = params.options.unwrap_or_default();

    let incident = load_incident(&state.db, params.id).await?;

    state
        .auth_client
        .permission_required_uuid("current.incident.read", Some(&incident.org_unit))
        .await?;

    let created_by_name = fetch_user_display_name(&state, incident.created_by).await;
    let org_info = fetch_org_info(&state, incident.org_unit).await;
    let sub_location_name = match incident.sub_location {
        Some(id) => sub_locations::Entity::find_by_id(id)
            .one(&state.db)
            .await?
            .map(|s| s.label),
        None => None,
    };
    let template_ids = load_template_ids(&state.db, incident.id).await?;
    let review_state = compute_review_state(&state, &incident, user_id).await?;

    let involved = if options.with_involved_parties {
        Some(load_involved_parties(&state, incident.id).await?)
    } else {
        None
    };

    let external = if options.with_external_links {
        Some(load_external_links(&state.db, incident.id).await?)
    } else {
        None
    };

    let attachments = if options.with_attachments {
        Some(load_incident_attachments(&state, incident.id).await?)
    } else {
        None
    };

    // Flatten the optional org address into the response's five
    // address fields. None means the org-unit lookup returned no
    // address — leave every component null.
    let (line1, line2, city, state_province, postal_code) = match org_info.address {
        Some(a) => (a.line1, a.line2, a.city, a.state, a.postal_code),
        None => (None, None, None, None, None),
    };

    Ok(Json(IncidentResponse {
        id: incident.id,
        org_unit: incident.org_unit,
        sub_location: incident.sub_location,
        title: incident.title,
        description: incident.description,
        metadata: incident.metadata,
        custom_fields: incident.custom_fields,
        ai_analysis: incident.ai_analysis,
        emergency_capture: incident.emergency_capture,
        called_emergency: incident.called_emergency,
        created_by: incident.created_by,
        resolved_by: incident.resolved_by,
        created_at: incident.created_at,
        occurred_at: incident.occurred_at,
        updated_at: incident.updated_at,
        resolved_at: incident.resolved_at,
        deleted_at: incident.deleted_at,
        created_by_name,
        sub_location_name,
        code: org_info.code,
        label: org_info.label,
        org_address_line1: line1,
        org_address_line2: line2,
        org_city: city,
        org_state: state_province,
        org_postal_code: postal_code,
        template_ids,
        creator_level: review_state.creator_level,
        user_review_level: review_state.user_review_level,
        is_final_review: review_state.is_final_review,
        can_review: review_state.can_review,
        involved_parties: involved,
        external_links: external,
        attachments,
    }))
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async fn load_incident(db: &DatabaseConnection, incident_id: i32) -> LocalResult<incidents::Model> {
    incidents::Entity::find_by_id(incident_id)
        .filter(incidents::Column::DeletedAt.is_null())
        .one(db)
        .await?
        .ok_or_else(|| LocalError::not_found("incident"))
}

async fn load_template_ids(db: &DatabaseConnection, incident_id: i32) -> LocalResult<Vec<i32>> {
    let rows = incident_template_map::Entity::find()
        .filter(incident_template_map::Column::Incident.eq(incident_id))
        .all(db)
        .await?;
    Ok(rows.into_iter().map(|r| r.template).collect())
}

async fn load_involved_parties(
    state: &AppState,
    incident_id: i32,
) -> LocalResult<Vec<InvolvedPartyResponse>> {
    use crate::entity::patrons;
    use std::collections::{HashMap, HashSet};

    let parties = involved_parties::Entity::find()
        .filter(involved_parties::Column::IncidentId.eq(incident_id))
        .all(&state.db)
        .await?;

    // Batch-load referenced patrons in one query rather than per-party.
    let patron_ids: Vec<i32> = parties.iter().filter_map(|p| p.patron_id).collect();
    let patrons: HashMap<i32, patrons::Model> = if patron_ids.is_empty() {
        HashMap::new()
    } else {
        patrons::Entity::find()
            .filter(patrons::Column::Id.is_in(patron_ids))
            .filter(patrons::Column::DeletedAt.is_null())
            .all(&state.db)
            .await?
            .into_iter()
            .map(|p| (p.id, p))
            .collect()
    };

    // Resolve each distinct staff_id once via odo-auth. Best-effort: an
    // unreachable user just leaves staff_display_name as None for that party.
    let staff_ids: HashSet<Uuid> = parties.iter().filter_map(|p| p.staff_id).collect();
    let mut staff_names: HashMap<Uuid, String> = HashMap::with_capacity(staff_ids.len());
    for staff_id in staff_ids {
        if let Some(name) = fetch_user_display_name(state, staff_id).await {
            staff_names.insert(staff_id, name);
        }
    }

    let result = parties
        .into_iter()
        .map(|party| {
            let patron = party.patron_id.and_then(|id| patrons.get(&id));
            let staff_display_name = party.staff_id.and_then(|id| staff_names.get(&id).cloned());
            InvolvedPartyResponse {
                id: party.id,
                patron_id: party.patron_id,
                staff_id: party.staff_id,
                is_unknown_patron: patron.map(|p| p.is_unknown),
                party_type: party.party_type,
                role: party.role,
                notes: party.notes,
                patron_display_name: patron.map(|p| p.display_name.clone()),
                staff_display_name,
                external_name: party.external_name,
                external_contact: party.external_contact,
            }
        })
        .collect();

    Ok(result)
}

/// Map a MIME type to the UI's `category` discriminator. Mirrors the
/// helper of the same name in `bans.rs::category_from_mime`.
fn attachment_category_from_mime(mime: &str) -> &'static str {
    if mime.starts_with("image/") {
        "photo"
    } else if mime.starts_with("video/") {
        "video"
    } else {
        "document"
    }
}

/// Read `incidents.attachments` for this incident and decorate each
/// row with file metadata from odo-asset. Files that have been
/// soft-deleted in odo-asset are silently omitted (mirrors how
/// `bans::load_activity_attachments` already handles the same case).
async fn load_incident_attachments(
    state: &AppState,
    incident_id: i32,
) -> LocalResult<Vec<AttachmentResponse>> {
    use std::collections::HashMap;

    let attach_rows = attachments::Entity::find()
        .filter(attachments::Column::IncidentId.eq(incident_id))
        .all(&state.db)
        .await?;

    let file_upload_ids: Vec<Uuid> = attach_rows
        .iter()
        .filter_map(|a| a.file_upload)
        .collect::<std::collections::HashSet<Uuid>>()
        .into_iter()
        .collect();

    let files: HashMap<Uuid, odo_client::client::FileUploadMetadata> = state
        .asset_client
        .get_files_by_uuid(&file_upload_ids)
        .await?
        .into_iter()
        .map(|f| (f.uuid, f))
        .collect();

    let mut out = Vec::with_capacity(attach_rows.len());
    for a in attach_rows {
        let Some(fu_id) = a.file_upload else { continue };
        let Some(file) = files.get(&fu_id) else {
            continue;
        };
        let mime = file.file_type.as_deref().unwrap_or("");
        out.push(AttachmentResponse {
            id: file.uuid,
            original_name: file.file_name.clone(),
            mime_type: file.file_type.clone(),
            size: file.file_size,
            relative_path: file.relative_path.clone(),
            category: attachment_category_from_mime(mime).to_string(),
        });
    }
    Ok(out)
}

async fn load_external_links(
    db: &DatabaseConnection,
    incident_id: i32,
) -> LocalResult<Vec<ExternalLinkResponse>> {
    let rows = external_link::Entity::find()
        .find_also_related(external_link_type::Entity)
        .filter(external_link::Column::Incident.eq(incident_id))
        .all(db)
        .await?;

    Ok(rows
        .into_iter()
        .map(|(link, link_type)| ExternalLinkResponse {
            id: link.id,
            incident: link.incident,
            url: link.url,
            title: link.title,
            link_type: link.link_type,
            description: link.description,
            restricted_access: link.restricted_access,
            added_by: link.added_by,
            added_at: link.added_at,
            link_type_label: link_type.as_ref().map(|t| t.label.clone()),
            link_type_description: link_type.as_ref().and_then(|t| t.description.clone()),
            link_type_display_order: link_type.as_ref().and_then(|t| t.display_order),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// External-service lookups
// ---------------------------------------------------------------------------

/// Best-effort fetch of a user's display name from odo-auth. Returns None on
/// any failure so a missing/unreachable user doesn't sink the whole request.
async fn fetch_user_display_name(state: &AppState, user_id: Uuid) -> Option<String> {
    let user = state
        .auth_client
        .get_user_by_uuid(&user_id, true)
        .await
        .ok()?;
    user.get("display_name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

struct OrgInfo {
    code: Option<String>,
    label: Option<String>,
    address: Option<OrgAddress>,
}

struct OrgAddress {
    line1: Option<String>,
    line2: Option<String>,
    city: Option<String>,
    state: Option<String>,
    postal_code: Option<String>,
}

/// Fetch org-unit code/label + the first "physical" address from odo-org.
/// Best-effort: any failure leaves the corresponding fields None.
async fn fetch_org_info(state: &AppState, org_unit: Uuid) -> OrgInfo {
    let Ok(detail) = state.org_client.get_unit_detail_by_uuid(&org_unit).await else {
        return OrgInfo {
            code: None,
            label: None,
            address: None,
        };
    };

    let unit = detail.get("org_unit");
    let code = unit
        .and_then(|u| u.get("code"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let label = unit
        .and_then(|u| u.get("label"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let address = detail
        .get("addresses")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|a| a["address_type"].as_str() == Some("physical"))
        })
        .map(|a| OrgAddress {
            line1: a["address_line1"].as_str().map(String::from),
            line2: a["address_line2"].as_str().map(String::from),
            city: a["city"].as_str().map(String::from),
            state: a["state_province"].as_str().map(String::from),
            postal_code: a["postal_code"].as_str().map(String::from),
        });

    OrgInfo {
        code,
        label,
        address,
    }
}

// ---------------------------------------------------------------------------
// Review state
// ---------------------------------------------------------------------------

struct ReviewState {
    creator_level: i32,
    user_review_level: i32,
    is_final_review: bool,
    can_review: bool,
}

async fn compute_review_state(
    state: &AppState,
    incident: &incidents::Model,
    user_id: Uuid,
) -> LocalResult<ReviewState> {
    let creator_level =
        review::creator_level(state, incident.created_by, incident.org_unit).await?;
    let user_review_level = review::reviewer_level(state, incident.org_unit, user_id).await?;
    let is_final_review = review::is_user_final_reviewer(state, incident.org_unit, user_id).await?;
    let can_review =
        review::user_can_review(state, incident, user_id, ReviewActionFlags::default())
            .await
            .unwrap_or(false);

    Ok(ReviewState {
        creator_level,
        user_review_level,
        is_final_review,
        can_review,
    })
}

// ===========================================================================
// Search
// ===========================================================================

const SEARCH_DEFAULT_LIMIT: u64 = 25;
const SEARCH_MAX_LIMIT: u64 = 10_000;

#[derive(Debug, Deserialize, Default, ToSchema)]
pub struct IncidentSearchOptions {
    #[serde(default)]
    pub with_involved_parties: bool,
}

#[derive(Debug, Deserialize, Default, ToSchema)]
pub struct SearchIncidentsRequest {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub org_unit: Option<Uuid>,
    #[serde(default)]
    pub is_resolved: Option<bool>,
    #[serde(default)]
    pub occurred_after: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(default)]
    pub occurred_before: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(default)]
    pub has_active_bans: Option<bool>,
    #[serde(default)]
    pub has_active_trespass: Option<bool>,
    #[serde(default)]
    pub patron: Option<i32>,
    #[serde(default)]
    pub sort_dir: Option<String>,
    #[serde(default)]
    pub sort_incident_date: Option<bool>,
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub offset: Option<u64>,
    #[serde(default)]
    pub options: Option<IncidentSearchOptions>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IncidentSearchRow {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub org_unit: Uuid,
    pub called_emergency: Option<bool>,
    pub created_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub occurred_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub resolved_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub deleted_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub created_by: Uuid,
    pub created_by_name: Option<String>,
    pub org_unit_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub involved_parties: Option<Vec<InvolvedPartyResponse>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SearchIncidentsResponse {
    pub incidents: Vec<IncidentSearchRow>,
    pub total_count: u64,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/incident/search",
    request_body = SearchIncidentsRequest,
    responses((status = 200, body = SearchIncidentsResponse, description = "Incident search results")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn search_incidents(
    State(state): State<Arc<AppState>>,
    Json(params): Json<SearchIncidentsRequest>,
) -> ApiResult<Json<SearchIncidentsResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    let limit = std::cmp::min(
        params.limit.unwrap_or(SEARCH_DEFAULT_LIMIT),
        SEARCH_MAX_LIMIT,
    );
    let offset = params.offset.unwrap_or(0);

    // Org-unit filter expands to the unit + all descendants via odo-org.
    let org_scope = match params.org_unit {
        Some(id) => Some(state.org_client.descendant_uuids(&id).await?),
        None => None,
    };

    let base_filters = build_filters(&params, org_scope.as_deref())?;
    let total_count = run_count(&state.db, &base_filters).await?;

    let rows = run_search(&state.db, &base_filters, &params, limit, offset).await?;

    let (creator_names, org_names) = fetch_display_names(&state, &rows).await;

    let involved_by_incident = if params
        .options
        .as_ref()
        .map(|o| o.with_involved_parties)
        .unwrap_or(false)
        && !rows.is_empty()
    {
        let ids: Vec<i32> = rows.iter().map(|r| r.id).collect();
        load_involved_parties_batch(&state, &ids).await?
    } else {
        HashMap::new()
    };

    let with_parties = params
        .options
        .as_ref()
        .map(|o| o.with_involved_parties)
        .unwrap_or(false);

    let incidents = rows
        .into_iter()
        .map(|m| IncidentSearchRow {
            id: m.id,
            title: m.title,
            description: m.description,
            org_unit: m.org_unit,
            called_emergency: m.called_emergency,
            created_at: m.created_at,
            occurred_at: m.occurred_at,
            updated_at: m.updated_at,
            resolved_at: m.resolved_at,
            deleted_at: m.deleted_at,
            created_by: m.created_by,
            created_by_name: creator_names.get(&m.created_by).cloned(),
            org_unit_name: org_names.get(&m.org_unit).cloned(),
            involved_parties: if with_parties {
                Some(involved_by_incident.get(&m.id).cloned().unwrap_or_default())
            } else {
                None
            },
        })
        .collect();

    Ok(Json(SearchIncidentsResponse {
        incidents,
        total_count,
    }))
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

/// Collected filter expressions ready to be applied to either a `find()` or
/// `count()` query. Built once and used twice.
struct SearchFilters {
    exprs: Vec<sea_orm::sea_query::SimpleExpr>,
}

fn build_filters(
    params: &SearchIncidentsRequest,
    org_scope: Option<&[Uuid]>,
) -> LocalResult<SearchFilters> {
    let mut exprs: Vec<sea_orm::sea_query::SimpleExpr> = Vec::new();

    // Always exclude soft-deleted rows.
    exprs.push(incidents::Column::DeletedAt.is_null());

    if let Some(q) = params
        .query
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let pattern = format!("%{q}%");
        exprs.push(
            incidents::Column::Title
                .ilike(&pattern)
                .or(incidents::Column::Description.ilike(&pattern)),
        );
    }

    if let Some(ids) = org_scope {
        if ids.is_empty() {
            // No matching org units => guarantee zero results.
            exprs.push(Expr::val(false));
        } else {
            exprs.push(incidents::Column::OrgUnit.is_in(ids.iter().copied()));
        }
    }

    if let Some(resolved) = params.is_resolved {
        exprs.push(if resolved {
            incidents::Column::ResolvedAt.is_not_null()
        } else {
            incidents::Column::ResolvedAt.is_null()
        });
    }

    if let Some(after) = params.occurred_after {
        exprs.push(incidents::Column::OccurredAt.gte(after));
    }
    if let Some(before) = params.occurred_before {
        exprs.push(incidents::Column::OccurredAt.lte(before));
    }

    if let Some(patron_id) = params.patron {
        exprs.push(
            incidents::Column::Id.in_subquery(
                sea_orm::sea_query::Query::select()
                    .column(involved_parties::Column::IncidentId)
                    // .table_ref() keeps the entity's schema qualifier
                    // (incidents.involved_parties); a bare Entity in a
                    // raw sea_query drops it and relies on search_path.
                    .from(involved_parties::Entity.table_ref())
                    .and_where(involved_parties::Column::PatronId.eq(patron_id))
                    .to_owned(),
            ),
        );
    }

    if params.has_active_bans == Some(true) {
        exprs.push(incidents::Column::Id.in_subquery(active_patron_ban_subquery(false)));
    }
    if params.has_active_trespass == Some(true) {
        exprs.push(incidents::Column::Id.in_subquery(active_patron_ban_subquery(true)));
    }

    Ok(SearchFilters { exprs })
}

fn active_patron_ban_subquery(is_trespass: bool) -> sea_orm::sea_query::SelectStatement {
    use sea_orm::sea_query::{Cond, Expr as SqExpr};
    sea_orm::sea_query::Query::select()
        .column(patron_ban::Column::Incident)
        .from(patron_ban::Entity.table_ref())
        .and_where(patron_ban::Column::IsTrespass.eq(is_trespass))
        .cond_where(
            Cond::any()
                .add(SqExpr::col(patron_ban::Column::ArchivesAt).is_null())
                .add(SqExpr::col(patron_ban::Column::ArchivesAt).gt(SqExpr::current_date())),
        )
        .and_where(SqExpr::col(patron_ban::Column::LiftsAt).gt(SqExpr::current_date()))
        .to_owned()
}

fn apply_filters<S>(mut q: S, f: &SearchFilters) -> S
where
    S: sea_orm::QueryFilter,
{
    for e in &f.exprs {
        q = q.filter(e.clone());
    }
    q
}

async fn run_count(db: &DatabaseConnection, f: &SearchFilters) -> LocalResult<u64> {
    let q = apply_filters(incidents::Entity::find(), f);
    Ok(q.count(db).await?)
}

async fn run_search(
    db: &DatabaseConnection,
    f: &SearchFilters,
    params: &SearchIncidentsRequest,
    limit: u64,
    offset: u64,
) -> LocalResult<Vec<incidents::Model>> {
    let mut q = apply_filters(incidents::Entity::find(), f);

    let descending = params
        .sort_dir
        .as_deref()
        .map(|s| s.eq_ignore_ascii_case("desc"))
        .unwrap_or(false);

    q = if params.sort_incident_date == Some(true) {
        let order = if descending { Order::Desc } else { Order::Asc };
        q.order_by(incidents::Column::OccurredAt, order)
    } else {
        // Default ordering mirrors the legacy: most-recently created first.
        q.order_by_desc(incidents::Column::CreatedAt)
    };

    Ok(q.limit(limit).offset(offset).all(db).await?)
}

/// Batch-fetch creator display names from odo-auth and org-unit labels from
/// odo-org. Each lookup is best-effort — failures leave the field None on
/// affected rows rather than failing the whole request.
async fn fetch_display_names(
    state: &AppState,
    rows: &[incidents::Model],
) -> (HashMap<Uuid, String>, HashMap<Uuid, String>) {
    let creator_ids: HashSet<Uuid> = rows.iter().map(|r| r.created_by).collect();
    let org_ids: HashSet<Uuid> = rows.iter().map(|r| r.org_unit).collect();

    let mut creators = HashMap::with_capacity(creator_ids.len());
    for id in creator_ids {
        if let Some(name) = fetch_user_display_name(state, id).await {
            creators.insert(id, name);
        }
    }

    let mut orgs = HashMap::with_capacity(org_ids.len());
    for id in org_ids {
        if let Some(name) = fetch_org_label(state, id).await {
            orgs.insert(id, name);
        }
    }

    (creators, orgs)
}

/// Org-unit label only (just the `label` field from the detail document).
async fn fetch_org_label(state: &AppState, org_unit: Uuid) -> Option<String> {
    let detail = state
        .org_client
        .get_unit_detail_by_uuid(&org_unit)
        .await
        .ok()?;
    detail
        .get("org_unit")
        .and_then(|u| u.get("label"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Batched involved-parties loader for the search result set. Returns a map
/// keyed by incident_id. Resolves patron and staff display names with one
/// query per distinct referenced patron / staff member.
async fn load_involved_parties_batch(
    state: &AppState,
    incident_ids: &[i32],
) -> LocalResult<HashMap<i32, Vec<InvolvedPartyResponse>>> {
    use crate::entity::patrons;

    let parties = involved_parties::Entity::find()
        .filter(involved_parties::Column::IncidentId.is_in(incident_ids.iter().copied()))
        .all(&state.db)
        .await?;

    let patron_ids: Vec<i32> = parties.iter().filter_map(|p| p.patron_id).collect();
    let patrons: HashMap<i32, patrons::Model> = if patron_ids.is_empty() {
        HashMap::new()
    } else {
        patrons::Entity::find()
            .filter(patrons::Column::Id.is_in(patron_ids))
            .filter(patrons::Column::DeletedAt.is_null())
            .all(&state.db)
            .await?
            .into_iter()
            .map(|p| (p.id, p))
            .collect()
    };

    let staff_ids: HashSet<Uuid> = parties.iter().filter_map(|p| p.staff_id).collect();
    let mut staff_names: HashMap<Uuid, String> = HashMap::with_capacity(staff_ids.len());
    for id in staff_ids {
        if let Some(name) = fetch_user_display_name(state, id).await {
            staff_names.insert(id, name);
        }
    }

    let mut map: HashMap<i32, Vec<InvolvedPartyResponse>> = HashMap::new();
    for party in parties {
        let patron = party.patron_id.and_then(|id| patrons.get(&id));
        let staff_display_name = party.staff_id.and_then(|id| staff_names.get(&id).cloned());
        map.entry(party.incident_id)
            .or_default()
            .push(InvolvedPartyResponse {
                id: party.id,
                patron_id: party.patron_id,
                staff_id: party.staff_id,
                is_unknown_patron: patron.map(|p| p.is_unknown),
                party_type: party.party_type,
                role: party.role,
                notes: party.notes,
                patron_display_name: patron.map(|p| p.display_name.clone()),
                staff_display_name,
                external_name: party.external_name,
                external_contact: party.external_contact,
            });
    }

    Ok(map)
}

// ===========================================================================
// Activity log
// ===========================================================================

/// Event types surfaced on the incident detail "activity" tab. Excludes
/// ban-side events, which have their own endpoint.
///
/// `incident.review.*` strings here match what's actually inserted by
/// review actions: `format!("incident.review.{result}")` where `{result}`
/// is the wire string of [`crate::review::ReviewResult`] (e.g.
/// "approved-with-edits" with a hyphen, not an underscore — the legacy
/// whitelist had this typo and silently dropped those rows).
const INCIDENT_ACTIVITY_EVENT_TYPES: &[&str] = &[
    "incident.created",
    "incident.updated",
    "incident.review.submitted",
    "incident.review.approved",
    "incident.review.approved-with-edits",
    "incident.review.returned",
    "incident.review.deleted",
    "incident.review.resolved",
    "incident.review.reopened",
];

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetActivityRequest {
    pub incident_id: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ActivityLogEntry {
    pub id: i64,
    pub event_type: String,
    pub actor_id: Uuid,
    pub actor_name: Option<String>,
    pub org_unit: Option<Uuid>,
    pub org_unit_name: Option<String>,
    pub incident_id: Option<i32>,
    pub event_data: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GetActivityResponse {
    pub entries: Vec<ActivityLogEntry>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/incident/activity",
    request_body = GetActivityRequest,
    responses((status = 200, body = GetActivityResponse, description = "Activity log for an incident")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn get_activity(
    State(state): State<Arc<AppState>>,
    Json(params): Json<GetActivityRequest>,
) -> ApiResult<Json<GetActivityResponse>> {
    // Look up the incident's org_unit to scope the permission check.
    // The legacy implementation only ran checkauth (no perm check), but
    // gating on incident.incident.read at this org unit is the natural
    // permission and matches the rest of the incident-detail endpoints.
    let incident = load_incident(&state.db, params.incident_id).await?;

    state
        .auth_client
        .permission_required_uuid("current.incident.read", Some(&incident.org_unit))
        .await?;

    let rows = activity_log::Entity::find()
        .filter(activity_log::Column::IncidentId.eq(params.incident_id))
        .filter(
            activity_log::Column::EventType.is_in(INCIDENT_ACTIVITY_EVENT_TYPES.iter().copied()),
        )
        .order_by_desc(activity_log::Column::CreatedAt)
        .order_by_desc(activity_log::Column::Id)
        .all(&state.db)
        .await?;

    // Batch-resolve actor display names (one auth call per distinct actor)
    // and org-unit labels (one org call per distinct org_unit).
    let actor_ids: HashSet<Uuid> = rows.iter().map(|r| r.actor_id).collect();
    let mut actor_names: HashMap<Uuid, String> = HashMap::with_capacity(actor_ids.len());
    for id in actor_ids {
        if let Some(name) = fetch_user_display_name(&state, id).await {
            actor_names.insert(id, name);
        }
    }

    let org_ids: HashSet<Uuid> = rows.iter().filter_map(|r| r.org_unit).collect();
    let mut org_names: HashMap<Uuid, String> = HashMap::with_capacity(org_ids.len());
    for id in org_ids {
        if let Some(name) = fetch_org_label(&state, id).await {
            org_names.insert(id, name);
        }
    }

    let entries = rows
        .into_iter()
        .map(|r| ActivityLogEntry {
            id: r.id,
            event_type: r.event_type,
            actor_id: r.actor_id,
            actor_name: actor_names.get(&r.actor_id).cloned(),
            org_unit: r.org_unit,
            org_unit_name: r.org_unit.and_then(|id| org_names.get(&id).cloned()),
            incident_id: r.incident_id,
            event_data: r.event_data,
            created_at: r.created_at,
        })
        .collect();

    Ok(Json(GetActivityResponse { entries }))
}

// ===========================================================================
// Create incident
// ===========================================================================
//
// The legacy create_incident handler is ~877 lines because it inlines every
// downstream operation: template mappings, involved parties (with unknown-
// patron creation), external links, attachments (writing to asset.file_upload),
// and `pending_bans` metadata (which creates bans/trespasses and triggers
// notifications).
//
// `pending_bans` / `pending_extends` are now handled via
// `bans::apply_pending_bans` (called pre-commit) +
// `bans::fire_pending_ban_notifications` (post-commit, best-effort).
//
// Attachments are bound via `attachment_file_upload_ids` on the request:
// the UI uploads files through odo-asset (which writes the
// `asset.file_upload` row) and passes the returned ids; we only write
// the `incidents.attachments` join row. Same contract as
// `patron.photo.create` and `ban.add-to`.

#[derive(Debug, Deserialize, Clone, ToSchema)]
pub struct CreateInvolvedParty {
    pub party_type: String,
    #[serde(default)]
    pub patron_id: Option<i32>,
    #[serde(default)]
    pub staff_id: Option<Uuid>,
    #[serde(default)]
    pub external_name: Option<String>,
    #[serde(default)]
    pub external_contact: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub is_unknown_patron: Option<bool>,
}

/// Shape the UI renders for an attachment (form-side AND incident-detail).
/// Pulled from `asset.file_upload` via `state.asset_client.get_files` on
/// read; never written by `current` directly (the UI uploads through
/// odo-asset before calling create / update).
#[derive(Debug, Serialize, Clone, ToSchema)]
pub struct AttachmentResponse {
    /// The file's stable odo-asset uuid (matches the ids the client sends
    /// in `attachment_file_upload_ids` / `remove_attachment_ids`).
    pub id: Uuid,
    /// Original filename the user picked, suitable for display.
    pub original_name: String,
    /// MIME type echoed back so the UI can pick the right renderer.
    /// The category is derived from this prefix (image/* → photo, etc.).
    pub mime_type: Option<String>,
    pub size: Option<i32>,
    pub relative_path: String,
    /// Echoed back to keep the UI's existing
    /// `attachments.filter(a => a.category === 'photo')` rendering paths
    /// unchanged. Derived from `mime_type`.
    pub category: String,
}

#[derive(Debug, Deserialize, Clone, ToSchema)]
pub struct CreateExternalLink {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub link_type: Option<i32>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateIncidentRequest {
    pub org_unit: Uuid,
    pub title: String,
    pub description: String,

    #[serde(default)]
    pub sub_location: Option<i32>,
    #[serde(default)]
    pub template_ids: Option<Vec<i32>>,
    #[serde(default)]
    pub called_emergency: Option<bool>,
    #[serde(default)]
    pub occurred_at: Option<chrono::DateTime<chrono::FixedOffset>>,

    /// Free-form metadata. One nested key is extracted out and handled
    /// specially:
    ///   - `external_links`: Vec<CreateExternalLink> — written to
    ///     incidents.external_link (and removed from the metadata that's
    ///     persisted on the incident row itself).
    ///
    /// `pending_bans` / `pending_extends` are also read from metadata
    /// and handled by `bans::apply_pending_bans` — they're not stripped
    /// (so the original intent survives in the persisted blob for
    /// audit) but they do not affect the row otherwise.
    ///
    /// The UI sometimes double-stringifies this (sends `metadata: "{...}"`
    /// instead of `metadata: {...}`). We try the object form first and fall
    /// back to parsing a JSON string.
    #[serde(default, deserialize_with = "deserialize_metadata")]
    pub metadata: Option<serde_json::Value>,

    #[serde(default)]
    pub involved_parties: Vec<CreateInvolvedParty>,

    /// File-upload row ids the UI has already created via
    /// `POST /api/v1/odo/asset/upload`. Each id becomes one
    /// `incidents.attachments` join row pointing back at the file.
    /// Empty / omitted = no attachments. The legacy contract embedded
    /// full file metadata under `metadata.attachments`; that path
    /// double-wrote the file row and is gone.
    #[serde(default)]
    pub attachment_file_upload_ids: Option<Vec<Uuid>>,
}

/// Accept either a JSON object or a JSON-encoded string (the latter is what
/// the UI's `JSON.stringify(metadata)` produces).
fn deserialize_metadata<'de, D>(d: D) -> Result<Option<serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw: Option<serde_json::Value> = Option::deserialize(d)?;
    match raw {
        Some(serde_json::Value::String(s)) => serde_json::from_str(&s)
            .map(Some)
            .map_err(serde::de::Error::custom),
        other => Ok(other),
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateIncidentResponse {
    pub id: i32,
    pub created_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub updated_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub occurred_at: chrono::DateTime<chrono::FixedOffset>,
    /// ids of bans created via `metadata.pending_bans[]`. Empty when
    /// the form didn't toggle any inline bans. Best-effort: bad
    /// entries are skipped with a warn-log, not surfaced as errors.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub created_ban_ids: Vec<i32>,
    /// ids of bans extended via `metadata.pending_extends[]`. Same
    /// best-effort semantics as `created_ban_ids`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub extended_ban_ids: Vec<i32>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/incident/create",
    request_body = CreateIncidentRequest,
    responses((status = 200, body = CreateIncidentResponse, description = "Newly created incident's identifiers")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn create_incident(
    State(state): State<Arc<AppState>>,
    Json(params): Json<CreateIncidentRequest>,
) -> ApiResult<Json<CreateIncidentResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    state
        .auth_client
        .permission_required_uuid("current.incident.write", Some(&params.org_unit))
        .await?;

    tracing::info!(
        org_unit = %params.org_unit,
        title = %params.title,
        "CreateIncident"
    );

    // Validate attachment ids against odo-asset before opening the txn, so
    // the network round-trip doesn't hold the transaction open (same reason
    // the permission check above runs pre-txn).
    if let Some(ids) = params.attachment_file_upload_ids.as_ref() {
        validate_attachment_ids(&state, user_id, ids).await?;
    }

    // Pull out the special metadata fields so they don't end up persisted
    // twice (once on the incident row, once via their proper tables).
    let (clean_metadata, external_links_param) = extract_special_metadata(params.metadata.as_ref());

    let txn = state.db.begin().await?;

    let incident = insert_incident(&txn, &params, user_id, clean_metadata.as_ref()).await?;
    log_incident_created(&txn, incident.id, params.org_unit, user_id, &params.title).await?;

    if let Some(ids) = params.template_ids.as_ref() {
        insert_template_mappings(&txn, incident.id, ids).await?;
    }

    insert_involved_parties(&txn, incident.id, user_id, &params.involved_parties).await?;
    insert_external_links(&txn, incident.id, user_id, &external_links_param).await?;
    if let Some(ids) = params.attachment_file_upload_ids.as_ref() {
        insert_attachments(&txn, incident.id, ids).await?;
    }

    // Inline ban creates/extends from the New Incident form. The
    // permission check we already ran (`incident.incident.write` at
    // params.org_unit) doubles as the gate for these — incident-level
    // write rights at an org imply ban writes at that same org by
    // policy. Pre-commit so an incident-create failure also rolls
    // these back.
    let pending_outcome = crate::bans::apply_pending_bans(
        &txn,
        params.metadata.as_ref(),
        incident.id,
        params.org_unit,
        user_id,
    )
    .await?;

    txn.commit().await?;

    // Notifications fire post-commit (best-effort). Each enqueue
    // failure is logged inside `fire_pending_ban_notifications` and
    // doesn't fail the incident-create.
    crate::bans::fire_pending_ban_notifications(&state, pending_outcome.notifications).await;

    Ok(Json(CreateIncidentResponse {
        id: incident.id,
        created_at: incident.created_at,
        updated_at: incident.updated_at,
        occurred_at: incident.occurred_at,
        created_ban_ids: pending_outcome.created_ban_ids,
        extended_ban_ids: pending_outcome.extended_ban_ids,
    }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Pull `external_links` out of metadata (it goes to its own table)
/// and return the cleaned metadata for persistence on the incident row.
/// Robustly handles missing/non-object metadata.
///
/// Attachments used to be split out here too (the legacy UI embedded
/// full file metadata under `metadata.attachments`). The UI now uploads
/// through odo-asset first and passes
/// `attachment_file_upload_ids` at the top level, so the metadata blob
/// no longer carries any attachment payload to extract.
fn extract_special_metadata(
    metadata: Option<&serde_json::Value>,
) -> (Option<serde_json::Value>, Vec<CreateExternalLink>) {
    let Some(meta) = metadata else {
        return (None, Vec::new());
    };

    let mut clean = meta.clone();
    let mut external_links_param = Vec::new();

    if let Some(obj) = clean.as_object_mut()
        && let Some(raw) = obj.remove("external_links")
    {
        match serde_json::from_value::<Vec<CreateExternalLink>>(raw) {
            Ok(parsed) => external_links_param = parsed,
            Err(e) => {
                tracing::warn!(error = %e, "metadata.external_links did not parse; ignoring")
            }
        }
    }

    (Some(clean), external_links_param)
}

async fn insert_incident<C: ConnectionTrait>(
    txn: &C,
    params: &CreateIncidentRequest,
    user_id: Uuid,
    metadata: Option<&serde_json::Value>,
) -> LocalResult<incidents::Model> {
    let mut model = incidents::ActiveModel {
        org_unit: Set(params.org_unit),
        title: Set(params.title.clone()),
        description: Set(Some(params.description.clone())),
        created_by: Set(user_id),
        ..Default::default()
    };

    if let Some(sub) = params.sub_location {
        model.sub_location = Set(Some(sub));
    }
    if let Some(emerg) = params.called_emergency {
        model.called_emergency = Set(Some(emerg));
    }
    if let Some(occurred) = params.occurred_at {
        model.occurred_at = Set(occurred);
    }
    if let Some(meta) = metadata {
        // Persist as a real JSON object in the jsonb column. The legacy
        // path wrote a string-of-JSON (`{"key":"value"}` stored as the
        // string `"{\"key\":\"value\"}"`), which the UI then had to
        // JSON.parse on the way out. That worked but compounded on
        // every save — each round-trip added another quoting layer,
        // turning `{}` into `"{}"` into `"\"{}\""` and so on.
        // `deserialize_metadata` already unwraps the UI's
        // `JSON.stringify` on input, so by this point `meta` is a real
        // object and we just store it.
        model.metadata = Set(Some(meta.clone()));
    }

    let inserted = model.insert(txn).await?;
    tracing::info!(incident_id = inserted.id, "incident created");
    Ok(inserted)
}

async fn log_incident_created<C: ConnectionTrait>(
    txn: &C,
    incident_id: i32,
    org_unit: Uuid,
    user_id: Uuid,
    title: &str,
) -> LocalResult<()> {
    let row = activity_log::ActiveModel {
        event_type: Set("incident.created".to_string()),
        actor_id: Set(user_id),
        org_unit: Set(Some(org_unit)),
        incident_id: Set(Some(incident_id)),
        event_data: Set(serde_json::json!({"title": title})),
        ..Default::default()
    };
    row.insert(txn).await?;
    Ok(())
}

async fn insert_template_mappings<C: ConnectionTrait>(
    txn: &C,
    incident_id: i32,
    template_ids: &[i32],
) -> LocalResult<()> {
    if template_ids.is_empty() {
        return Ok(());
    }
    let rows: Vec<incident_template_map::ActiveModel> = template_ids
        .iter()
        .map(|tid| incident_template_map::ActiveModel {
            incident: Set(incident_id),
            template: Set(*tid),
            ..Default::default()
        })
        .collect();
    incident_template_map::Entity::insert_many(rows)
        .exec(txn)
        .await?;
    Ok(())
}

async fn insert_involved_parties<C: ConnectionTrait>(
    txn: &C,
    incident_id: i32,
    user_id: Uuid,
    parties: &[CreateInvolvedParty],
) -> LocalResult<()> {
    for party in parties {
        let patron_id = if party.is_unknown_patron.unwrap_or(false) && party.patron_id.is_none() {
            // Create an "unknown patron" record on demand so we have something
            // to attach the involved-party row to. Mirrors the legacy shape.
            let unknown_name = format!("Unknown (Incident #{incident_id})");
            let new_patron = patrons::ActiveModel {
                first_name: Set(unknown_name.clone()),
                last_name: Set(String::new()),
                is_unknown: Set(true),
                created_by: Set(Some(user_id)),
                ..Default::default()
            };
            let created = new_patron.insert(txn).await?;
            tracing::info!(
                incident_id,
                patron_id = created.id,
                "created unknown patron for incident"
            );
            Some(created.id)
        } else {
            party.patron_id
        };

        let row = involved_parties::ActiveModel {
            incident_id: Set(incident_id),
            party_type: Set(party.party_type.clone()),
            patron_id: Set(patron_id),
            staff_id: Set(party.staff_id),
            external_name: Set(party.external_name.clone()),
            external_contact: Set(party.external_contact.clone()),
            role: Set(party.role.clone()),
            notes: Set(party.notes.clone()),
            ..Default::default()
        };
        row.insert(txn).await?;
    }
    Ok(())
}

async fn insert_external_links<C: ConnectionTrait>(
    txn: &C,
    incident_id: i32,
    user_id: Uuid,
    links: &[CreateExternalLink],
) -> LocalResult<()> {
    if links.is_empty() {
        return Ok(());
    }
    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
    let rows: Vec<external_link::ActiveModel> = links
        .iter()
        .map(|l| external_link::ActiveModel {
            incident: Set(Some(incident_id)),
            url: Set(l.url.clone()),
            title: Set(l.title.clone()),
            link_type: Set(l.link_type),
            description: Set(l.description.clone()),
            added_by: Set(Some(user_id)),
            added_at: Set(now),
            // `restricted_access` defaults to false at the DB level but
            // the entity column is NOT NULL, so set it explicitly here.
            restricted_access: Set(false),
            ..Default::default()
        })
        .collect();
    external_link::Entity::insert_many(rows).exec(txn).await?;
    Ok(())
}

/// Validate that every id resolves to a live file in odo-asset that the
/// caller uploaded, before we bind it.
///
/// Two checks, both yielding a clean 400 rather than trusting the client:
///   - The id must resolve. `get_files` omits missing/soft-deleted rows, so
///     any id absent from its response is unknown or deleted. (The DB FK
///     alone would only catch a truly-nonexistent id, as a 500.)
///   - The file's `uploaded_by` must be the caller. Files are uploaded and
///     linked by the same user, so this is a valid ownership invariant — it
///     stops one user binding another user's file by guessing its
///     (sequential) id. This is the real authorization gate; it holds even
///     if an id leaks.
async fn validate_attachment_ids(state: &AppState, user_id: Uuid, ids: &[Uuid]) -> LocalResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    // Map uuid -> uploader uuid for the files that resolved.
    let owners: std::collections::HashMap<Uuid, Option<Uuid>> = state
        .asset_client
        .get_files_by_uuid(ids)
        .await?
        .into_iter()
        .map(|f| (f.uuid, f.uploaded_by_uuid))
        .collect();

    // Unknown/deleted: requested but not returned.
    let mut missing: Vec<Uuid> = ids
        .iter()
        .copied()
        .filter(|id| !owners.contains_key(id))
        .collect();
    if !missing.is_empty() {
        missing.sort_unstable();
        missing.dedup();
        return Err(LocalError::invalid_input(format!(
            "unknown or deleted file_upload id(s): {missing:?}"
        )));
    }

    // Not owned by the caller.
    let mut not_owned: Vec<Uuid> = ids
        .iter()
        .copied()
        .filter(|id| owners.get(id) != Some(&Some(user_id)))
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

/// Bind already-uploaded files (rows in `asset.file_upload` that odo-asset
/// wrote during the UI's upload step) to this incident by inserting
/// `incidents.attachments` join rows. The file_upload rows themselves
/// are not touched here — that's odo-asset's job. Callers must run
/// `validate_attachment_ids` first.
async fn insert_attachments<C: ConnectionTrait>(
    txn: &C,
    incident_id: i32,
    file_upload_ids: &[Uuid],
) -> LocalResult<()> {
    if file_upload_ids.is_empty() {
        return Ok(());
    }
    let rows: Vec<attachments::ActiveModel> = file_upload_ids
        .iter()
        .map(|id| attachments::ActiveModel {
            incident_id: Set(Some(incident_id)),
            file_upload: Set(Some(*id)),
            // activity_log_id is not set on creation-time attachments;
            // only attachments added via `ban.add_to` or the "add to
            // incident" follow-up flows link to a specific activity row.
            activity_log_id: ActiveValue::NotSet,
            ..Default::default()
        })
        .collect();
    attachments::Entity::insert_many(rows).exec(txn).await?;
    Ok(())
}

// ===========================================================================
// update_incident
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateIncidentRequest {
    pub id: i32,

    // --- Scalar fields. Omitted fields are left untouched. ---
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Same `JSON.stringify(...)` quirk as create: the UI sends this
    /// pre-stringified, so we use the shared deserializer that unwraps
    /// the outer string layer. Without this, the wrapping piles up on
    /// each save (`{}` → `"{}"` → `"\"{}\""`) and breaks downstream
    /// readers.
    #[serde(default, deserialize_with = "deserialize_metadata")]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub sub_location: Option<i32>,
    #[serde(default)]
    pub called_emergency: Option<bool>,
    #[serde(default)]
    pub occurred_at: Option<chrono::DateTime<chrono::FixedOffset>>,

    // NOTE: there's deliberately no `org_unit` field here. The legacy
    // endpoint accepted one and would silently move an incident to a
    // different org, which means a caller who held
    // `incident.incident.write` at the source could relocate the
    // incident to an org they had no write rights on — and any
    // subsequent reviewer/permission checks at the new org would then
    // pass or fail according to *that* org's rules. We drop the field
    // entirely; org moves should require their own gated endpoint
    // (currently none) rather than riding inside a generic edit.
    /// One-way latch: setting `true` resolves an unresolved incident
    /// (sets `resolved_at` + `resolved_by`). `false` does nothing — to
    /// reopen, use `incident.review.create` with `result: "reopened"`,
    /// which goes through the review-chain permission checks.
    #[serde(default)]
    pub is_resolved: Option<bool>,

    /// One-way latch: setting `true` soft-deletes the incident. `false`
    /// does nothing. Legacy did not support undelete via this endpoint
    /// either.
    #[serde(default)]
    pub is_deleted: Option<bool>,

    /// Full-replace semantics: passing `Some([..])` clears the
    /// incident's existing `incident_template_map` rows and inserts a
    /// new mapping for each id. Passing `Some([])` clears all
    /// templates. `None` (the field omitted from the payload) leaves
    /// the existing mapping untouched — "no change" rather than
    /// "clear", same shape as the legacy port (CRT-88).
    #[serde(default)]
    pub template_ids: Option<Vec<i32>>,

    // --- Diff-style mutations on related rows. ---
    #[serde(default)]
    pub add_involved_parties: Option<Vec<CreateInvolvedParty>>,
    #[serde(default)]
    pub remove_involved_parties: Option<Vec<i32>>,
    #[serde(default)]
    pub add_external_links: Option<Vec<CreateExternalLink>>,
    #[serde(default)]
    pub remove_external_links: Option<Vec<i32>>,

    /// file_upload row ids to bind to this incident, same contract as
    /// create's `attachment_file_upload_ids`: odo-asset already wrote the
    /// `asset.file_upload` row at upload time; we only add the
    /// `incidents.attachments` join row.
    #[serde(default)]
    pub add_attachment_file_upload_ids: Option<Vec<Uuid>>,
    /// file_upload ids to unlink from this incident. These match the
    /// `id` field returned for each attachment by `incident/get` (which
    /// is the file_upload id, not the join-row id). We delete the
    /// `incidents.attachments` join rows pointing at these files; the
    /// `asset.file_upload` rows are left intact — deleting the file is
    /// odo-asset's `files/delete` endpoint's job.
    #[serde(default)]
    pub remove_attachment_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateIncidentResponse {
    pub id: i32,
    pub org_unit: Uuid,
    pub sub_location: Option<i32>,
    pub title: String,
    pub description: Option<String>,
    pub called_emergency: Option<bool>,
    pub occurred_at: chrono::DateTime<chrono::FixedOffset>,
    pub created_by: Uuid,
    pub created_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub updated_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub resolved_by: Option<Uuid>,
    pub resolved_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub deleted_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub metadata: Option<serde_json::Value>,
}

impl From<incidents::Model> for UpdateIncidentResponse {
    fn from(m: incidents::Model) -> Self {
        Self {
            id: m.id,
            org_unit: m.org_unit,
            sub_location: m.sub_location,
            title: m.title,
            description: m.description,
            called_emergency: m.called_emergency,
            occurred_at: m.occurred_at,
            created_by: m.created_by,
            created_at: m.created_at,
            updated_at: m.updated_at,
            resolved_by: m.resolved_by,
            resolved_at: m.resolved_at,
            deleted_at: m.deleted_at,
            metadata: m.metadata,
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/current/incident/update",
    request_body = UpdateIncidentRequest,
    responses((status = 200, body = UpdateIncidentResponse, description = "Updated incident row")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn update_incident(
    State(state): State<Arc<AppState>>,
    Json(params): Json<UpdateIncidentRequest>,
) -> ApiResult<Json<UpdateIncidentResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    // Permission check runs against the incident's existing org_unit.
    // org_unit is immutable through this endpoint (see request struct
    // comment), so there's no risk of the caller editing under one
    // org's perms and the change landing under another's.
    let existing = incidents::Entity::find_by_id(params.id)
        .filter(incidents::Column::DeletedAt.is_null())
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("incident {}", params.id)))?;
    let org_unit = existing.org_unit;

    state
        .auth_client
        .permission_required_uuid("current.incident.write", Some(&org_unit))
        .await?;

    tracing::info!(incident_id = params.id, %org_unit, "UpdateIncident");

    // Validate newly-bound attachment ids against odo-asset before the txn
    // (see the matching note in create_incident). Removals aren't validated:
    // unlinking an already-gone file is a harmless no-op.
    if let Some(ids) = params.add_attachment_file_upload_ids.as_ref() {
        validate_attachment_ids(&state, user_id, ids).await?;
    }

    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
    let was_resolved = existing.resolved_at.is_some();
    let was_deleted = existing.deleted_at.is_some();

    let txn = state.db.begin().await?;

    // 1. Scalar update on the incidents row. We always bump updated_at,
    //    even when no other field changes, to match legacy.
    let mut active: incidents::ActiveModel = existing.into();
    active.updated_at = Set(Some(now));

    if let Some(v) = params.title {
        active.title = Set(v);
    }
    if let Some(v) = params.description {
        active.description = Set(Some(v));
    }
    if let Some(v) = params.metadata {
        // Write a real JSON object, not a stringified copy — see the
        // matching note in `insert_incident`. `deserialize_metadata`
        // has already unwrapped the UI's `JSON.stringify` on input.
        active.metadata = Set(Some(v));
    }
    if let Some(v) = params.sub_location {
        active.sub_location = Set(Some(v));
    }
    if let Some(v) = params.called_emergency {
        active.called_emergency = Set(Some(v));
    }
    if let Some(v) = params.occurred_at {
        active.occurred_at = Set(v);
    }

    // One-way latches: only apply when the incident is not already in
    // the target state. Setting is_resolved=false has no effect; reopen
    // goes through review.create with result="reopened" so the chain
    // permission check applies.
    if params.is_resolved.unwrap_or(false) && !was_resolved {
        active.resolved_at = Set(Some(now));
        active.resolved_by = Set(Some(user_id));
    }
    if params.is_deleted.unwrap_or(false) && !was_deleted {
        active.deleted_at = Set(Some(now));
    }

    let updated = active.update(&txn).await?;

    // 2. Diff-style mutations on related rows.
    if let Some(ids) = params.remove_involved_parties.as_ref()
        && !ids.is_empty()
    {
        involved_parties::Entity::delete_many()
            .filter(involved_parties::Column::IncidentId.eq(params.id))
            .filter(involved_parties::Column::Id.is_in(ids.iter().copied()))
            .exec(&txn)
            .await?;
    }
    if let Some(parties) = params.add_involved_parties.as_ref()
        && !parties.is_empty()
    {
        insert_involved_parties(&txn, params.id, user_id, parties).await?;
    }

    if let Some(ids) = params.remove_external_links.as_ref()
        && !ids.is_empty()
    {
        external_link::Entity::delete_many()
            .filter(external_link::Column::Incident.eq(params.id))
            .filter(external_link::Column::Id.is_in(ids.iter().copied()))
            .exec(&txn)
            .await?;
    }
    if let Some(links) = params.add_external_links.as_ref() {
        insert_external_links(&txn, params.id, user_id, links).await?;
    }

    // Attachments: same diff style. Remove unlinks the join rows pointing
    // at the given file_upload ids (scoped to this incident); add binds
    // already-uploaded files. We match on the file_upload column because
    // that's the id the client knows (incident/get returns file_upload ids
    // as the attachment id, not the join-row id).
    if let Some(ids) = params.remove_attachment_ids.as_ref()
        && !ids.is_empty()
    {
        attachments::Entity::delete_many()
            .filter(attachments::Column::IncidentId.eq(params.id))
            .filter(attachments::Column::FileUpload.is_in(ids.iter().copied()))
            .exec(&txn)
            .await?;
    }
    if let Some(ids) = params.add_attachment_file_upload_ids.as_ref() {
        insert_attachments(&txn, params.id, ids).await?;
    }

    // Template mapping: full replace when present. Clearing then
    // inserting (rather than computing a diff) keeps the contract
    // simple and matches the legacy port (CRT-88). Skipping the block
    // when `template_ids` is None preserves the existing mapping —
    // "no change" semantics, not "clear".
    if let Some(ids) = params.template_ids.as_ref() {
        incident_template_map::Entity::delete_many()
            .filter(incident_template_map::Column::Incident.eq(params.id))
            .exec(&txn)
            .await?;
        if !ids.is_empty() {
            insert_template_mappings(&txn, params.id, ids).await?;
        }
        tracing::info!(
            incident_id = params.id,
            count = ids.len(),
            "Replaced incident template mappings"
        );
    }

    // 3. Activity log. event_data is empty for now — the legacy left a
    //    TODO to ship a structured changes map; we carry that forward
    //    unchanged so downstream consumers (notifications, UI activity
    //    feed) don't see a wire change.
    let log_row = activity_log::ActiveModel {
        event_type: Set("incident.updated".to_string()),
        actor_id: Set(user_id),
        org_unit: Set(Some(org_unit)),
        incident_id: Set(Some(params.id)),
        event_data: Set(serde_json::json!({})),
        ..Default::default()
    };
    log_row.insert(&txn).await?;

    txn.commit().await?;

    Ok(Json(updated.into()))
}
