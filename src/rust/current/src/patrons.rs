//! Patron endpoints.

use axum::Json;
use axum::extract::State;
use odo_client::context::RequestContext;
use odo_client::error::{ApiResult, LocalError, LocalResult};
use sea_orm::prelude::*;
use sea_orm::{
    ConnectionTrait, DbBackend, DbErr, FromQueryResult, PaginatorTrait, QueryOrder, Set, SqlErr,
    Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::{
    incidents, involved_parties, patron_age_range, patron_ban, patron_photo, patrons,
};

// ===========================================================================
// Patron detail summary
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetPatronDetailSummaryRequest {
    pub patron_id: i32,
    /// Optional org_unit to scope statistics to that org unit and its
    /// descendants. When None, stats span the entire tree.
    #[serde(default)]
    pub org_unit: Option<Uuid>,
}

/// Wire shape mirrors the patrons table row plus a derived `age_range_label`.
/// We don't pin every field to a typed struct because the UI's
/// `transformToPatronDetails` reads a wide set of columns and treats the
/// `patron` field as opaque; passing the row through preserves forward-
/// compatibility with schema additions.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatronDetailRow {
    pub id: i32,
    pub library_card: Option<String>,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub preferred_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub photo_url: Option<String>,
    pub identification_type: Option<String>,
    pub identification_number: Option<String>,
    pub risk_level: Option<String>,
    pub notes: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_by: Option<Uuid>,
    pub created_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub updated_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub display_name: String,
    pub is_unknown: bool,
    pub age_range: i32,
    pub alias: Option<String>,

    /// Resolved label for `age_range` (from `incidents.patron_age_range`).
    pub age_range_label: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronStatistics {
    /// All active bans + trespasses combined.
    pub active_bans_count: i64,
    /// Only non-trespass active bans.
    pub active_ban_only_count: i64,
    /// Only active trespasses.
    pub active_trespass_count: i64,
    /// Visible (unarchived) bans — includes future-archived rows.
    pub visible_bans_count: i64,
    /// Distinct incidents this patron is involved in.
    pub total_incidents_count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronPhotoFileUpload {
    /// The file's stable odo-asset uuid.
    pub id: Uuid,
    pub file_name: String,
    pub file_type: Option<String>,
    pub file_size: Option<i32>,
    pub relative_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronPhotoEntry {
    pub id: i32,
    pub patron: i32,
    pub file_upload: Uuid,
    pub is_primary: bool,
    pub file_upload_data: Option<PatronPhotoFileUpload>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronDetailSummaryResponse {
    pub patron: PatronDetailRow,
    pub statistics: PatronStatistics,
    pub photos: Vec<PatronPhotoEntry>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/details",
    request_body = GetPatronDetailSummaryRequest,
    responses((
        status = 200,
        body = PatronDetailSummaryResponse,
        description = "Patron row + statistics + photos"
    )),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn get_patron_detail_summary(
    State(state): State<Arc<AppState>>,
    Json(params): Json<GetPatronDetailSummaryRequest>,
) -> ApiResult<Json<PatronDetailSummaryResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.patron.read", None)
        .await?;

    let patron_row = patrons::Entity::find_by_id(params.patron_id)
        .filter(patrons::Column::DeletedAt.is_null())
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("patron {}", params.patron_id)))?;

    // Org-scope expansion is the same input for every statistic, so do
    // it once. None means "span all branches".
    let org_scope: Option<Vec<Uuid>> = match params.org_unit {
        Some(id) => Some(state.org_client.descendant_uuids(&id).await?),
        None => None,
    };

    let active_bans_count =
        count_active_bans(&state.db, params.patron_id, org_scope.as_deref(), None).await?;
    let active_ban_only_count = count_active_bans(
        &state.db,
        params.patron_id,
        org_scope.as_deref(),
        Some(false),
    )
    .await?;
    let active_trespass_count = count_active_bans(
        &state.db,
        params.patron_id,
        org_scope.as_deref(),
        Some(true),
    )
    .await?;
    let visible_bans_count =
        count_visible_bans(&state.db, params.patron_id, org_scope.as_deref()).await?;
    let total_incidents_count =
        count_patron_incidents(&state.db, params.patron_id, org_scope.as_deref()).await?;

    let age_range_label = lookup_age_range_label(&state.db, patron_row.age_range).await?;
    let photos = load_patron_photos(&state, params.patron_id).await?;

    Ok(Json(PatronDetailSummaryResponse {
        patron: PatronDetailRow {
            age_range_label,
            id: patron_row.id,
            library_card: patron_row.library_card,
            first_name: patron_row.first_name,
            middle_name: patron_row.middle_name,
            last_name: patron_row.last_name,
            preferred_name: patron_row.preferred_name,
            phone: patron_row.phone,
            email: patron_row.email,
            address_line1: patron_row.address_line1,
            address_line2: patron_row.address_line2,
            city: patron_row.city,
            state_province: patron_row.state_province,
            postal_code: patron_row.postal_code,
            country: patron_row.country,
            photo_url: patron_row.photo_url,
            identification_type: patron_row.identification_type,
            identification_number: patron_row.identification_number,
            risk_level: patron_row.risk_level,
            notes: patron_row.notes,
            metadata: patron_row.metadata,
            created_by: patron_row.created_by,
            created_at: patron_row.created_at,
            updated_at: patron_row.updated_at,
            display_name: patron_row.display_name,
            is_unknown: patron_row.is_unknown,
            age_range: patron_row.age_range,
            alias: patron_row.alias,
        },
        statistics: PatronStatistics {
            active_bans_count,
            active_ban_only_count,
            active_trespass_count,
            visible_bans_count,
            total_incidents_count,
        },
        photos,
    }))
}

// ---------------------------------------------------------------------------
// Statistic helpers
// ---------------------------------------------------------------------------

/// Count rows in `incidents.active_patron_ban` (the view that drops
/// expired/archived rows) for the given patron, optionally scoped to an
/// org-unit set and optionally filtered by `is_trespass`.
async fn count_active_bans(
    db: &DatabaseConnection,
    patron_id: i32,
    org_scope: Option<&[Uuid]>,
    is_trespass: Option<bool>,
) -> LocalResult<i64> {
    use crate::entity::patron_ban;

    // The view `incidents.active_patron_ban` is defined as
    //   SELECT * FROM patron_ban
    //   WHERE archived_by IS NULL
    //     AND (archives_at IS NULL OR archives_at > NOW())
    //     AND lifts_at > NOW();
    // We replicate the filter on the underlying table to stay within
    // SeaORM's entity model rather than reaching for the view directly.
    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
    let mut q = patron_ban::Entity::find()
        .filter(patron_ban::Column::Patron.eq(patron_id))
        .filter(patron_ban::Column::ArchivedBy.is_null())
        .filter(patron_ban::Column::LiftsAt.gt(now))
        .filter(
            sea_orm::Condition::any()
                .add(patron_ban::Column::ArchivesAt.is_null())
                .add(patron_ban::Column::ArchivesAt.gt(now)),
        );

    if let Some(scope) = org_scope {
        if scope.is_empty() {
            return Ok(0);
        }
        q = q.filter(patron_ban::Column::OrgUnit.is_in(scope.iter().copied()));
    }

    if let Some(t) = is_trespass {
        q = q.filter(patron_ban::Column::IsTrespass.eq(t));
    }

    Ok(q.count(db).await? as i64)
}

/// Count rows in `incidents.visible_patron_ban` (drops archived rows but
/// keeps active and pre-archive bans).
async fn count_visible_bans(
    db: &DatabaseConnection,
    patron_id: i32,
    org_scope: Option<&[Uuid]>,
) -> LocalResult<i64> {
    use crate::entity::patron_ban;

    // visible_patron_ban view:
    //   archived_by IS NULL AND (archives_at IS NULL OR archives_at > NOW())
    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
    let mut q = patron_ban::Entity::find()
        .filter(patron_ban::Column::Patron.eq(patron_id))
        .filter(patron_ban::Column::ArchivedBy.is_null())
        .filter(
            sea_orm::Condition::any()
                .add(patron_ban::Column::ArchivesAt.is_null())
                .add(patron_ban::Column::ArchivesAt.gt(now)),
        );

    if let Some(scope) = org_scope {
        if scope.is_empty() {
            return Ok(0);
        }
        q = q.filter(patron_ban::Column::OrgUnit.is_in(scope.iter().copied()));
    }

    Ok(q.count(db).await? as i64)
}

/// Count distinct incidents that have this patron as an involved party.
/// Uses an EXISTS subquery rather than a join+DISTINCT to avoid row
/// multiplication.
async fn count_patron_incidents(
    db: &DatabaseConnection,
    patron_id: i32,
    org_scope: Option<&[Uuid]>,
) -> LocalResult<i64> {
    let mut q = incidents::Entity::find()
        .filter(incidents::Column::DeletedAt.is_null())
        .filter(
            incidents::Column::Id.in_subquery(
                sea_orm::sea_query::Query::select()
                    .column(involved_parties::Column::IncidentId)
                    // .table_ref() keeps the incidents.involved_parties
                    // schema qualifier; a bare Entity drops it.
                    .from(involved_parties::Entity.table_ref())
                    .and_where(involved_parties::Column::PatronId.eq(patron_id))
                    .to_owned(),
            ),
        );

    if let Some(scope) = org_scope {
        if scope.is_empty() {
            return Ok(0);
        }
        q = q.filter(incidents::Column::OrgUnit.is_in(scope.iter().copied()));
    }

    Ok(q.count(db).await? as i64)
}

async fn lookup_age_range_label(
    db: &DatabaseConnection,
    age_range_id: i32,
) -> LocalResult<Option<String>> {
    let row = patron_age_range::Entity::find_by_id(age_range_id)
        .one(db)
        .await?;
    Ok(row.map(|r| r.label))
}

/// Load the patron's photos, decorated with file metadata fetched via
/// odo-asset. Primary photos first, then by id (stable ordering).
///
/// File metadata is fetched in one batched HTTP call to odo-asset's
/// `/files/get` endpoint so we don't reach across schemas to read
/// `asset.file_upload` ourselves. Missing/soft-deleted files surface as
/// `file_upload_data: None` on the photo entry — same shape callers
/// already handle from the legacy path.
async fn load_patron_photos(
    state: &AppState,
    patron_id: i32,
) -> LocalResult<Vec<PatronPhotoEntry>> {
    use std::collections::HashMap;

    let photo_rows = patron_photo::Entity::find()
        .filter(patron_photo::Column::Patron.eq(patron_id))
        .order_by_desc(patron_photo::Column::IsPrimary)
        .order_by_asc(patron_photo::Column::Id)
        .all(&state.db)
        .await?;

    if photo_rows.is_empty() {
        return Ok(Vec::new());
    }

    let file_ids: Vec<Uuid> = photo_rows.iter().map(|p| p.file_upload).collect();
    let files: HashMap<Uuid, odo_client::client::FileUploadMetadata> = state
        .asset_client
        .get_files_by_uuid(&file_ids)
        .await?
        .into_iter()
        .map(|f| (f.uuid, f))
        .collect();

    Ok(photo_rows
        .into_iter()
        .map(|p| {
            let file_upload_data = files.get(&p.file_upload).map(|f| PatronPhotoFileUpload {
                id: f.uuid,
                file_name: f.file_name.clone(),
                file_type: f.file_type.clone(),
                file_size: f.file_size,
                relative_path: f.relative_path.clone(),
            });
            PatronPhotoEntry {
                id: p.id,
                patron: p.patron,
                file_upload: p.file_upload,
                is_primary: p.is_primary,
                file_upload_data,
            }
        })
        .collect())
}

// ===========================================================================
// create_patron
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreatePatronRequest {
    /// Patrons created on the fly may carry minimal info (e.g. just a
    /// first name during incident capture), so most fields are optional.
    pub first_name: String,
    pub last_name: String,
    #[serde(default)]
    pub is_unknown: Option<bool>,
    #[serde(default)]
    pub age_range: Option<i32>,
    #[serde(default)]
    pub alias: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/create",
    request_body = CreatePatronRequest,
    responses((status = 200, body = PatronDetailRow, description = "Newly-created patron row")),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn create_patron(
    State(state): State<Arc<AppState>>,
    Json(params): Json<CreatePatronRequest>,
) -> ApiResult<Json<PatronDetailRow>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    state
        .auth_client
        .permission_required_uuid("current.patron.write", None)
        .await?;

    let is_unknown = params.is_unknown.unwrap_or(false);

    tracing::info!(
        first_name = %params.first_name,
        last_name = %params.last_name,
        is_unknown,
        "CreatePatron"
    );

    let txn = state.db.begin().await?;

    let mut model = patrons::ActiveModel {
        first_name: Set(params.first_name.clone()),
        last_name: Set(params.last_name.clone()),
        created_by: Set(Some(user_id)),
        is_unknown: Set(is_unknown),
        ..Default::default()
    };
    if let Some(range) = params.age_range {
        model.age_range = Set(range);
    }
    if let Some(alias) = params.alias.as_ref() {
        model.alias = Set(Some(alias.clone()));
    }

    let inserted = model.insert(&txn).await?;

    // Legacy behavior: when is_unknown=true, rewrite first_name to the
    // canonical "Unknown Patron #<id>" form once the row's id is known.
    // Kept as a follow-up UPDATE rather than two INSERT styles so the
    // create path stays straight-line.
    let final_row = if is_unknown {
        let renamed = format!("Unknown Patron #{}", inserted.id);
        let mut update = patrons::ActiveModel::from(inserted.clone());
        update.first_name = Set(renamed);
        update.update(&txn).await?
    } else {
        inserted
    };

    txn.commit().await?;

    let row = build_patron_row(&state.db, final_row).await?;
    Ok(Json(row))
}

// ===========================================================================
// update_patron
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdatePatronRequest {
    pub patron_id: i32,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub middle_name: Option<String>,
    #[serde(default)]
    pub preferred_name: Option<String>,
    #[serde(default)]
    pub library_card: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub is_unknown: Option<bool>,
    #[serde(default)]
    pub age_range: Option<i32>,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(default)]
    pub address_line1: Option<String>,
    #[serde(default)]
    pub address_line2: Option<String>,
    #[serde(default)]
    pub city: Option<String>,
    #[serde(default)]
    pub state_province: Option<String>,
    #[serde(default)]
    pub postal_code: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

fn map_patron_write_err(e: DbErr) -> LocalError {
    if let Some(SqlErr::UniqueConstraintViolation(detail)) = e.sql_err()
        && detail.contains("patrons_library_card_key")
    {
        return LocalError::conflict(
            "LIBRARY_CARD_TAKEN",
            Some("library_card"),
            "This library card number is already in use by another patron.",
        );
    }
    LocalError::internal(e.to_string())
}

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/update",
    request_body = UpdatePatronRequest,
    responses((status = 200, body = PatronDetailRow, description = "Updated patron row")),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn update_patron(
    State(state): State<Arc<AppState>>,
    Json(params): Json<UpdatePatronRequest>,
) -> ApiResult<Json<PatronDetailRow>> {
    state
        .auth_client
        .permission_required_uuid("current.patron.write", None)
        .await?;

    let existing = patrons::Entity::find_by_id(params.patron_id)
        .filter(patrons::Column::DeletedAt.is_null())
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("patron {}", params.patron_id)))?;

    let mut active: patrons::ActiveModel = existing.into();

    // Legacy semantics: an empty string on `library_card` / `alias` /
    // address fields clears the column (writes NULL); on other text
    // fields an empty string is treated as a literal empty string. UI
    // sends only the fields the user actually edited, so omitting a
    // field leaves it untouched.
    if let Some(v) = params.first_name {
        active.first_name = Set(v);
    }
    if let Some(v) = params.last_name {
        active.last_name = Set(v);
    }
    if let Some(v) = params.middle_name {
        active.middle_name = Set(Some(v));
    }
    if let Some(v) = params.preferred_name {
        active.preferred_name = Set(Some(v));
    }
    if let Some(v) = params.library_card {
        active.library_card = Set(if v.is_empty() { None } else { Some(v) });
    }
    if let Some(v) = params.email {
        active.email = Set(Some(v));
    }
    if let Some(v) = params.phone {
        active.phone = Set(Some(v));
    }
    if let Some(v) = params.notes {
        active.notes = Set(Some(v));
    }
    if let Some(v) = params.is_unknown {
        active.is_unknown = Set(v);
    }
    if let Some(v) = params.age_range {
        active.age_range = Set(v);
    }
    if let Some(v) = params.alias {
        active.alias = Set(if v.is_empty() { None } else { Some(v) });
    }
    for (field, raw) in [
        ("address_line1", &params.address_line1),
        ("address_line2", &params.address_line2),
        ("city", &params.city),
        ("state_province", &params.state_province),
        ("postal_code", &params.postal_code),
        ("country", &params.country),
    ] {
        if let Some(v) = raw {
            let cleared = if v.is_empty() { None } else { Some(v.clone()) };
            match field {
                "address_line1" => active.address_line1 = Set(cleared),
                "address_line2" => active.address_line2 = Set(cleared),
                "city" => active.city = Set(cleared),
                "state_province" => active.state_province = Set(cleared),
                "postal_code" => active.postal_code = Set(cleared),
                "country" => active.country = Set(cleared),
                _ => unreachable!(),
            }
        }
    }
    if let Some(meta) = params.metadata {
        // Legacy serialized metadata as a JSON-encoded *string*. The
        // column is jsonb, so this round-trips to a JSON string value
        // (not an object). Preserved so existing readers see the same
        // shape; if/when this is fixed, both the writer and any UI
        // reader that parses the string back to an object must change
        // together.
        let as_string = serde_json::to_string(&meta)
            .map_err(|e| LocalError::invalid_input(format!("metadata: {e}")))?;
        active.metadata = Set(Some(serde_json::Value::String(as_string)));
    }

    tracing::info!(patron_id = params.patron_id, "UpdatePatron");

    let updated = active
        .update(&state.db)
        .await
        .map_err(map_patron_write_err)?;
    let row = build_patron_row(&state.db, updated).await?;
    Ok(Json(row))
}

// ===========================================================================
// delete_patron (soft delete + lift active bans)
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeletePatronRequest {
    pub patron_id: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeletePatronResponse {
    pub success: bool,
    pub patron_id: i32,
    /// Count of active bans that were lifted as part of the deletion.
    pub bans_lifted: i64,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/delete",
    request_body = DeletePatronRequest,
    responses((
        status = 200,
        body = DeletePatronResponse,
        description = "Patron soft-deleted; active bans lifted"
    )),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn delete_patron(
    State(state): State<Arc<AppState>>,
    Json(params): Json<DeletePatronRequest>,
) -> ApiResult<Json<DeletePatronResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    state
        .auth_client
        .permission_required_uuid("current.patron.write", None)
        .await?;

    let patron = patrons::Entity::find_by_id(params.patron_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("patron {}", params.patron_id)))?;

    if patron.deleted_at.is_some() {
        return Err(LocalError::invalid_input(format!(
            "Patron {} is already deleted",
            params.patron_id
        ))
        .into());
    }

    // Active bans: not archived, not yet lifted. We lift each one as part
    // of the soft-delete so the patron's bans don't outlive their record.
    //
    // NOTE on permission scope: legacy lift_ban_record re-checked
    // `incident.ban.write` at each ban's org_unit before mutating. We
    // skip that re-check here — the caller has already cleared
    // `incident.patron.write` (org-unit-less, granted to roles that also
    // hold `incident.ban.write` at the same scopes), and per-ban checks
    // would force a round-trip to odo-auth per ban. If we ever decouple
    // these two perms, restore the per-ban check.
    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();

    let txn = state.db.begin().await?;

    let active_bans = patron_ban::Entity::find()
        .filter(patron_ban::Column::Patron.eq(params.patron_id))
        .filter(patron_ban::Column::ArchivedBy.is_null())
        .filter(patron_ban::Column::LiftsAt.gt(now))
        .all(&txn)
        .await?;

    let bans_lifted = active_bans.len() as i64;
    let lift_note = "Lifted via patron deletion";

    for ban in active_bans {
        let prev_comments = ban.comments.clone().unwrap_or_default();
        let merged = format!("{lift_note}\n{prev_comments}").trim().to_string();
        let mut active: patron_ban::ActiveModel = ban.into();
        active.lifts_at = Set(now);
        active.updated_by = Set(user_id);
        active.comments = Set(Some(merged));
        active.update(&txn).await?;
    }

    let mut patron_active: patrons::ActiveModel = patron.into();
    patron_active.deleted_at = Set(Some(now));
    patron_active.update(&txn).await?;

    txn.commit().await?;

    tracing::info!(
        patron_id = params.patron_id,
        bans_lifted,
        deleted_by = %user_id,
        "Patron soft-deleted"
    );

    Ok(Json(DeletePatronResponse {
        success: true,
        patron_id: params.patron_id,
        bans_lifted,
    }))
}

// ---------------------------------------------------------------------------
// Helpers shared by create/update
// ---------------------------------------------------------------------------

async fn build_patron_row(
    db: &DatabaseConnection,
    model: patrons::Model,
) -> LocalResult<PatronDetailRow> {
    let age_range_label = lookup_age_range_label(db, model.age_range).await?;
    Ok(PatronDetailRow {
        id: model.id,
        library_card: model.library_card,
        first_name: model.first_name,
        middle_name: model.middle_name,
        last_name: model.last_name,
        preferred_name: model.preferred_name,
        phone: model.phone,
        email: model.email,
        address_line1: model.address_line1,
        address_line2: model.address_line2,
        city: model.city,
        state_province: model.state_province,
        postal_code: model.postal_code,
        country: model.country,
        photo_url: model.photo_url,
        identification_type: model.identification_type,
        identification_number: model.identification_number,
        risk_level: model.risk_level,
        notes: model.notes,
        metadata: model.metadata,
        created_by: model.created_by,
        created_at: model.created_at,
        updated_at: model.updated_at,
        display_name: model.display_name,
        is_unknown: model.is_unknown,
        age_range: model.age_range,
        alias: model.alias,
        age_range_label,
    })
}

// ===========================================================================
// patron.photo.create
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreatePatronPhotoRequest {
    pub patron_id: i32,
    /// id of the row in `asset.file_upload` that the UI already
    /// uploaded via odo-asset's `/upload` endpoint. We trust the id
    /// exists; bad ids fail the FK constraint with a 4xx.
    pub file_upload_id: Uuid,
    #[serde(default)]
    pub is_primary: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronPhotoResponse {
    pub id: i32,
    pub patron: i32,
    pub file_upload: Uuid,
    pub is_primary: bool,
}

impl From<patron_photo::Model> for PatronPhotoResponse {
    fn from(m: patron_photo::Model) -> Self {
        Self {
            id: m.id,
            patron: m.patron,
            file_upload: m.file_upload,
            is_primary: m.is_primary,
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/photo/create",
    request_body = CreatePatronPhotoRequest,
    responses((status = 200, body = PatronPhotoResponse, description = "Newly-created patron_photo row")),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn create_patron_photo(
    State(state): State<Arc<AppState>>,
    Json(params): Json<CreatePatronPhotoRequest>,
) -> ApiResult<Json<PatronPhotoResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.patron.write", None)
        .await?;

    // If this new photo is marked primary, demote any existing primary
    // for the same patron first. The DB enforces "one primary per
    // patron" via a partial unique index, so without the demote the
    // insert would 23505 — we'd rather translate the intent than relay
    // a constraint error.
    let txn = state.db.begin().await?;

    if params.is_primary {
        unprimary_existing(&txn, params.patron_id).await?;
    }

    let new_photo = patron_photo::ActiveModel {
        patron: Set(params.patron_id),
        file_upload: Set(params.file_upload_id),
        is_primary: Set(params.is_primary),
        ..Default::default()
    };
    let inserted = new_photo.insert(&txn).await?;

    txn.commit().await?;

    tracing::info!(
        patron_id = params.patron_id,
        file_upload_id = %params.file_upload_id,
        is_primary = params.is_primary,
        photo_id = inserted.id,
        "CreatePatronPhoto"
    );

    Ok(Json(inserted.into()))
}

// ===========================================================================
// patron.photo.set_primary
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetPrimaryPatronPhotoRequest {
    pub patron_id: i32,
    pub photo_id: i32,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/photo/set-primary",
    request_body = SetPrimaryPatronPhotoRequest,
    responses((status = 200, body = PatronPhotoResponse, description = "The newly-primary photo")),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn set_primary_patron_photo(
    State(state): State<Arc<AppState>>,
    Json(params): Json<SetPrimaryPatronPhotoRequest>,
) -> ApiResult<Json<PatronPhotoResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.patron.write", None)
        .await?;

    let photo = patron_photo::Entity::find_by_id(params.photo_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("patron_photo {}", params.photo_id)))?;

    // Ownership check: the photo must belong to the patron the caller
    // claimed. Returning 404 (not 403) so we don't leak "this photo
    // exists, just not for you" — matches legacy semantics.
    if photo.patron != params.patron_id {
        return Err(LocalError::not_found(format!("patron_photo {}", params.photo_id)).into());
    }

    // No-op if already primary.
    if photo.is_primary {
        return Ok(Json(photo.into()));
    }

    let txn = state.db.begin().await?;
    unprimary_existing(&txn, params.patron_id).await?;
    let mut active: patron_photo::ActiveModel = photo.into();
    active.is_primary = Set(true);
    let updated = active.update(&txn).await?;
    txn.commit().await?;

    tracing::info!(
        patron_id = params.patron_id,
        photo_id = params.photo_id,
        "SetPrimaryPatronPhoto"
    );

    Ok(Json(updated.into()))
}

// ===========================================================================
// patron.photo.delete
// ===========================================================================

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeletePatronPhotoRequest {
    pub photo_id: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeletePatronPhotoResponse {
    pub success: bool,
    pub photo_id: i32,
    /// id of the underlying `asset.file_upload` row that was
    /// soft-deleted via odo-asset. Returned so the UI can correlate.
    pub file_upload_id: Uuid,
    /// True when the on-disk file was actually unlinked. The DB row
    /// for the upload is marked deleted either way.
    pub file_removed: bool,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/photo/delete",
    request_body = DeletePatronPhotoRequest,
    responses((
        status = 200,
        body = DeletePatronPhotoResponse,
        description = "Deletes the patron_photo row and the underlying file_upload via odo-asset"
    )),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn delete_patron_photo(
    State(state): State<Arc<AppState>>,
    Json(params): Json<DeletePatronPhotoRequest>,
) -> ApiResult<Json<DeletePatronPhotoResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.patron.write", None)
        .await?;

    let photo = patron_photo::Entity::find_by_id(params.photo_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("patron_photo {}", params.photo_id)))?;
    let file_upload_id = photo.file_upload;

    // Drop the join row first, then ask odo-asset to remove the file.
    // If odo-asset's delete fails, the patron_photo row is already
    // gone — that's still the right thing (the UI no longer references
    // it), and odo-asset's row is left for a later cleanup pass.
    patron_photo::Entity::delete_by_id(params.photo_id)
        .exec(&state.db)
        .await?;

    let file_removed = state
        .asset_client
        .delete_file_by_uuid(&file_upload_id)
        .await?;

    tracing::info!(
        photo_id = params.photo_id,
        %file_upload_id,
        file_removed,
        "DeletePatronPhoto"
    );

    Ok(Json(DeletePatronPhotoResponse {
        success: true,
        photo_id: params.photo_id,
        file_upload_id,
        file_removed,
    }))
}

// ---------------------------------------------------------------------------
// Photo helpers
// ---------------------------------------------------------------------------

/// Demote any existing primary photo for the given patron. No-op when
/// no primary exists. Caller is responsible for running this inside a
/// transaction with whatever insert/update will follow.
async fn unprimary_existing<C: sea_orm::ConnectionTrait>(
    txn: &C,
    patron_id: i32,
) -> LocalResult<()> {
    let existing = patron_photo::Entity::find()
        .filter(patron_photo::Column::Patron.eq(patron_id))
        .filter(patron_photo::Column::IsPrimary.eq(true))
        .one(txn)
        .await?;
    if let Some(row) = existing {
        let mut active: patron_photo::ActiveModel = row.into();
        active.is_primary = Set(false);
        active.update(txn).await?;
    }
    Ok(())
}

// ===========================================================================
// patron.search
// ===========================================================================
//
// Two-query split:
//
//   1. Base query against `incidents.patrons` for name / is_unknown
//      filters + the optional "has activity in scope" gate. Drives
//      pagination and the default name sort. Patrons with zero
//      activity show up here with all-zero aggregates by default,
//      which the decoration step preserves.
//
//   2. Decoration query against the `incidents.patron_search_summary`
//      view for just the page's patron ids. Aggregates per (patron,
//      org_unit) collapse to per-patron in Rust so the view stays
//      simple. See `incidents.patron_search_summary` in
//      `src/sqitch/current/deploy/001_incidents_baseline.sql` for the
//      view body.
//
// Sort-by-aggregate modes (sort_lift_date, sort_incident_date) drive
// off the view directly because they require activity to be
// meaningful; that path lives in a separate helper.

const SEARCH_DEFAULT_LIMIT: u64 = 25;
const SEARCH_MAX_LIMIT: u64 = 10_000;

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatronSearchRequest {
    /// Free-text search across first/last/alias/library_card/email.
    /// Whitespace-split into terms; per-term hits are OR'd across
    /// the fields, and terms are AND'd together.
    #[serde(default)]
    pub query: Option<String>,
    /// Org unit to scope incident / ban joins to. Expanded to
    /// descendants via `OrgServiceClient`. Omit to search across all
    /// orgs.
    #[serde(default)]
    pub org_unit: Option<Uuid>,
    /// Only return patrons with at least one active non-trespass ban
    /// (in scope, when `org_unit` is set; anywhere otherwise).
    #[serde(default)]
    pub has_active_bans: Option<bool>,
    /// Only return patrons with at least one visible trespass.
    /// Trespasses are cross-location, so this gate ignores `org_unit`.
    #[serde(default)]
    pub has_visible_trespass: Option<bool>,
    /// Exact-match on the patron's is_unknown flag. Omit for both.
    #[serde(default)]
    pub is_unknown: Option<bool>,
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub offset: Option<u64>,
    /// Sort by aggregated incident date (MIN/MAX(occurred_at)).
    /// Mutually exclusive with `sort_lift_date`; lift_date wins.
    #[serde(default)]
    pub sort_incident_date: Option<bool>,
    /// Sort by ban / trespass lift date. Ascending picks the soonest
    /// to expire; descending picks the furthest out.
    #[serde(default)]
    pub sort_lift_date: Option<bool>,
    /// "asc" (default) or "desc". Drives the MIN/MAX choice on the
    /// sort aggregate and the ORDER BY direction.
    #[serde(default)]
    pub sort_dir: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronSearchRow {
    pub id: i32,
    pub library_card: Option<String>,
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub display_name: String,
    pub email: Option<String>,
    pub alias: Option<String>,
    pub risk_level: Option<String>,
    pub notes: Option<String>,
    pub is_unknown: bool,

    /// SUM of per-(patron, org) incident counts (scoped to descendants
    /// when `org_unit` is set; over all orgs otherwise).
    pub incident_count: i64,
    /// Same shape for active non-trespass bans.
    pub active_ban_count: i64,
    /// Cross-location trespass count. Not org-scoped.
    pub active_trespass_count: i64,

    /// Primary photo's `relative_path` — null when the patron has no
    /// primary photo. Sourced from the view's join through
    /// `asset.file_upload`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_photo_path: Option<String>,

    /// MAX(occurred_at) over scoped incidents in default sort mode.
    /// Swapped for the sort-aware aggregate when `sort_incident_date`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_incident_date: Option<chrono::DateTime<chrono::FixedOffset>>,
    /// Sort-aware MIN/MAX of scoped incident dates when
    /// `sort_incident_date = true`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_incident_date: Option<chrono::DateTime<chrono::FixedOffset>>,

    /// Org of the "representative" incident for display. Picked as the
    /// (patron, org_unit) row with the latest incident date — same
    /// approximation the legacy made.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incident_org_unit_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incident_org_unit_label: Option<String>,

    /// Sort-aware MIN/MAX of visible non-trespass ban `lifts_at`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ban_max_lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    /// Sort-aware MIN/MAX of visible trespass `lifts_at`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trespass_max_lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,

    /// Comma-separated distinct org labels for active-ban orgs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ban_location_names: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronSearchResponse {
    pub patrons: Vec<PatronSearchRow>,
    pub total_count: i64,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/search",
    request_body = PatronSearchRequest,
    responses((
        status = 200,
        body = PatronSearchResponse,
        description = "Filtered + paginated patron rows with per-patron aggregates"
    )),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn patron_search(
    State(state): State<Arc<AppState>>,
    Json(params): Json<PatronSearchRequest>,
) -> ApiResult<Json<PatronSearchResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.patron.read", params.org_unit.as_ref())
        .await?;

    let limit = params
        .limit
        .unwrap_or(SEARCH_DEFAULT_LIMIT)
        .min(SEARCH_MAX_LIMIT);
    let offset = params.offset.unwrap_or(0);

    // Resolve org descendants once and pass the id list through every
    // downstream query. Skips the `org.unit_descendants(...)` PG
    // function call entirely.
    let org_scope = match params.org_unit {
        Some(id) => Some(state.org_client.descendant_uuids(&id).await?),
        None => None,
    };

    let inputs = SearchInputs::from_request(&params);
    let sort = SortMode::from_request(&params);

    // Sort-by-aggregate modes require activity to be meaningful, so
    // they drive off the view (which only has rows for patrons WITH
    // activity). The default name sort drives off the base patron
    // table so patrons with zero activity still appear.
    let (page_ids, total_count) = if sort.requires_activity() {
        find_page_by_aggregate(
            &state.db,
            &inputs,
            org_scope.as_deref(),
            &sort,
            limit,
            offset,
        )
        .await?
    } else {
        find_page_by_name(&state.db, &inputs, org_scope.as_deref(), limit, offset).await?
    };

    if page_ids.is_empty() {
        return Ok(Json(PatronSearchResponse {
            patrons: Vec::new(),
            total_count,
        }));
    }

    let decorations = load_summary_rows(&state.db, &page_ids, org_scope.as_deref()).await?;

    let patrons = assemble_response_rows(
        &state.db,
        &state.org_client,
        &state.asset_client,
        &page_ids,
        decorations,
        &sort,
    )
    .await?;

    Ok(Json(PatronSearchResponse {
        patrons,
        total_count,
    }))
}

// ---------------------------------------------------------------------------
// Filter / sort plumbing
// ---------------------------------------------------------------------------

/// Pre-resolved filter inputs. Pulling these into one struct keeps the
/// SQL builders pure-functional.
struct SearchInputs {
    /// Whitespace-tokenized free-text terms (already de-quoted). Empty
    /// when the caller didn't pass `query` or it was blank.
    terms: Vec<String>,
    is_unknown: Option<bool>,
    has_active_bans: bool,
    has_visible_trespass: bool,
}

impl SearchInputs {
    fn from_request(p: &PatronSearchRequest) -> Self {
        let terms = p
            .query
            .as_deref()
            .unwrap_or("")
            .replace('"', "")
            .split_whitespace()
            .map(str::to_string)
            .collect();
        Self {
            terms,
            is_unknown: p.is_unknown,
            has_active_bans: p.has_active_bans.unwrap_or(false),
            has_visible_trespass: p.has_visible_trespass.unwrap_or(false),
        }
    }
}

/// Resolved sort mode + direction. `lift_date` wins when both
/// sort-mode flags are set, matching legacy's branch order.
struct SortMode {
    by: SortKey,
    descending: bool,
}

#[derive(PartialEq, Eq)]
enum SortKey {
    Name,
    IncidentDate,
    LiftDate,
}

impl SortMode {
    fn from_request(p: &PatronSearchRequest) -> Self {
        let descending = p
            .sort_dir
            .as_deref()
            .map(|s| s.eq_ignore_ascii_case("desc"))
            .unwrap_or(false);
        let by = if p.sort_lift_date.unwrap_or(false) {
            SortKey::LiftDate
        } else if p.sort_incident_date.unwrap_or(false) {
            SortKey::IncidentDate
        } else {
            SortKey::Name
        };
        Self { by, descending }
    }

    fn requires_activity(&self) -> bool {
        self.by != SortKey::Name
    }
}

/// SQL builder that tracks `$N` placeholder positions. Returned by
/// every clause builder so we can compose them without dropping a
/// value.
struct ParamBuf {
    values: Vec<sea_orm::Value>,
}

impl ParamBuf {
    fn new() -> Self {
        Self { values: Vec::new() }
    }

    /// Append a bind value and return the `$N` placeholder for it.
    fn push<V: Into<sea_orm::Value>>(&mut self, v: V) -> String {
        self.values.push(v.into());
        format!("${}", self.values.len())
    }
}

// ---------------------------------------------------------------------------
// Page-finding queries (return ids only)
// ---------------------------------------------------------------------------

#[derive(Debug, FromQueryResult)]
struct PatronIdRow {
    id: i32,
}

#[derive(Debug, FromQueryResult)]
struct CountRow {
    total: i64,
}

/// Build the WHERE clause shared by the count and name-sort page
/// queries against `incidents.patrons`. Always includes
/// `ip.deleted_at IS NULL`. Returns the SQL fragment (no leading
/// `WHERE`) and any added params.
///
/// `org_scope` controls the activity-existence gate: when None (no
/// `org_unit` filter), the gate considers any incident or ban
/// anywhere; when Some(ids), only those in the org scope count.
fn build_patrons_where(
    inputs: &SearchInputs,
    org_scope: Option<&[Uuid]>,
    p: &mut ParamBuf,
) -> String {
    let mut clauses = vec!["ip.deleted_at IS NULL".to_string()];

    for term in &inputs.terms {
        let pattern = format!("%{term}%");
        let ph = p.push(pattern);
        clauses.push(format!(
            "(ip.first_name ILIKE {ph} OR ip.last_name ILIKE {ph} \
             OR ip.alias ILIKE {ph} OR ip.library_card ILIKE {ph} \
             OR ip.email ILIKE {ph})"
        ));
    }

    if let Some(unknown) = inputs.is_unknown {
        let ph = p.push(unknown);
        clauses.push(format!("ip.is_unknown = {ph}"));
    }

    // Existence gates for "has active ban" / "has visible trespass".
    // We hit the patron_search_summary view here so we get the same
    // visibility predicate the decoration step uses — no risk of the
    // gate disagreeing with the displayed counts.
    if inputs.has_active_bans {
        let mut gate = "(SELECT COALESCE(SUM(s.active_ban_count), 0) \
                          FROM incidents.patron_search_summary s \
                         WHERE s.patron_id = ip.id"
            .to_string();
        if let Some(ids) = org_scope {
            let ph = push_int_array(p, ids);
            gate.push_str(&format!(" AND s.org_unit = ANY({ph})"));
        }
        gate.push_str(") > 0");
        clauses.push(gate);
    }
    if inputs.has_visible_trespass {
        // Trespasses are cross-location. The view replicates the
        // trespass count per org row for a given patron, so picking
        // any one row gives the right answer; use MAX to collapse
        // without org-scoping.
        let gate = "(SELECT COALESCE(MAX(s.active_trespass_count), 0) \
                      FROM incidents.patron_search_summary s \
                     WHERE s.patron_id = ip.id) > 0"
            .to_string();
        clauses.push(gate);
    }

    clauses.join(" AND ")
}

/// Push an `i32` array literal as a single bind value, returning the
/// `$N` placeholder. Used for `WHERE col = ANY($n)` filters.
fn push_int_array<T: Clone>(p: &mut ParamBuf, ids: &[T]) -> String
where
    sea_orm::Value: From<Vec<T>>,
{
    // sea_orm::Value::from(Vec<T>) maps to the matching Postgres array type
    // (int4[] for i32, uuid[] for Uuid).
    p.push(ids.to_vec())
}

/// Default-sort path: a single SELECT from `incidents.patrons` with
/// the name / is_unknown / activity-gate filters, ORDER BY name,
/// LIMIT + OFFSET. Also runs the matching `COUNT(*)` query.
async fn find_page_by_name<C: ConnectionTrait>(
    db: &C,
    inputs: &SearchInputs,
    org_scope: Option<&[Uuid]>,
    limit: u64,
    offset: u64,
) -> LocalResult<(Vec<i32>, i64)> {
    // Count first — same WHERE, different SELECT.
    let mut p = ParamBuf::new();
    let where_sql = build_patrons_where(inputs, org_scope, &mut p);
    let count_sql = format!("SELECT COUNT(*) AS total FROM incidents.patrons ip WHERE {where_sql}");
    let total = CountRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        count_sql,
        p.values,
    ))
    .one(db)
    .await?
    .map(|r| r.total)
    .unwrap_or(0);

    // Page query — fresh ParamBuf so the placeholder numbering is
    // independent of the count query above.
    let mut p = ParamBuf::new();
    let where_sql = build_patrons_where(inputs, org_scope, &mut p);
    let limit_ph = p.push(limit as i64);
    let offset_ph = p.push(offset as i64);
    let page_sql = format!(
        "SELECT ip.id
           FROM incidents.patrons ip
          WHERE {where_sql}
          ORDER BY ip.last_name ASC, ip.first_name ASC, ip.id ASC
          LIMIT {limit_ph} OFFSET {offset_ph}"
    );
    let rows = PatronIdRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        page_sql,
        p.values,
    ))
    .all(db)
    .await?;

    Ok((rows.into_iter().map(|r| r.id).collect(), total))
}

/// Sort-by-aggregate path: drive off the view directly. The view only
/// has rows for patrons WITH activity, which matches the legacy
/// behavior of these sort modes (sorting by lift date when no patron
/// has a ban is nonsensical).
///
/// We GROUP BY patron_id and order by the per-patron aggregate, which
/// gives us deterministic pagination even when a patron has multiple
/// (patron, org) rows in the view.
async fn find_page_by_aggregate<C: ConnectionTrait>(
    db: &C,
    inputs: &SearchInputs,
    org_scope: Option<&[Uuid]>,
    sort: &SortMode,
    limit: u64,
    offset: u64,
) -> LocalResult<(Vec<i32>, i64)> {
    // Count distinct patrons that match.
    let mut p = ParamBuf::new();
    let where_sql = build_view_where_for_aggregate_sort(inputs, org_scope, sort, &mut p);
    let count_sql = format!(
        "SELECT COUNT(DISTINCT s.patron_id) AS total \
           FROM incidents.patron_search_summary s \
          WHERE {where_sql}"
    );
    let total = CountRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        count_sql,
        p.values,
    ))
    .one(db)
    .await?
    .map(|r| r.total)
    .unwrap_or(0);

    // Page query: GROUP BY patron + ORDER BY the chosen aggregate.
    let mut p = ParamBuf::new();
    let where_sql = build_view_where_for_aggregate_sort(inputs, org_scope, sort, &mut p);
    let (sort_expr, dir) = match (&sort.by, sort.descending) {
        (SortKey::IncidentDate, false) => ("MIN(s.first_incident_at)", "ASC"),
        (SortKey::IncidentDate, true) => ("MAX(s.last_incident_at)", "DESC"),
        (SortKey::LiftDate, false) => {
            // Ascending lift-date sort: soonest expiry first. Take the
            // minimum across ban + trespass since either kind qualifies
            // a patron for the gate.
            (
                "LEAST(MIN(s.ban_min_lifts_at), MIN(s.trespass_min_lifts_at))",
                "ASC",
            )
        }
        (SortKey::LiftDate, true) => (
            "GREATEST(MAX(s.ban_max_lifts_at), MAX(s.trespass_max_lifts_at))",
            "DESC",
        ),
        // SortKey::Name shouldn't reach here — that path is in
        // find_page_by_name. Treat it as a defensive fallback.
        (SortKey::Name, _) => ("MIN(s.last_name)", "ASC"),
    };
    // Always NULLS LAST. Postgres' default with ASC already puts
    // NULLs at the tail, but DESC defaults NULLs FIRST — overriding
    // makes the behavior identical across both directions, so patrons
    // missing the sort key never dominate page 1.
    let nulls_clause = "NULLS LAST";
    let limit_ph = p.push(limit as i64);
    let offset_ph = p.push(offset as i64);
    let page_sql = format!(
        "SELECT s.patron_id AS id
           FROM incidents.patron_search_summary s
          WHERE {where_sql}
          GROUP BY s.patron_id
          ORDER BY {sort_expr} {dir} {nulls_clause}, s.patron_id ASC
          LIMIT {limit_ph} OFFSET {offset_ph}"
    );
    let rows = PatronIdRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        page_sql,
        p.values,
    ))
    .all(db)
    .await?;

    Ok((rows.into_iter().map(|r| r.id).collect(), total))
}

/// WHERE clause for the view-driven aggregate-sort path. Includes
/// patron name + is_unknown filters joined through patron_id, plus the
/// activity gate (the view's existence implies activity).
fn build_view_where_for_aggregate_sort(
    inputs: &SearchInputs,
    org_scope: Option<&[Uuid]>,
    sort: &SortMode,
    p: &mut ParamBuf,
) -> String {
    let mut clauses = vec!["s.patron_deleted_at IS NULL".to_string()];

    // Org scope only matters for the rows we consider when picking
    // the per-patron aggregate. For lift-date sort with
    // has_visible_trespass = true, trespass rows are cross-location,
    // so the org_scope filter would hide them — only apply org_scope
    // when sorting purely on org-scoped activity.
    if let Some(ids) = org_scope {
        // Apply org scope unless the only thing the caller cares
        // about is the trespass aggregate (in which case scoping
        // would lose cross-location rows). Trespass-only is the case
        // where has_visible_trespass is true AND has_active_bans is
        // false AND we're sorting by lift date.
        let trespass_only_lift_sort =
            inputs.has_visible_trespass && !inputs.has_active_bans && sort.by == SortKey::LiftDate;
        if !trespass_only_lift_sort {
            let ph = push_int_array(p, ids);
            clauses.push(format!("s.org_unit = ANY({ph})"));
        }
    }

    for term in &inputs.terms {
        let pattern = format!("%{term}%");
        let ph = p.push(pattern);
        clauses.push(format!(
            "(s.first_name ILIKE {ph} OR s.last_name ILIKE {ph} \
             OR s.alias ILIKE {ph} OR s.library_card ILIKE {ph} \
             OR s.email ILIKE {ph})"
        ));
    }

    if let Some(unknown) = inputs.is_unknown {
        let ph = p.push(unknown);
        clauses.push(format!("s.is_unknown = {ph}"));
    }

    if inputs.has_active_bans {
        clauses.push("s.active_ban_count > 0".into());
    }
    if inputs.has_visible_trespass {
        clauses.push("s.active_trespass_count > 0".into());
    }

    clauses.join(" AND ")
}

// ---------------------------------------------------------------------------
// Decoration: per-(patron, org) rows from the view
// ---------------------------------------------------------------------------

/// Decoration-side row shape. Field names match the
/// `patron_search_summary` view's column names so `FromQueryResult`
/// can map without aliases.
#[derive(Debug, FromQueryResult, Clone)]
struct PatronSummaryRow {
    patron_id: i32,
    org_unit: Uuid,
    library_card: Option<String>,
    first_name: Option<String>,
    middle_name: Option<String>,
    last_name: Option<String>,
    display_name: Option<String>,
    email: Option<String>,
    alias: Option<String>,
    risk_level: Option<String>,
    notes: Option<String>,
    is_unknown: Option<bool>,
    incident_count: Option<i64>,
    last_incident_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    first_incident_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    active_ban_count: Option<i64>,
    ban_min_lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    ban_max_lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    active_trespass_count: Option<i64>,
    trespass_min_lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    trespass_max_lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    /// Local file_upload id of the primary photo; the path is resolved app-side
    /// via odo-asset (the view no longer joins asset.file_upload — migration
    /// 102_decouple_asset).
    primary_photo_file_upload: Option<Uuid>,
}

async fn load_summary_rows<C: ConnectionTrait>(
    db: &C,
    patron_ids: &[i32],
    org_scope: Option<&[Uuid]>,
) -> LocalResult<Vec<PatronSummaryRow>> {
    let mut p = ParamBuf::new();
    let patron_ph = push_int_array(&mut p, patron_ids);
    let mut where_clauses = vec![format!("s.patron_id = ANY({patron_ph})")];
    if let Some(ids) = org_scope {
        let scope_ph = push_int_array(&mut p, ids);
        // Always allow rows whose org_unit is in scope. We
        // intentionally don't include unscoped trespass rows here —
        // the per-patron aggregator pulls trespass totals from the
        // first matching row, and trespasses are duplicated across
        // every (patron, org) row for that patron, so the in-scope
        // row already carries them.
        where_clauses.push(format!("s.org_unit = ANY({scope_ph})"));
    }
    let where_sql = where_clauses.join(" AND ");

    let sql = format!(
        "SELECT patron_id, org_unit, library_card, first_name, middle_name, \
                last_name, display_name, email, alias, risk_level, notes, \
                is_unknown, incident_count, last_incident_at, first_incident_at, \
                active_ban_count, ban_min_lifts_at, ban_max_lifts_at, \
                active_trespass_count, \
                trespass_min_lifts_at, trespass_max_lifts_at, primary_photo_file_upload \
           FROM incidents.patron_search_summary s \
          WHERE {where_sql}"
    );
    let rows = PatronSummaryRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        p.values,
    ))
    .all(db)
    .await?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Response assembly
// ---------------------------------------------------------------------------

/// Stitch the page ids with the view's per-(patron, org) rows into
/// per-patron response rows. Patrons with zero activity (no rows in
/// the view) get a base-table fallback fetch so they still appear in
/// the response with zeroed aggregates.
async fn assemble_response_rows<C: ConnectionTrait>(
    db: &C,
    org_client: &odo_client::client::OrgServiceClient,
    asset_client: &odo_client::client::AssetServiceClient,
    page_ids: &[i32],
    decorations: Vec<PatronSummaryRow>,
    sort: &SortMode,
) -> LocalResult<Vec<PatronSearchRow>> {
    use std::collections::{HashMap, HashSet};

    let mut by_patron: HashMap<i32, Vec<PatronSummaryRow>> = HashMap::new();
    for row in decorations {
        by_patron.entry(row.patron_id).or_default().push(row);
    }

    // Patrons in the page but with no rows in the view (no activity
    // in scope) need their base columns from `incidents.patrons`.
    let missing: Vec<i32> = page_ids
        .iter()
        .copied()
        .filter(|id| !by_patron.contains_key(id))
        .collect();
    let base_patrons: HashMap<i32, patrons::Model> = if missing.is_empty() {
        HashMap::new()
    } else {
        patrons::Entity::find()
            .filter(patrons::Column::Id.is_in(missing))
            .all(db)
            .await?
            .into_iter()
            .map(|m| (m.id, m))
            .collect()
    };

    // Collect every org_unit id we'll need a display label for —
    // both the representative (incident) org and every org with an
    // active ban for the patron. One batched request covers all of
    // them; the response is a (id -> label) lookup the collapse step
    // consults instead of the dropped `ban_location_name` view
    // column.
    let mut label_ids: HashSet<Uuid> = HashSet::new();
    for rows in by_patron.values() {
        for r in rows {
            label_ids.insert(r.org_unit);
        }
    }
    let label_ids: Vec<Uuid> = label_ids.into_iter().collect();
    let labels = match org_client.fetch_labels_by_uuid(&label_ids).await {
        Ok(map) => map,
        Err(e) => {
            // Don't fail the whole search because the label fetch
            // misbehaved — fall back to id-only display, matching the
            // tolerance pattern used by `get_patron_detail_summary`
            // when org_client.get_unit_detail fails.
            tracing::warn!(error = %e, "org label batch fetch failed; emitting rows without labels");
            HashMap::new()
        }
    };

    // Resolve primary-photo paths app-side (the view now yields the local
    // file_upload id — migration 102). odo-asset turns ids into paths, the same
    // shape as the org label lookup; missing/soft-deleted files degrade to no
    // photo. get_files defaults to active-only, so deleted photos aren't shown.
    let mut photo_ids: HashSet<Uuid> = HashSet::new();
    for rows in by_patron.values() {
        for r in rows {
            if let Some(fid) = r.primary_photo_file_upload {
                photo_ids.insert(fid);
            }
        }
    }
    let photo_paths: HashMap<Uuid, String> = if photo_ids.is_empty() {
        HashMap::new()
    } else {
        match asset_client
            .get_files_by_uuid(&photo_ids.into_iter().collect::<Vec<_>>())
            .await
        {
            Ok(files) => files
                .into_iter()
                .map(|f| (f.uuid, f.relative_path))
                .collect(),
            Err(e) => {
                tracing::warn!(error = %e, "asset photo-path fetch failed; emitting rows without photos");
                HashMap::new()
            }
        }
    };

    let mut out = Vec::with_capacity(page_ids.len());
    for &id in page_ids {
        if let Some(rows) = by_patron.remove(&id) {
            out.push(collapse_summary_rows(id, rows, sort, &labels, &photo_paths));
        } else if let Some(patron) = base_patrons.get(&id) {
            out.push(empty_aggregate_row(patron));
        }
        // If we can't find the patron at all (deleted between the
        // page query and the decoration), silently skip rather than
        // emit a half-filled row.
    }
    Ok(out)
}

/// Collapse the per-(patron, org) rows for one patron into a single
/// response row. Aggregates SUM across orgs; lift dates / incident
/// dates take MIN/MAX as the sort mode requires.
fn collapse_summary_rows(
    patron_id: i32,
    rows: Vec<PatronSummaryRow>,
    sort: &SortMode,
    labels: &std::collections::HashMap<Uuid, String>,
    photo_paths: &std::collections::HashMap<Uuid, String>,
) -> PatronSearchRow {
    // Pick a base row for the patron-identity columns. Any row will
    // do since they all carry the same patron snapshot.
    let base = &rows[0];

    let display_name = base.display_name.clone().unwrap_or_else(|| {
        format!(
            "{} {}",
            base.first_name.as_deref().unwrap_or(""),
            base.last_name.as_deref().unwrap_or("")
        )
        .trim()
        .to_string()
    });

    let incident_count: i64 = rows.iter().map(|r| r.incident_count.unwrap_or(0)).sum();
    let active_ban_count: i64 = rows.iter().map(|r| r.active_ban_count.unwrap_or(0)).sum();
    // Trespass count is replicated across every per-org row for the
    // same patron, so picking any one (here: the max so we tolerate
    // any drift) gives the right cross-location number.
    let active_trespass_count: i64 = rows
        .iter()
        .map(|r| r.active_trespass_count.unwrap_or(0))
        .max()
        .unwrap_or(0);

    // Display-mode dates: MAX(last_incident_at) for the "most recent"
    // semantics regardless of sort.
    let last_incident_default = rows.iter().filter_map(|r| r.last_incident_at).max();
    // Sort-aware incident date: MIN of first_incident_at (asc) or MAX
    // of last_incident_at (desc).
    let sort_incident = match (&sort.by, sort.descending) {
        (SortKey::IncidentDate, false) => rows.iter().filter_map(|r| r.first_incident_at).min(),
        (SortKey::IncidentDate, true) => rows.iter().filter_map(|r| r.last_incident_at).max(),
        _ => None,
    };
    let (last_incident_date, sort_incident_date) = match sort.by {
        SortKey::IncidentDate => (None, sort_incident),
        _ => (last_incident_default, None),
    };

    // Pick the org row whose incident date best represents the
    // patron for display (matches the legacy "approximation" caveat).
    let representative = rows
        .iter()
        .filter(|r| r.last_incident_at.is_some())
        .max_by_key(|r| r.last_incident_at)
        .or_else(|| rows.first());
    let incident_org_unit_id = representative.map(|r| r.org_unit);
    let incident_org_unit_label = incident_org_unit_id.and_then(|id| labels.get(&id).cloned());

    // Ban / trespass lift-date aggregates: sort-aware MIN/MAX when
    // the caller is sorting by lift date, MAX otherwise (display
    // convention from legacy).
    let ban_max_lifts_at = match (&sort.by, sort.descending) {
        (SortKey::LiftDate, false) => rows.iter().filter_map(|r| r.ban_min_lifts_at).min(),
        _ => rows.iter().filter_map(|r| r.ban_max_lifts_at).max(),
    };
    let trespass_max_lifts_at = match (&sort.by, sort.descending) {
        (SortKey::LiftDate, false) => rows.iter().filter_map(|r| r.trespass_min_lifts_at).min(),
        _ => rows.iter().filter_map(|r| r.trespass_max_lifts_at).max(),
    };

    // STRING_AGG-like collapse over the distinct org labels for orgs
    // that hold an active ban. Sorted for deterministic output.
    // Labels come from the batched odo-org lookup (see
    // assemble_response_rows); rows whose org_unit isn't in the map
    // — typically a transient odo-org outage — drop out.
    let mut ban_locations: Vec<String> = rows
        .iter()
        .filter(|r| r.active_ban_count.unwrap_or(0) > 0)
        .filter_map(|r| labels.get(&r.org_unit).cloned())
        .collect();
    ban_locations.sort();
    ban_locations.dedup();
    let ban_location_names = if ban_locations.is_empty() {
        None
    } else {
        Some(ban_locations.join(", "))
    };

    // Find a row with a non-null photo path — they're all the same
    // value per patron (the view's subquery is patron-keyed), so
    // first non-null wins.
    // Same primary-photo file_upload id per patron (view is patron-keyed); first
    // non-null wins, resolved to a path via the batched odo-asset lookup.
    let primary_photo_path = rows
        .iter()
        .find_map(|r| r.primary_photo_file_upload)
        .and_then(|fid| photo_paths.get(&fid).cloned());

    PatronSearchRow {
        id: patron_id,
        library_card: base.library_card.clone(),
        first_name: base.first_name.clone().unwrap_or_default(),
        middle_name: base.middle_name.clone(),
        last_name: base.last_name.clone().unwrap_or_default(),
        display_name,
        email: base.email.clone(),
        alias: base.alias.clone(),
        risk_level: base.risk_level.clone(),
        notes: base.notes.clone(),
        is_unknown: base.is_unknown.unwrap_or(false),
        incident_count,
        active_ban_count,
        active_trespass_count,
        primary_photo_path,
        last_incident_date,
        sort_incident_date,
        incident_org_unit_id,
        incident_org_unit_label,
        ban_max_lifts_at,
        trespass_max_lifts_at,
        ban_location_names,
    }
}

/// Response row for a patron with no view rows in scope. All
/// aggregates default to zero; the base patron columns come from
/// `incidents.patrons` directly.
fn empty_aggregate_row(p: &patrons::Model) -> PatronSearchRow {
    PatronSearchRow {
        id: p.id,
        library_card: p.library_card.clone(),
        first_name: p.first_name.clone(),
        middle_name: p.middle_name.clone(),
        last_name: p.last_name.clone(),
        display_name: p.display_name.clone(),
        email: p.email.clone(),
        alias: p.alias.clone(),
        risk_level: p.risk_level.clone(),
        notes: p.notes.clone(),
        is_unknown: p.is_unknown,
        incident_count: 0,
        active_ban_count: 0,
        active_trespass_count: 0,
        primary_photo_path: None,
        last_incident_date: None,
        sort_incident_date: None,
        incident_org_unit_id: None,
        incident_org_unit_label: None,
        ban_max_lifts_at: None,
        trespass_max_lifts_at: None,
        ban_location_names: None,
    }
}

// ===========================================================================
// patron.merge.preview / patron.merge
// ===========================================================================
//
// Two endpoints that read together: `merge/preview` returns a fat
// summary the UI uses to populate the merge wizard (per-side
// counts/items + every kind of conflict the user needs to resolve);
// `merge` actually performs the merge atomically.
//
// `merge` delegates most of the heavy lifting to the
// `incidents.merge_patrons(p_primary_id, p_secondary_id, p_merged_by)`
// SQL function which transfers incidents/photos/bans/notes/timeline,
// soft-deletes the secondary patron, and writes a `patron_merged`
// timeline event in one statement. The Rust side is responsible for:
//   1. Field-by-field conflict resolution (writing the merged values
//      back to the primary patron row before the function runs)
//   2. Lifting any bans the caller chose to drop, via the same
//      `lift_ban_record` semantics `patron.delete` uses
//   3. Wrapping all of the above in a single transaction so a failure
//      partway through doesn't leave the patron in an inconsistent
//      state

use crate::entity::{patron_notes, patron_timeline_events};

// Fields the UI is allowed to choose values for during merge. Mirrors
// the legacy whitelist; rejected fields are skipped with a warn-log
// (defense-in-depth — the UI shouldn't be sending them in the first
// place).
const ALLOWED_MERGE_FIELDS: &[&str] = &[
    "first_name",
    "last_name",
    "preferred_name",
    "library_card",
    "alias",
    "notes",
    "address_line1",
    "address_line2",
    "city",
    "state_province",
    "postal_code",
];

// ---------------------------------------------------------------------------
// Shared request/response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatronMergePreviewRequest {
    pub primary_patron_id: i32,
    pub secondary_patron_id: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatronMergeExecuteRequest {
    pub primary_patron_id: i32,
    pub secondary_patron_id: i32,
    #[serde(default)]
    pub conflict_resolutions: Vec<MergeFieldResolution>,
    #[serde(default)]
    pub ban_resolutions: Vec<MergeBanResolution>,
    #[serde(default)]
    pub trespass_resolutions: Vec<MergeTrespassResolution>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MergeFieldResolution {
    /// Conflict kind, e.g. "field_conflict" / "primary_photo". The
    /// handler dispatches on `field` for field_conflict resolutions;
    /// `type` is kept for forward-compatibility with future
    /// conflict kinds and matches the UI's wire shape.
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    /// Which patron field this resolution applies to. Empty for
    /// non-field conflict kinds (e.g. photo).
    #[serde(default)]
    pub field: Option<String>,
    /// "primary" (keep the primary patron's value), "secondary" (copy
    /// from secondary), or "custom" (use `custom_value`).
    pub resolution: String,
    /// Only used when `resolution = "custom"`. Free-form JSON to
    /// match the legacy contract.
    #[serde(default)]
    pub custom_value: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MergeBanResolution {
    pub primary_ban_id: i32,
    pub secondary_ban_id: i32,
    /// "primary" keeps the primary's ban and lifts the secondary's;
    /// "secondary" the reverse. Anything else is ignored.
    pub resolution: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MergeTrespassResolution {
    /// "primary" or "secondary"; informational only — the actual
    /// trespasses to lift are listed in `lift_ban_ids`.
    pub resolution: String,
    /// IDs of trespass ban rows to lift as part of the merge.
    #[serde(default)]
    pub lift_ban_ids: Vec<i32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronMergeExecuteResponse {
    pub success: bool,
    pub merged_patron_id: i32,
    pub deleted_patron_id: i32,
    pub data_transferred: MergeDataTransferred,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MergeDataTransferred {
    pub incidents: i64,
    pub photos: i64,
    pub bans: i64,
    pub notes: i64,
}

// Preview response shape. Most fields are passed through as
// `serde_json::Value` because they're consumed by the UI's merge
// wizard which already has typed mirrors (see
// `src/ui/incident-tracker/src/types/patron-merge.ts`) and the
// internal structures don't change frequently enough to be worth
// duplicating here.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatronMergePreviewResponse {
    pub primary_patron: serde_json::Value,
    pub secondary_patron: serde_json::Value,
    pub primary_data_summary: MergeDataSummary,
    pub secondary_data_summary: MergeDataSummary,
    pub merged_data_summary: MergeDataSummary,
    pub primary_items: MergePreviewItems,
    pub secondary_items: MergePreviewItems,
    pub conflicts: Vec<serde_json::Value>,
    pub same_incident_conflicts: Vec<serde_json::Value>,
    pub ban_conflicts: Vec<serde_json::Value>,
    pub trespass_conflicts: Vec<serde_json::Value>,
    pub can_resolve_ban_conflicts: bool,
    pub can_resolve_trespass_conflicts: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo_conflict: Option<serde_json::Value>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema, Clone)]
pub struct MergeDataSummary {
    pub incidents: i64,
    pub photos: i64,
    pub bans: i64,
    pub trespasses: i64,
    pub notes: i64,
    pub timeline_events: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MergePreviewItems {
    pub incidents: Vec<MergePreviewIncident>,
    pub photos: Vec<MergePreviewPhoto>,
    pub bans: Vec<MergePreviewBan>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MergePreviewIncident {
    pub incident_id: i32,
    pub title: String,
    pub created_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub occurred_at: chrono::DateTime<chrono::FixedOffset>,
    pub org_unit: Uuid,
    pub org_unit_label: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MergePreviewPhoto {
    pub id: i32,
    pub is_primary: bool,
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MergePreviewBan {
    pub id: i32,
    pub is_trespass: bool,
    pub starts_at: chrono::DateTime<chrono::FixedOffset>,
    pub lifts_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub org_unit: Uuid,
    pub org_unit_label: Option<String>,
    pub incident: Option<i32>,
    pub incident_title: Option<String>,
}

// ---------------------------------------------------------------------------
// patron.merge.preview handler
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/merge/preview",
    request_body = PatronMergePreviewRequest,
    responses((
        status = 200,
        body = PatronMergePreviewResponse,
        description = "Per-side counts + items + conflicts the UI uses to populate the merge wizard"
    )),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn patron_merge_preview(
    State(state): State<Arc<AppState>>,
    Json(params): Json<PatronMergePreviewRequest>,
) -> ApiResult<Json<PatronMergePreviewResponse>> {
    if params.primary_patron_id == params.secondary_patron_id {
        return Err(LocalError::invalid_input("Cannot merge a patron with itself").into());
    }

    state
        .auth_client
        .permission_required_uuid("current.patron.read", None)
        .await?;

    let primary = load_patron_for_merge(&state, params.primary_patron_id)
        .await?
        .ok_or_else(|| LocalError::not_found("Primary patron"))?;
    let secondary = load_patron_for_merge(&state, params.secondary_patron_id)
        .await?
        .ok_or_else(|| LocalError::not_found("Secondary patron"))?;

    let (primary_summary, primary_items) =
        gather_patron_merge_data(&state, params.primary_patron_id).await?;
    let (secondary_summary, secondary_items) =
        gather_patron_merge_data(&state, params.secondary_patron_id).await?;

    let conflicts = detect_field_conflicts(&primary, &secondary);
    let same_incident_conflicts = detect_same_incident_conflicts(
        &state.db,
        params.primary_patron_id,
        params.secondary_patron_id,
    )
    .await?;

    let overlap_count = same_incident_conflicts.len() as i64;
    let merged_summary = MergeDataSummary {
        incidents: primary_summary.incidents + secondary_summary.incidents - overlap_count,
        photos: primary_summary.photos + secondary_summary.photos,
        bans: primary_summary.bans + secondary_summary.bans,
        trespasses: primary_summary.trespasses + secondary_summary.trespasses,
        notes: primary_summary.notes + secondary_summary.notes,
        timeline_events: primary_summary.timeline_events + secondary_summary.timeline_events,
    };

    let primary_active_bans = load_active_bans_with_org(&state, params.primary_patron_id).await?;
    let secondary_active_bans =
        load_active_bans_with_org(&state, params.secondary_patron_id).await?;
    let ban_conflicts = detect_ban_conflicts(&primary_active_bans, &secondary_active_bans);
    let trespass_conflicts =
        detect_trespass_conflicts(&primary_active_bans, &secondary_active_bans);

    let photo_conflict = detect_photo_conflict(
        &state.db,
        params.primary_patron_id,
        params.secondary_patron_id,
    )
    .await?;

    let mut warnings = Vec::new();
    if primary_summary.incidents + secondary_summary.incidents > 50 {
        warnings.push("High number of incidents will be merged".to_string());
    }

    Ok(Json(PatronMergePreviewResponse {
        primary_patron: primary,
        secondary_patron: secondary,
        primary_data_summary: primary_summary,
        secondary_data_summary: secondary_summary,
        merged_data_summary: merged_summary,
        primary_items,
        secondary_items,
        conflicts,
        same_incident_conflicts,
        ban_conflicts,
        trespass_conflicts,
        can_resolve_ban_conflicts: true,
        can_resolve_trespass_conflicts: true,
        photo_conflict,
        warnings,
    }))
}

// ---------------------------------------------------------------------------
// patron.merge handler
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/v1/current/patron/merge",
    request_body = PatronMergeExecuteRequest,
    responses((
        status = 200,
        body = PatronMergeExecuteResponse,
        description = "Merge result + counts of rows transferred from secondary to primary"
    )),
    security(("bearer" = [])),
    tag = "patrons"
)]
pub async fn patron_merge_execute(
    State(state): State<Arc<AppState>>,
    Json(params): Json<PatronMergeExecuteRequest>,
) -> ApiResult<Json<PatronMergeExecuteResponse>> {
    if params.primary_patron_id == params.secondary_patron_id {
        return Err(LocalError::invalid_input("Cannot merge a patron with itself").into());
    }

    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    state
        .auth_client
        .permission_required_uuid("current.patron.write", None)
        .await?;

    let txn = state.db.begin().await?;

    // 1. Load both patrons. Either being missing or already deleted
    // means the merge is invalid and we 404 — same shape as
    // patron.delete's not-found behavior.
    let primary = patrons::Entity::find_by_id(params.primary_patron_id)
        .one(&txn)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("patron {}", params.primary_patron_id)))?;
    let secondary = patrons::Entity::find_by_id(params.secondary_patron_id)
        .one(&txn)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("patron {}", params.secondary_patron_id)))?;

    let new_primary_id = primary.id;

    // 2. Lift bans the caller picked to drop. Same semantics as
    // patron.delete's lift loop; reused via lift_bans_with_reason.
    let ban_ids_to_lift = collect_ban_ids_to_lift(&params);
    let lift_now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
    lift_bans_with_reason(
        &txn,
        &ban_ids_to_lift,
        user_id,
        lift_now,
        "Lifted via patron merge",
    )
    .await?;

    // 3. Call the merge_patrons SQL function which does the bulk row
    // transfers + soft-deletes the secondary + writes the timeline event.
    let transferred =
        call_merge_patrons_function(&txn, new_primary_id, params.secondary_patron_id, user_id)
            .await?;

    // 4. Apply field-by-field conflict resolutions to the primary row.
    let primary_active =
        apply_field_resolutions(primary.into(), &secondary, &params.conflict_resolutions);
    primary_active.update(&txn).await?;

    txn.commit().await?;

    tracing::info!(
        primary = new_primary_id,
        secondary = params.secondary_patron_id,
        ?transferred,
        "PatronMerge"
    );

    Ok(Json(PatronMergeExecuteResponse {
        success: true,
        merged_patron_id: new_primary_id,
        deleted_patron_id: params.secondary_patron_id,
        data_transferred: transferred,
    }))
}

// ---------------------------------------------------------------------------
// Preview helpers
// ---------------------------------------------------------------------------

/// Load a patron row + decorate with `age_range_label` and an
/// extracted `gender` from metadata. Returns None when the patron is
/// missing or soft-deleted — caller turns that into a 404.
async fn load_patron_for_merge(
    state: &AppState,
    patron_id: i32,
) -> LocalResult<Option<serde_json::Value>> {
    let Some(model) = patrons::Entity::find_by_id(patron_id)
        .filter(patrons::Column::DeletedAt.is_null())
        .one(&state.db)
        .await?
    else {
        return Ok(None);
    };
    let age_range_label = lookup_age_range_label(&state.db, model.age_range).await?;
    // The metadata column is jsonb; gender is sometimes stored at the
    // top level (legacy double-encoded shape) and sometimes nested.
    // Pull from either.
    let gender = model
        .metadata
        .as_ref()
        .and_then(extract_gender_from_metadata);
    let mut value = serde_json::to_value(&model)
        .map_err(|e| LocalError::internal(format!("patron serialization: {e}")))?;
    if let Some(obj) = value.as_object_mut() {
        if let Some(label) = age_range_label {
            obj.insert(
                "age_range_label".to_string(),
                serde_json::Value::String(label),
            );
        }
        if let Some(g) = gender {
            obj.insert("gender".to_string(), serde_json::Value::String(g));
        }
    }
    Ok(Some(value))
}

/// Extract gender from a patron metadata blob. Handles both shapes
/// (object with `gender` key, or a JSON-string containing one). Match
/// legacy's resilient behavior.
fn extract_gender_from_metadata(meta: &serde_json::Value) -> Option<String> {
    match meta {
        serde_json::Value::Object(_) => meta
            .get("gender")
            .and_then(|g| g.as_str())
            .map(String::from),
        serde_json::Value::String(s) => serde_json::from_str::<serde_json::Value>(s)
            .ok()
            .and_then(|m| m.get("gender").and_then(|g| g.as_str()).map(String::from)),
        _ => None,
    }
}

/// Pull the per-side counts + per-side items in one bundle. Counts
/// are derived from the items where possible to keep the queries
/// minimal.
async fn gather_patron_merge_data(
    state: &AppState,
    patron_id: i32,
) -> LocalResult<(MergeDataSummary, MergePreviewItems)> {
    let items = load_patron_merge_items(state, patron_id).await?;

    let incidents = items.incidents.len() as i64;
    let photos = items.photos.len() as i64;
    let (bans, trespasses) = items.bans.iter().fold((0i64, 0i64), |(b, t), ban| {
        if ban.is_trespass {
            (b, t + 1)
        } else {
            (b + 1, t)
        }
    });

    let notes = patron_notes::Entity::find()
        .filter(patron_notes::Column::PatronId.eq(patron_id))
        .filter(patron_notes::Column::DeletedAt.is_null())
        .count(&state.db)
        .await? as i64;
    let timeline_events = patron_timeline_events::Entity::find()
        .filter(patron_timeline_events::Column::PatronId.eq(patron_id))
        .count(&state.db)
        .await? as i64;

    Ok((
        MergeDataSummary {
            incidents,
            photos,
            bans,
            trespasses,
            notes,
            timeline_events,
        },
        items,
    ))
}

/// Per-patron items for the merge wizard: incidents the patron is
/// involved in, all photos, and all non-archived bans/trespasses.
/// Photo file paths go through odo-asset; org labels via odo-org —
/// matching the asset-coupling pattern the rest of `current` already
/// uses.
async fn load_patron_merge_items(
    state: &AppState,
    patron_id: i32,
) -> LocalResult<MergePreviewItems> {
    let incidents = load_patron_incident_items(state, patron_id).await?;
    let photos = load_patron_photo_items(state, patron_id).await?;
    let bans = load_patron_ban_items(state, patron_id).await?;
    Ok(MergePreviewItems {
        incidents,
        photos,
        bans,
    })
}

async fn load_patron_incident_items(
    state: &AppState,
    patron_id: i32,
) -> LocalResult<Vec<MergePreviewIncident>> {
    use crate::entity::{incidents, involved_parties};
    use std::collections::HashMap;

    let rows = involved_parties::Entity::find()
        .find_also_related(incidents::Entity)
        .filter(involved_parties::Column::PatronId.eq(patron_id))
        .all(&state.db)
        .await?;

    let mut incidents_out = Vec::with_capacity(rows.len());
    let mut org_ids: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    let mut staged: Vec<(involved_parties::Model, incidents::Model)> = Vec::new();
    for (party, incident) in rows {
        let Some(inc) = incident else { continue };
        org_ids.insert(inc.org_unit);
        staged.push((party, inc));
    }

    // Best-effort batched org-label lookup. A failed odo-org call
    // surfaces as missing labels rather than failing the whole
    // preview — same resilience the rest of `current` uses.
    let mut org_labels: HashMap<Uuid, String> = HashMap::new();
    for id in org_ids {
        if let Ok(detail) = state.org_client.get_unit_detail_by_uuid(&id).await
            && let Some(label) = detail
                .get("org_unit")
                .and_then(|u| u.get("label"))
                .and_then(|v| v.as_str())
        {
            org_labels.insert(id, label.to_string());
        }
    }

    for (_party, incident) in staged {
        incidents_out.push(MergePreviewIncident {
            incident_id: incident.id,
            title: incident.title,
            created_at: incident.created_at,
            occurred_at: incident.occurred_at,
            org_unit: incident.org_unit,
            org_unit_label: org_labels.get(&incident.org_unit).cloned(),
        });
    }
    // Newest first by occurred_at — matches the legacy ORDER BY so the
    // UI's merge wizard renders the same row order.
    incidents_out.sort_by_key(|b| std::cmp::Reverse(b.occurred_at));
    Ok(incidents_out)
}

async fn load_patron_photo_items(
    state: &AppState,
    patron_id: i32,
) -> LocalResult<Vec<MergePreviewPhoto>> {
    let rows = patron_photo::Entity::find()
        .filter(patron_photo::Column::Patron.eq(patron_id))
        .order_by_desc(patron_photo::Column::IsPrimary)
        .order_by_desc(patron_photo::Column::Id)
        .all(&state.db)
        .await?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let file_ids: Vec<Uuid> = rows.iter().map(|r| r.file_upload).collect();
    let files: std::collections::HashMap<Uuid, odo_client::client::FileUploadMetadata> = state
        .asset_client
        .get_files_by_uuid(&file_ids)
        .await?
        .into_iter()
        .map(|f| (f.uuid, f))
        .collect();

    Ok(rows
        .into_iter()
        .map(|r| MergePreviewPhoto {
            id: r.id,
            is_primary: r.is_primary,
            file_path: files.get(&r.file_upload).map(|f| f.relative_path.clone()),
        })
        .collect())
}

async fn load_patron_ban_items(
    state: &AppState,
    patron_id: i32,
) -> LocalResult<Vec<MergePreviewBan>> {
    use crate::entity::incidents;
    use std::collections::{HashMap, HashSet};

    let rows = patron_ban::Entity::find()
        .filter(patron_ban::Column::Patron.eq(patron_id))
        .filter(patron_ban::Column::ArchivedBy.is_null())
        .order_by_desc(patron_ban::Column::StartsAt)
        .all(&state.db)
        .await?;

    let incident_ids: HashSet<i32> = rows.iter().map(|r| r.incident).collect();
    let incident_titles: HashMap<i32, String> = if incident_ids.is_empty() {
        HashMap::new()
    } else {
        incidents::Entity::find()
            .filter(incidents::Column::Id.is_in(incident_ids))
            .all(&state.db)
            .await?
            .into_iter()
            .map(|m| (m.id, m.title))
            .collect()
    };
    let org_ids: HashSet<Uuid> = rows.iter().map(|r| r.org_unit).collect();
    let mut org_labels: HashMap<Uuid, String> = HashMap::new();
    for id in org_ids {
        if let Ok(detail) = state.org_client.get_unit_detail_by_uuid(&id).await
            && let Some(label) = detail
                .get("org_unit")
                .and_then(|u| u.get("label"))
                .and_then(|v| v.as_str())
        {
            org_labels.insert(id, label.to_string());
        }
    }

    Ok(rows
        .into_iter()
        .map(|b| MergePreviewBan {
            id: b.id,
            is_trespass: b.is_trespass,
            starts_at: b.starts_at,
            lifts_at: Some(b.lifts_at),
            org_unit: b.org_unit,
            org_unit_label: org_labels.get(&b.org_unit).cloned(),
            incident: Some(b.incident),
            incident_title: incident_titles.get(&b.incident).cloned(),
        })
        .collect())
}

/// Active (non-archived, non-lifted) bans for a patron, decorated
/// with org labels. Used for the ban + trespass conflict detectors;
/// matches the legacy's `get_active_bans` shape down to the
/// `org_unit_name` field name so the JSON-passthrough conflict rows
/// match what the UI expects.
async fn load_active_bans_with_org(
    state: &AppState,
    patron_id: i32,
) -> LocalResult<Vec<serde_json::Value>> {
    use std::collections::{HashMap, HashSet};

    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
    let rows = patron_ban::Entity::find()
        .filter(patron_ban::Column::Patron.eq(patron_id))
        .filter(patron_ban::Column::ArchivedBy.is_null())
        .filter(patron_ban::Column::LiftsAt.gt(now))
        .all(&state.db)
        .await?;
    let org_ids: HashSet<Uuid> = rows.iter().map(|r| r.org_unit).collect();
    let mut org_labels: HashMap<Uuid, String> = HashMap::new();
    for id in org_ids {
        if let Ok(detail) = state.org_client.get_unit_detail_by_uuid(&id).await
            && let Some(label) = detail
                .get("org_unit")
                .and_then(|u| u.get("label"))
                .and_then(|v| v.as_str())
        {
            org_labels.insert(id, label.to_string());
        }
    }
    Ok(rows
        .into_iter()
        .map(|b| {
            let label = org_labels.get(&b.org_unit).cloned();
            serde_json::json!({
                "id": b.id,
                "patron": b.patron,
                "incident": b.incident,
                "org_unit": b.org_unit,
                "org_unit_name": label,
                "is_trespass": b.is_trespass,
                "starts_at": b.starts_at,
                "lifts_at": b.lifts_at,
                "comments": b.comments,
                "created_at": b.created_at,
            })
        })
        .collect())
}

/// Pure-fn field-by-field conflict detector: returns one
/// `field_conflict` entry per field where both sides have a non-null
/// value and they differ. Field list mirrors the legacy whitelist
/// (`ALLOWED_MERGE_FIELDS` + display labels). Output JSON shape is
/// what the UI's wizard expects.
fn detect_field_conflicts(
    primary: &serde_json::Value,
    secondary: &serde_json::Value,
) -> Vec<serde_json::Value> {
    const CHECKED: &[(&str, &str)] = &[
        ("first_name", "First Name"),
        ("last_name", "Last Name"),
        ("preferred_name", "Preferred Name"),
        ("library_card", "Library Card"),
        ("alias", "Alias"),
        ("address_line1", "Address Line 1"),
        ("address_line2", "Address Line 2"),
        ("city", "City"),
        ("state_province", "State / Province"),
        ("postal_code", "Postal Code"),
        ("notes", "Patron Description"),
    ];

    let mut out = Vec::new();
    for (field, label) in CHECKED {
        let p = primary.get(field);
        let s = secondary.get(field);
        if let (Some(pv), Some(sv)) = (p, s)
            && !pv.is_null()
            && !sv.is_null()
            && pv != sv
        {
            out.push(serde_json::json!({
                "type": "field_conflict",
                "field": field,
                "primary_value": pv,
                "secondary_value": sv,
                "description": format!("{label} differs between patrons"),
                "resolution": "primary",
            }));
        }
    }
    out
}

/// Returns one entry per incident where both patrons are involved
/// parties. The UI uses this to warn that resolving the merge will
/// dedup their participation in that incident.
async fn detect_same_incident_conflicts<C: ConnectionTrait>(
    db: &C,
    primary_id: i32,
    secondary_id: i32,
) -> LocalResult<Vec<serde_json::Value>> {
    use crate::entity::{incidents, involved_parties};

    let primary_parties: Vec<involved_parties::Model> = involved_parties::Entity::find()
        .filter(involved_parties::Column::PatronId.eq(primary_id))
        .all(db)
        .await?;
    let secondary_parties: Vec<involved_parties::Model> = involved_parties::Entity::find()
        .filter(involved_parties::Column::PatronId.eq(secondary_id))
        .all(db)
        .await?;

    // Intersect on incident_id. Secondary roles get looked up via a
    // small map so the per-row cost stays linear.
    use std::collections::HashMap;
    let secondary_by_incident: HashMap<i32, &involved_parties::Model> = secondary_parties
        .iter()
        .map(|m| (m.incident_id, m))
        .collect();

    let shared_incident_ids: Vec<i32> = primary_parties
        .iter()
        .filter(|p| secondary_by_incident.contains_key(&p.incident_id))
        .map(|p| p.incident_id)
        .collect();
    let incident_titles: HashMap<i32, String> = if shared_incident_ids.is_empty() {
        HashMap::new()
    } else {
        incidents::Entity::find()
            .filter(incidents::Column::Id.is_in(shared_incident_ids))
            .all(db)
            .await?
            .into_iter()
            .map(|m| (m.id, m.title))
            .collect()
    };

    let mut out = Vec::new();
    for p in primary_parties {
        let Some(s) = secondary_by_incident.get(&p.incident_id) else {
            continue;
        };
        out.push(serde_json::json!({
            "incident_id": p.incident_id,
            "incident_title": incident_titles.get(&p.incident_id),
            "primary_role": p.role,
            "secondary_role": s.role,
            "is_primary_patron": false,
            "resolution": "keep_both",
        }));
    }
    Ok(out)
}

/// Pair up active non-trespass bans by `org_unit`. Each pair becomes
/// one conflict the UI asks the user to resolve.
fn detect_ban_conflicts(
    primary_bans: &[serde_json::Value],
    secondary_bans: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    for pb in primary_bans {
        if pb
            .get("is_trespass")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        let p_org = pb.get("org_unit").and_then(|v| v.as_i64());
        let p_org_name = pb
            .get("org_unit_name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Library");
        for sb in secondary_bans {
            if sb
                .get("is_trespass")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                continue;
            }
            if p_org == sb.get("org_unit").and_then(|v| v.as_i64()) {
                out.push(serde_json::json!({
                    "org_unit_id": p_org,
                    "org_unit_name": p_org_name,
                    "primary_ban": pb,
                    "secondary_ban": sb,
                }));
            }
        }
    }
    out
}

/// Trespasses are cross-location, so a "conflict" is just "both sides
/// have at least one active trespass". Returns a single bundled
/// conflict with both lists when that's true, empty otherwise.
fn detect_trespass_conflicts(
    primary_bans: &[serde_json::Value],
    secondary_bans: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    let primary_tres: Vec<&serde_json::Value> = primary_bans
        .iter()
        .filter(|b| {
            b.get("is_trespass")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .collect();
    let secondary_tres: Vec<&serde_json::Value> = secondary_bans
        .iter()
        .filter(|b| {
            b.get("is_trespass")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .collect();
    if primary_tres.is_empty() || secondary_tres.is_empty() {
        return Vec::new();
    }
    vec![serde_json::json!({
        "primary_trespasses": primary_tres,
        "secondary_trespasses": secondary_tres,
    })]
}

/// Returns Some(conflict) when both patrons have a primary photo.
/// The merge_patrons SQL function demotes secondary's primary before
/// transferring photos, but the UI still wants to show the conflict
/// so the user knows what's happening.
async fn detect_photo_conflict<C: ConnectionTrait>(
    db: &C,
    primary_id: i32,
    secondary_id: i32,
) -> LocalResult<Option<serde_json::Value>> {
    let primary_photo = patron_photo::Entity::find()
        .filter(patron_photo::Column::Patron.eq(primary_id))
        .filter(patron_photo::Column::IsPrimary.eq(true))
        .one(db)
        .await?;
    let secondary_photo = patron_photo::Entity::find()
        .filter(patron_photo::Column::Patron.eq(secondary_id))
        .filter(patron_photo::Column::IsPrimary.eq(true))
        .one(db)
        .await?;
    if let (Some(p), Some(s)) = (primary_photo, secondary_photo) {
        return Ok(Some(serde_json::json!({
            "primary_photo": {"id": p.id, "file_upload": p.file_upload},
            "secondary_photo": {"id": s.id, "file_upload": s.file_upload},
            "resolution": "primary",
        })));
    }
    Ok(None)
}

// ---------------------------------------------------------------------------
// Execute helpers
// ---------------------------------------------------------------------------

/// Apply per-field conflict resolutions to the primary patron's
/// ActiveModel. Only fields a resolution actually changed get marked
/// `Set()` — every other field stays `Unchanged`, so the resulting
/// `update()` touches exactly the columns it should.
///
/// Resolutions of kind "primary" are no-ops by design (the existing
/// value already wins). Unknown fields are skipped with a warn-log
/// (defense-in-depth — the UI shouldn't send them in the first place).
///
/// **Historical note:** an earlier iteration mutated a `Model` then
/// converted via `.into()` and tried to force fields through with
/// `.take().unwrap()`. That approach silently dropped every
/// resolution beyond `first_name` and `last_name` because
/// `Model → ActiveModel` produces `Unchanged` for every field. The
/// shape below — operate directly on `ActiveModel`, call `Set()` per
/// touched field — is the only one that round-trips through `update()`.
fn apply_field_resolutions(
    mut primary: patrons::ActiveModel,
    secondary: &patrons::Model,
    resolutions: &[MergeFieldResolution],
) -> patrons::ActiveModel {
    for r in resolutions {
        let Some(field) = r.field.as_deref() else {
            continue;
        };
        let primary_id = primary.id.clone().unwrap();
        // Two virtual fields the legacy treats specially.
        if field == "age_range_label" {
            if r.resolution == "secondary" {
                primary.age_range = Set(secondary.age_range);
            }
            continue;
        }
        if field == "gender" {
            if r.resolution == "secondary" {
                // Start from whatever the primary's metadata is
                // currently slated to be (`Set` if a prior resolution
                // touched it, `Unchanged` otherwise) so we preserve
                // any other keys on the blob.
                let base = current_metadata(&primary);
                let new_meta = with_metadata_gender(
                    base,
                    secondary
                        .metadata
                        .as_ref()
                        .and_then(extract_gender_from_metadata),
                );
                primary.metadata = Set(new_meta);
            }
            continue;
        }
        if !ALLOWED_MERGE_FIELDS.contains(&field) {
            tracing::warn!(
                field,
                primary_id = primary_id,
                secondary_id = secondary.id,
                "merge: skipping non-whitelisted field"
            );
            continue;
        }
        match r.resolution.as_str() {
            "secondary" => set_field_from_secondary(&mut primary, secondary, field),
            "custom" => {
                if let Some(custom) = r.custom_value.as_ref() {
                    set_field_from_custom(&mut primary, field, custom);
                }
            }
            _ => {}
        }
    }
    primary
}

/// Read the metadata value off the primary's ActiveModel without
/// changing its `Set` / `Unchanged` state. Used by the gender
/// resolution branch which needs to preserve other keys on the blob
/// when injecting the new gender field.
fn current_metadata(primary: &patrons::ActiveModel) -> Option<serde_json::Value> {
    match primary.metadata.clone() {
        sea_orm::ActiveValue::Set(v) | sea_orm::ActiveValue::Unchanged(v) => v,
        _ => None,
    }
}

/// Copy a single text field from secondary to primary's ActiveModel
/// via `Set()`. Each branch matches the field's name on the entity;
/// missing branches mean the field isn't on the entity (caller
/// already filtered against `ALLOWED_MERGE_FIELDS`).
fn set_field_from_secondary(
    primary: &mut patrons::ActiveModel,
    secondary: &patrons::Model,
    field: &str,
) {
    match field {
        "first_name" => primary.first_name = Set(secondary.first_name.clone()),
        "last_name" => primary.last_name = Set(secondary.last_name.clone()),
        "preferred_name" => primary.preferred_name = Set(secondary.preferred_name.clone()),
        "library_card" => primary.library_card = Set(secondary.library_card.clone()),
        "alias" => primary.alias = Set(secondary.alias.clone()),
        "notes" => primary.notes = Set(secondary.notes.clone()),
        "address_line1" => primary.address_line1 = Set(secondary.address_line1.clone()),
        "address_line2" => primary.address_line2 = Set(secondary.address_line2.clone()),
        "city" => primary.city = Set(secondary.city.clone()),
        "state_province" => primary.state_province = Set(secondary.state_province.clone()),
        "postal_code" => primary.postal_code = Set(secondary.postal_code.clone()),
        _ => {}
    }
}

/// Apply a caller-provided custom value to a primary patron field.
/// Custom values arrive as JSON; we coerce strings into the right
/// column type per the entity's shape (every supported field is
/// String / Option<String>). Non-string custom values for a string
/// field are silently ignored — the legacy did the same.
fn set_field_from_custom(
    primary: &mut patrons::ActiveModel,
    field: &str,
    value: &serde_json::Value,
) {
    let as_str = value.as_str();
    // Non-optional fields require a string; optional fields accept
    // either a string (set to that string) or json null (clear).
    let as_opt = match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.clone()),
        _ => return,
    };
    match field {
        "first_name" => {
            if let Some(s) = as_str {
                primary.first_name = Set(s.to_string());
            }
        }
        "last_name" => {
            if let Some(s) = as_str {
                primary.last_name = Set(s.to_string());
            }
        }
        "preferred_name" => primary.preferred_name = Set(as_opt),
        "library_card" => primary.library_card = Set(as_opt),
        "alias" => primary.alias = Set(as_opt),
        "notes" => primary.notes = Set(as_opt),
        "address_line1" => primary.address_line1 = Set(as_opt),
        "address_line2" => primary.address_line2 = Set(as_opt),
        "city" => primary.city = Set(as_opt),
        "state_province" => primary.state_province = Set(as_opt),
        "postal_code" => primary.postal_code = Set(as_opt),
        _ => {}
    }
}

/// Build a new metadata blob with `gender` set (or cleared when
/// `gender = None`). Preserves any other keys already present.
fn with_metadata_gender(
    existing: Option<serde_json::Value>,
    gender: Option<String>,
) -> Option<serde_json::Value> {
    use serde_json::Value;
    let mut obj = match existing {
        Some(Value::Object(map)) => map,
        Some(Value::String(s)) => serde_json::from_str(&s)
            .ok()
            .and_then(|v: Value| {
                if let Value::Object(m) = v {
                    Some(m)
                } else {
                    None
                }
            })
            .unwrap_or_default(),
        _ => serde_json::Map::new(),
    };
    match gender {
        Some(g) => obj.insert("gender".to_string(), Value::String(g)),
        None => obj.remove("gender"),
    };
    Some(Value::Object(obj))
}

/// Collect every ban id the caller asked to lift, from both the
/// per-ban resolution list and the trespass resolution lists.
fn collect_ban_ids_to_lift(params: &PatronMergeExecuteRequest) -> Vec<i32> {
    let mut ids = Vec::new();
    for r in &params.ban_resolutions {
        let lose = match r.resolution.as_str() {
            "primary" => Some(r.secondary_ban_id),
            "secondary" => Some(r.primary_ban_id),
            _ => None,
        };
        if let Some(id) = lose {
            ids.push(id);
        }
    }
    for r in &params.trespass_resolutions {
        ids.extend(r.lift_ban_ids.iter().copied());
    }
    ids
}

/// Lift a set of bans in one pass, prepending `reason` to each ban's
/// comments and updating `updated_by`. Used by patron merge — same
/// semantics as `patron.delete`'s active-ban lift loop, factored out
/// so the two callsites can share it.
async fn lift_bans_with_reason<C: ConnectionTrait>(
    txn: &C,
    ban_ids: &[i32],
    user_id: Uuid,
    now: chrono::DateTime<chrono::FixedOffset>,
    reason: &str,
) -> LocalResult<()> {
    for id in ban_ids {
        let Some(ban) = patron_ban::Entity::find_by_id(*id).one(txn).await? else {
            // Skip silently — the caller had a stale id, which on
            // merge is a recoverable race (the ban already got
            // lifted/archived between preview and execute).
            tracing::warn!(
                ban_id = id,
                "lift_bans_with_reason: ban not found, skipping"
            );
            continue;
        };
        let prev = ban.comments.clone().unwrap_or_default();
        let merged = format!("{reason}\n{prev}").trim().to_string();
        let mut active: patron_ban::ActiveModel = ban.into();
        active.lifts_at = Set(now);
        active.updated_by = Set(user_id);
        active.comments = Set(Some(merged));
        active.update(txn).await?;
    }
    Ok(())
}

/// Call the `incidents.merge_patrons(primary, secondary, merged_by)`
/// SQL function. The function does the heavy row-transfer work in a
/// single statement and returns counts of what moved.
async fn call_merge_patrons_function<C: ConnectionTrait>(
    txn: &C,
    primary_id: i32,
    secondary_id: i32,
    user_id: Uuid,
) -> LocalResult<MergeDataTransferred> {
    let row = MergePatronsFnRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT incidents_transferred, photos_transferred, bans_transferred, notes_transferred \
         FROM incidents.merge_patrons($1, $2, $3)",
        [primary_id.into(), secondary_id.into(), user_id.into()],
    ))
    .one(txn)
    .await?
    .ok_or_else(|| LocalError::internal("merge_patrons returned no row"))?;

    Ok(MergeDataTransferred {
        incidents: row.incidents_transferred as i64,
        photos: row.photos_transferred as i64,
        bans: row.bans_transferred as i64,
        notes: row.notes_transferred as i64,
    })
}

#[derive(Debug, FromQueryResult)]
struct MergePatronsFnRow {
    incidents_transferred: i32,
    photos_transferred: i32,
    bans_transferred: i32,
    notes_transferred: i32,
}
