use axum::Json;
use axum::extract::{Path, State};
use odo_client::context::RequestContext;
use odo_client::error::{ApiResult, LocalError, LocalResult};
use sea_orm::prelude::*;
use sea_orm::{IntoActiveModel, QueryOrder, QuerySelect, QueryTrait, Set, TransactionTrait};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tracing::info;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::{
    activity_log, incident_review, incidents, review_chain, review_group, review_group_member,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewGroupMemberResponse {
    pub id: i32,
    pub review_group: i32,
    pub usr: Uuid,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub usr_display_name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewGroupResponse {
    pub id: i32,
    pub org_unit: Uuid,
    pub name: Option<String>,
    pub description: Option<String>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
    pub members: Vec<ReviewGroupMemberResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewChainResponse {
    pub id: i32,
    pub org_unit: Uuid,
    pub review_level: i32,
    pub reviewer_group: i32,
    pub is_final: bool,
    pub require_peer_review: bool,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
    pub reviewer_ids: Vec<Uuid>,
    pub reviewer_names: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SaveReviewChainResponse {
    pub saved: bool,
    pub level_count: usize,
}

const TEMP_LEVEL_OFFSET_EXISTING: i32 = 3_000_000;
const TEMP_LEVEL_OFFSET_NEW: i32 = 2_000_000;
const TEMP_LEVEL_OFFSET_REORDER: i32 = 1_000_000;

/// Fetch a review group with members
#[utoipa::path(
    get,
    path = "/api/v1/current/review-group/{id}",
    params(("id" = i32, Path, description = "Review Group ID")),
    responses((status = 200, body = ReviewGroupResponse, description = "Review group with members")),
    security(("bearer" = [])),
    tag = "review"
)]
pub async fn get_review_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i32>,
) -> ApiResult<Json<ReviewGroupResponse>> {
    let group = review_group::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or(LocalError::not_found("review group"))?;

    state
        .auth_client
        .permission_required_uuid("current.review.group.read", Some(&group.org_unit))
        .await?;

    let members = get_review_group_members(state, id).await?;

    Ok(Json(ReviewGroupResponse {
        id: group.id,
        org_unit: group.org_unit,
        name: group.name,
        description: group.description,
        created_at: group.created_at,
        updated_at: group.updated_at,
        members,
    }))
}

async fn get_review_group_members(
    state: Arc<AppState>,
    group_id: i32,
) -> LocalResult<Vec<ReviewGroupMemberResponse>> {
    let members = review_group_member::Entity::find()
        .filter(review_group_member::Column::ReviewGroup.eq(group_id))
        .all(&state.db)
        .await?;

    let mut result = Vec::new();
    for member in &members {
        let user_info = state
            .auth_client
            .get_user_by_uuid(&member.usr, true)
            .await?;
        result.push(ReviewGroupMemberResponse {
            id: member.id,
            review_group: member.review_group,
            usr: member.usr,
            created_at: member.created_at,
            usr_display_name: user_info["display_name"].as_str().unwrap_or("").to_string(),
        });
    }

    Ok(result)
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListReviewChainsRequest {
    org_unit: Uuid,
}

/// List review chains
#[utoipa::path(
    post,
    path = "/api/v1/current/review-chain/list",
    request_body = ListReviewChainsRequest,
    responses((
        status = 200,
        body = Vec<ReviewChainResponse>,
        description = "Review chains with members"
    )),
    security(("bearer" = [])),
    tag = "review"
)]
pub async fn list_review_chains(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ListReviewChainsRequest>,
) -> ApiResult<Json<Vec<ReviewChainResponse>>> {
    state
        .auth_client
        .permission_required_uuid("current.review.chain.read", Some(&params.org_unit))
        .await?;

    let chains = review_chain::Entity::find()
        .filter(review_chain::Column::OrgUnit.eq(params.org_unit))
        .order_by_asc(review_chain::Column::ReviewLevel)
        .all(&state.db)
        .await?;

    let mut results = Vec::new();
    for chain in chains {
        let members = get_review_group_members(state.clone(), chain.reviewer_group).await?;
        let reviewer_ids = members.iter().map(|m| m.usr).collect();
        let reviewer_names = members.iter().map(|m| m.usr_display_name.clone()).collect();

        results.push(ReviewChainResponse {
            id: chain.id,
            org_unit: chain.org_unit,
            review_level: chain.review_level,
            reviewer_group: chain.reviewer_group,
            is_final: chain.is_final,
            require_peer_review: chain.require_peer_review,
            created_at: chain.created_at,
            updated_at: chain.updated_at,
            reviewer_ids,
            reviewer_names,
        });
    }

    Ok(Json(results))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct HasReviewChainRequest {
    org_unit: Option<Uuid>,
}

/// Check if a review chain exists
#[utoipa::path(
    post,
    path = "/api/v1/current/review-chain/has",
    request_body = HasReviewChainRequest,
    responses((
        status = 200,
        body = bool,
        description = "True if a matching review chain exists"
    )),
    security(("bearer" = [])),
    tag = "review"
)]
pub async fn has_review_chain(
    State(state): State<Arc<AppState>>,
    Json(params): Json<HasReviewChainRequest>,
) -> ApiResult<Json<bool>> {
    state
        .auth_client
        .permission_required_uuid("current.review.chain.read", params.org_unit.as_ref())
        .await?;

    let chains = review_chain::Entity::find()
        .filter(review_chain::Column::OrgUnit.eq(params.org_unit))
        .limit(1)
        .all(&state.db)
        .await?;

    Ok(Json(!chains.is_empty()))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveReviewChainMember {
    usr: Uuid,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveReviewChainLevel {
    id: Option<i32>,
    reviewer_group: Option<i32>,
    require_peer_review: Option<bool>,
    members: Option<Vec<SaveReviewChainMember>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveReviewChainRequest {
    org_unit: Uuid,
    levels: Vec<SaveReviewChainLevel>,
}

/// Save a review chain
#[utoipa::path(
    post,
    path = "/api/v1/current/review-chain/save",
    request_body = SaveReviewChainRequest,
    responses((status = 200, body = SaveReviewChainResponse, description = "Saved review chain")),
    security(("bearer" = [])),
    tag = "review"
)]
pub async fn save_review_chain(
    State(state): State<Arc<AppState>>,
    Json(params): Json<SaveReviewChainRequest>,
) -> ApiResult<Json<SaveReviewChainResponse>> {
    let org_unit = params.org_unit;

    info!(
        %org_unit,
        level_count = params.levels.len(),
        "SaveReviewChain"
    );

    state
        .auth_client
        .permission_required_uuid("current.review.chain.write", Some(&org_unit))
        .await?;

    if params.levels.is_empty() {
        return Err(LocalError::invalid_input("Review chain must have at least one level").into());
    }

    let txn = state.db.begin().await?;

    // Step 1: Get current chain entries
    let current_entries = review_chain::Entity::find()
        .filter(review_chain::Column::OrgUnit.eq(org_unit))
        .all(&txn)
        .await?;

    // Step 2: Identify which IDs are in the new levels
    let new_ids: HashSet<i32> = params.levels.iter().filter_map(|l| l.id).collect();

    // Step 2.5: Check for in-flight incidents that would be orphaned
    let new_max_level = params.levels.len() as i32;

    // Get IDs of open incidents at this org_unit
    let open_incident_ids: Vec<i32> = incidents::Entity::find()
        .select_only()
        .column(incidents::Column::Id)
        .filter(incidents::Column::OrgUnit.eq(org_unit))
        .filter(incidents::Column::ResolvedAt.is_null())
        .filter(incidents::Column::DeletedAt.is_null())
        .into_tuple()
        .all(&txn)
        .await?;

    // For each open incident, find the latest review and check its min_review_level
    let mut affected_count: usize = 0;
    for incident_id in &open_incident_ids {
        let latest_review = incident_review::Entity::find()
            .filter(incident_review::Column::Incident.eq(*incident_id))
            .order_by_desc(incident_review::Column::Id)
            .one(&txn)
            .await?;

        if let Some(review) = latest_review
            && review.min_review_level > new_max_level
        {
            affected_count += 1;
        }
    }

    if affected_count > 0 {
        return Err(LocalError::invalid_input(format!(
            "Cannot reduce review chain: {} incident(s) are waiting for review at level {} or higher. \
            Please resolve these incidents first.",
            affected_count,
            new_max_level + 1
        ))
        .into());
    }

    // Step 3: Delete removed levels
    for entry in &current_entries {
        if !new_ids.contains(&entry.id) {
            review_chain::Entity::delete_by_id(entry.id)
                .exec(&txn)
                .await?;
        }
    }

    // Step 3.5: Move existing levels to temp values to avoid UNIQUE constraint violations
    for (idx, entry) in current_entries.iter().enumerate() {
        if new_ids.contains(&entry.id) {
            let temp_level = TEMP_LEVEL_OFFSET_EXISTING + (idx as i32) + 1;
            let mut model = entry.clone().into_active_model();
            model.review_level = Set(temp_level);
            model.update(&txn).await?;
        }
    }

    // Step 4: Create new levels and collect all IDs for reorder
    let mut all_level_ids: Vec<i32> = Vec::new();
    let mut level_groups: HashMap<i32, i32> = HashMap::new();
    let mut level_peer_review: HashMap<i32, bool> = HashMap::new();

    for (idx, level) in params.levels.iter().enumerate() {
        let require_peer_review = level.require_peer_review.unwrap_or(false);

        if let Some(existing_id) = level.id {
            all_level_ids.push(existing_id);
            level_peer_review.insert(existing_id, require_peer_review);
            if let Some(rg) = level.reviewer_group {
                level_groups.insert(existing_id, rg);
            } else if let Some(entry) = current_entries.iter().find(|e| e.id == existing_id) {
                level_groups.insert(existing_id, entry.reviewer_group);
            }
        } else {
            // New level — create group and chain entry
            let new_group = review_group::ActiveModel {
                org_unit: Set(org_unit),
                ..Default::default()
            };
            let group_result = review_group::Entity::insert(new_group).exec(&txn).await?;
            let group_id = group_result.last_insert_id;

            let temp_level = TEMP_LEVEL_OFFSET_NEW + (idx as i32) + 1;
            let new_chain = review_chain::ActiveModel {
                org_unit: Set(org_unit),
                review_level: Set(temp_level),
                reviewer_group: Set(group_id),
                is_final: Set(false),
                require_peer_review: Set(false),
                ..Default::default()
            };
            let chain_result = review_chain::Entity::insert(new_chain).exec(&txn).await?;
            let chain_id = chain_result.last_insert_id;

            all_level_ids.push(chain_id);
            level_groups.insert(chain_id, group_id);
            level_peer_review.insert(chain_id, require_peer_review);

            // Add members to new group
            if let Some(members) = &level.members {
                for member in members {
                    let new_member = review_group_member::ActiveModel {
                        review_group: Set(group_id),
                        usr: Set(member.usr),
                        ..Default::default()
                    };
                    // Ignore duplicates
                    let _ = review_group_member::Entity::insert(new_member)
                        .exec(&txn)
                        .await;
                }
            }
        }
    }

    // Step 5: Reorder — set all to high temp values
    for (idx, &id) in all_level_ids.iter().enumerate() {
        let temp_level = TEMP_LEVEL_OFFSET_REORDER + (idx as i32) + 1;
        let entry = review_chain::Entity::find_by_id(id)
            .one(&txn)
            .await?
            .ok_or(LocalError::not_found("review chain entry"))?;
        let mut model = entry.into_active_model();
        model.review_level = Set(temp_level);
        model.update(&txn).await?;
    }

    // Step 6: Set final positions, is_final, and require_peer_review
    let total_levels = all_level_ids.len();
    for (idx, &id) in all_level_ids.iter().enumerate() {
        let position = (idx + 1) as i32;
        let is_final = idx == total_levels - 1;
        let peer_review = if is_final {
            false
        } else {
            *level_peer_review.get(&id).unwrap_or(&false)
        };

        let entry = review_chain::Entity::find_by_id(id)
            .one(&txn)
            .await?
            .ok_or(LocalError::not_found("review chain entry"))?;
        let mut model = entry.into_active_model();
        model.review_level = Set(position);
        model.is_final = Set(is_final);
        model.require_peer_review = Set(peer_review);
        model.update(&txn).await?;
    }

    // Step 7: Sync members for existing levels
    for (idx, level) in params.levels.iter().enumerate() {
        if level.id.is_none() {
            continue;
        }

        let chain_id = all_level_ids[idx];
        let group_id = match level_groups.get(&chain_id) {
            Some(&gid) => gid,
            None => continue,
        };

        let current_members = review_group_member::Entity::find()
            .filter(review_group_member::Column::ReviewGroup.eq(group_id))
            .all(&txn)
            .await?;
        let current_usr_ids: HashSet<Uuid> = current_members.iter().map(|m| m.usr).collect();

        let desired_usr_ids: HashSet<Uuid> = level
            .members
            .as_ref()
            .map(|arr| arr.iter().map(|m| m.usr).collect())
            .unwrap_or_default();

        for &usr in &desired_usr_ids {
            if !current_usr_ids.contains(&usr) {
                let new_member = review_group_member::ActiveModel {
                    review_group: Set(group_id),
                    usr: Set(usr),
                    ..Default::default()
                };
                let _ = review_group_member::Entity::insert(new_member)
                    .exec(&txn)
                    .await;
            }
        }

        for &usr in &current_usr_ids {
            if !desired_usr_ids.contains(&usr) {
                review_group_member::Entity::delete_many()
                    .filter(review_group_member::Column::ReviewGroup.eq(group_id))
                    .filter(review_group_member::Column::Usr.eq(usr))
                    .exec(&txn)
                    .await?;
            }
        }
    }

    txn.commit().await?;

    Ok(Json(SaveReviewChainResponse {
        saved: true,
        level_count: all_level_ids.len(),
    }))
}

// ---------------------------------------------------------------------------
// Review-state helpers
//
// Pure DB-level helpers take a &DatabaseConnection; helpers that also need
// authz role checks take &AppState so they can reach the auth client.
// ---------------------------------------------------------------------------

/// Review outcome for an incident review row.
///
/// `incidents.incident_review.result` is a TEXT column (guarded by a CHECK
/// constraint) — this is a hand-owned Rust domain enum, decoupled from the
/// generated entity (whose `result` column is a plain `String`), so the
/// review state-machine logic below keeps compile-time exhaustiveness.
/// Conversions to/from the stored string happen at the DB boundary via
/// [`ReviewResult::as_str`] / [`ReviewResult::try_from_str`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReviewResult {
    Submitted,
    Approved,
    ApprovedWithEdits,
    Returned,
    Deleted,
    Resolved,
    Reopened,
}

const INCIDENT_ADMIN_ROLE: &str = "incident-admin";

impl ReviewResult {
    /// Wire-format string matching the DB `string_value` for each variant.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Submitted => "submitted",
            Self::Approved => "approved",
            Self::ApprovedWithEdits => "approved-with-edits",
            Self::Returned => "returned",
            Self::Deleted => "deleted",
            Self::Resolved => "resolved",
            Self::Reopened => "reopened",
        }
    }

    /// Parse a wire-format string back to a variant. Mirrors `as_str`.
    pub fn try_from_str(s: &str) -> LocalResult<Self> {
        Ok(match s {
            "submitted" => Self::Submitted,
            "approved" => Self::Approved,
            "approved-with-edits" => Self::ApprovedWithEdits,
            "returned" => Self::Returned,
            "deleted" => Self::Deleted,
            "resolved" => Self::Resolved,
            "reopened" => Self::Reopened,
            other => {
                return Err(LocalError::invalid_input(format!(
                    "unknown review result: {other}"
                )));
            }
        })
    }

    /// Result indicates the review process has terminated.
    pub fn is_final(&self) -> bool {
        matches!(self, Self::Deleted | Self::Resolved)
    }

    /// Result indicates forward motion in the chain.
    pub fn is_progressing(&self) -> bool {
        matches!(
            self,
            Self::Submitted | Self::Approved | Self::ApprovedWithEdits
        )
    }

    pub fn is_returning(&self) -> bool {
        matches!(self, Self::Returned)
    }

    pub fn is_reopening(&self) -> bool {
        matches!(self, Self::Reopened)
    }

    pub fn is_resolving(&self) -> bool {
        matches!(self, Self::Resolved)
    }

    pub fn is_deleting(&self) -> bool {
        matches!(self, Self::Deleted)
    }
}

/// Action context used by [`user_can_review`].
#[derive(Debug, Clone, Copy, Default)]
pub struct ReviewActionFlags {
    pub is_returning: bool,
    pub is_reopening: bool,
    pub is_resolving: bool,
    pub is_deleting: bool,
}

/// Latest review row for an incident: (min_review_level, result).
pub async fn current_review_level(
    db: &DatabaseConnection,
    incident_id: i32,
) -> LocalResult<(Option<i32>, Option<ReviewResult>)> {
    let row = incident_review::Entity::find()
        .filter(incident_review::Column::Incident.eq(incident_id))
        .order_by_desc(incident_review::Column::ReviewedAt)
        .one(db)
        .await?;

    Ok(match row {
        Some(r) => (
            Some(r.min_review_level),
            Some(ReviewResult::try_from_str(&r.result)?),
        ),
        None => (None, None),
    })
}

/// Review level the user holds via review_group membership in the chain, if any.
pub async fn user_review_level_in_chain(
    db: &DatabaseConnection,
    org_unit: Uuid,
    user_id: Uuid,
) -> LocalResult<Option<i32>> {
    let row = review_chain::Entity::find()
        .inner_join(review_group::Entity)
        .join(
            sea_orm::JoinType::InnerJoin,
            review_group::Relation::ReviewGroupMember.def(),
        )
        .filter(review_chain::Column::OrgUnit.eq(org_unit))
        .filter(review_group_member::Column::Usr.eq(user_id))
        .order_by_asc(review_chain::Column::ReviewLevel)
        .one(db)
        .await?;

    Ok(row.map(|r| r.review_level))
}

/// Max review_level configured for an org unit (used to compute admin "above-final" level).
async fn max_review_level(db: &DatabaseConnection, org_unit: Uuid) -> LocalResult<i32> {
    let max = review_chain::Entity::find()
        .filter(review_chain::Column::OrgUnit.eq(org_unit))
        .order_by_desc(review_chain::Column::ReviewLevel)
        .one(db)
        .await?
        .map(|r| r.review_level)
        .unwrap_or(0);
    Ok(max)
}

/// Reviewer level of the given user for the given org unit.
/// - If the user is in the chain via a group, returns that level.
/// - If the user is an incident-admin (at or above org_unit), returns max_level + 1.
/// - Otherwise returns 0.
pub async fn reviewer_level(state: &AppState, org_unit: Uuid, user_id: Uuid) -> LocalResult<i32> {
    if let Some(level) = user_review_level_in_chain(&state.db, org_unit, user_id).await? {
        return Ok(level);
    }

    if state
        .auth_client
        .user_has_role_uuid(INCIDENT_ADMIN_ROLE, Some(&org_unit))
        .await?
    {
        let max = max_review_level(&state.db, org_unit).await?;
        return Ok(max + 1);
    }

    Ok(0)
}

/// Creator level: the review_level at which incidents created by this user enter the chain.
/// Mirrors [`reviewer_level`] but is named for clarity at call sites.
pub async fn creator_level(state: &AppState, user_id: Uuid, org_unit: Uuid) -> LocalResult<i32> {
    // Direct chain membership: highest level wins (matches legacy semantics).
    let row = review_chain::Entity::find()
        .inner_join(review_group::Entity)
        .join(
            sea_orm::JoinType::InnerJoin,
            review_group::Relation::ReviewGroupMember.def(),
        )
        .filter(review_chain::Column::OrgUnit.eq(org_unit))
        .filter(review_group_member::Column::Usr.eq(user_id))
        .order_by_desc(review_chain::Column::ReviewLevel)
        .one(&state.db)
        .await?;

    if let Some(r) = row {
        return Ok(r.review_level);
    }

    if state
        .auth_client
        .user_has_role_uuid(INCIDENT_ADMIN_ROLE, Some(&org_unit))
        .await?
    {
        let max = max_review_level(&state.db, org_unit).await?;
        return Ok(max + 1);
    }

    Ok(0)
}

/// True when the given review level is marked final for the org unit's chain.
pub async fn is_final_review_level(
    db: &DatabaseConnection,
    org_unit: Uuid,
    level: i32,
) -> LocalResult<bool> {
    let row = review_chain::Entity::find()
        .filter(review_chain::Column::OrgUnit.eq(org_unit))
        .filter(review_chain::Column::ReviewLevel.eq(level))
        .one(db)
        .await?;

    Ok(row.map(|r| r.is_final).unwrap_or(false))
}

/// True when the user sits at a final review level for the org unit,
/// or holds incident-admin which implicitly grants final-reviewer rights.
pub async fn is_user_final_reviewer(
    state: &AppState,
    org_unit: Uuid,
    user_id: Uuid,
) -> LocalResult<bool> {
    match user_review_level_in_chain(&state.db, org_unit, user_id).await? {
        Some(level) => is_final_review_level(&state.db, org_unit, level).await,
        None => {
            state
                .auth_client
                .user_has_role_uuid(INCIDENT_ADMIN_ROLE, Some(&org_unit))
                .await
        }
    }
}

/// Whether peer review is required at a given level in an org unit's chain.
pub async fn require_peer_review(
    db: &DatabaseConnection,
    org_unit: Uuid,
    level: i32,
) -> LocalResult<bool> {
    let row = review_chain::Entity::find()
        .filter(review_chain::Column::OrgUnit.eq(org_unit))
        .filter(review_chain::Column::ReviewLevel.eq(level))
        .one(db)
        .await?;

    Ok(row.map(|r| r.require_peer_review).unwrap_or(false))
}

/// Reviewer ID of the most recent "submitted" review for an incident, if any.
pub async fn last_submitter(
    db: &DatabaseConnection,
    incident_id: i32,
) -> LocalResult<Option<Uuid>> {
    let row = incident_review::Entity::find()
        .filter(incident_review::Column::Incident.eq(incident_id))
        .filter(incident_review::Column::Result.eq(ReviewResult::Submitted.as_str()))
        .order_by_desc(incident_review::Column::ReviewedAt)
        .one(db)
        .await?;

    Ok(row.map(|r| r.reviewed_by))
}

/// Pure-logic helper: compute the min_review_level the new review row
/// should record, given the action being taken plus the actor's level
/// and the incident's prior level.
///
/// The level field on `incident_review` tracks the review stage AFTER
/// the action:
///   - Submit → reviewer_level (peer-review) or reviewer_level + 1
///     (skip the submitter's own level), or 1 if the submitter isn't in
///     the chain at all
///   - Approve / ApprovedWithEdits → reviewer_level + 1 (lets a
///     higher-level reviewer pull an incident past intermediate levels)
///   - Returned → 0 (back to creator)
///   - Resolved / Deleted → previous_level (incident closes, level held)
///   - Reopened → 1 (review restarts)
pub fn calculate_next_review_level(
    previous_level: i32,
    reviewer_level: i32,
    result: &ReviewResult,
    require_peer_review: bool,
) -> i32 {
    match result {
        ReviewResult::Submitted => {
            if reviewer_level > 0 {
                if require_peer_review {
                    // Stay at the submitter's level so peers can review.
                    reviewer_level
                } else {
                    // Skip the submitter's own level — they don't review their own report.
                    reviewer_level + 1
                }
            } else {
                // Regular staff (not in chain) always starts at level 1.
                1
            }
        }
        ReviewResult::Approved | ReviewResult::ApprovedWithEdits => reviewer_level + 1,
        ReviewResult::Returned => 0,
        ReviewResult::Resolved | ReviewResult::Deleted => previous_level,
        ReviewResult::Reopened => 1,
    }
}

/// DB-dependent wrapper around [`calculate_next_review_level`]: looks
/// up the current level, the actor's level, and peer-review config,
/// then returns `(prev_level, next_level)`.
pub async fn calculate_review_level(
    state: &AppState,
    incident_id: i32,
    next_result: &ReviewResult,
    org_unit: Uuid,
    user_id: Uuid,
) -> LocalResult<(i32, i32)> {
    let (cur_level_opt, current_result) = current_review_level(&state.db, incident_id).await?;
    let cur_level = cur_level_opt.unwrap_or(0);

    let r_level = reviewer_level(state, org_unit, user_id).await?;

    let is_resubmit_after_return = current_result == Some(ReviewResult::Returned);

    let require_peer =
        if *next_result == ReviewResult::Submitted && r_level > 0 && !is_resubmit_after_return {
            require_peer_review(&state.db, org_unit, r_level).await?
        } else {
            false
        };

    let next_level = calculate_next_review_level(cur_level, r_level, next_result, require_peer);
    Ok((cur_level, next_level))
}

/// Level check + peer-review exclusion for forward-motion reviews on
/// non-returned, non-final incidents.
async fn check_review_permission(
    state: &AppState,
    incident_id: i32,
    org_unit: Uuid,
    level: i32,
    user_review_level: i32,
    user_id: Uuid,
) -> LocalResult<bool> {
    if user_review_level < level {
        return Ok(false);
    }

    if require_peer_review(&state.db, org_unit, level).await? {
        let last = last_submitter(&state.db, incident_id).await?;
        Ok(last != Some(user_id))
    } else {
        Ok(true)
    }
}

/// True if the user can perform the requested review action on this incident.
///
/// Review permission is based on the user's level in the chain:
/// a user at level N can review incidents at level < N. Higher-level reviewers
/// may jump in at any earlier step.
pub async fn user_can_review(
    state: &AppState,
    incident: &incidents::Model,
    user_id: Uuid,
    flags: ReviewActionFlags,
) -> LocalResult<bool> {
    let incident_id = incident.id;
    let org_unit = incident.org_unit;
    let created_by = incident.created_by;

    let (current_level_opt, current_result) = current_review_level(&state.db, incident_id).await?;
    let level = current_level_opt.unwrap_or(0);
    let creator = creator_level(state, created_by, org_unit).await?;
    let user_level = reviewer_level(state, org_unit, user_id).await?;

    // Reopen: only allowed on resolved incidents, and only by final reviewers/admins.
    // Check resolved_at on the incident itself — auto-resolution can leave the latest
    // review result as "submitted"/"approved" even though the incident is closed.
    if flags.is_reopening {
        if incident.resolved_at.is_none() {
            return Ok(false);
        }
        return is_user_final_reviewer(state, org_unit, user_id).await;
    }

    // Resubmitting a returned incident: original creator (or higher) may re-submit.
    if current_result == Some(ReviewResult::Returned) {
        if flags.is_returning {
            return Ok(false);
        }
        return Ok(user_level >= creator);
    }

    // Return/resolve/delete: must be at or above the current level.
    if flags.is_returning || flags.is_resolving || flags.is_deleting {
        return Ok(user_level >= level);
    }

    // Forward motion: blocked at the final level, otherwise check level + peer-review.
    if is_final_review_level(&state.db, org_unit, level).await? {
        return Ok(false);
    }

    check_review_permission(state, incident_id, org_unit, level, user_level, user_id).await
}

// ---------------------------------------------------------------------------
// Review history endpoint
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListReviewsRequest {
    pub incident: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewHistoryItem {
    pub id: i32,
    pub incident: i32,
    pub reviewed_by: Uuid,
    pub reviewer_name: String,
    /// Wire string matching the DB enum value (e.g. "submitted", "approved-with-edits").
    pub result: String,
    pub min_review_level: i32,
    pub comments: Option<String>,
    pub reviewed_at: chrono::DateTime<chrono::FixedOffset>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/incident/review/list",
    request_body = ListReviewsRequest,
    responses((
        status = 200,
        body = Vec<ReviewHistoryItem>,
        description = "Review history for an incident"
    )),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn list_reviews(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ListReviewsRequest>,
) -> ApiResult<Json<Vec<ReviewHistoryItem>>> {
    // Look up the incident's org_unit so we can scope the permission check.
    let incident = incidents::Entity::find_by_id(params.incident)
        .filter(incidents::Column::DeletedAt.is_null())
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found("incident"))?;

    state
        .auth_client
        .permission_required_uuid("current.review.read", Some(&incident.org_unit))
        .await?;

    let rows = incident_review::Entity::find()
        .filter(incident_review::Column::Incident.eq(params.incident))
        .order_by_asc(incident_review::Column::ReviewedAt)
        .all(&state.db)
        .await?;

    // Batch-resolve reviewer display names via odo-auth, one call per
    // distinct reviewer. Best-effort: missing names render as empty strings,
    // matching legacy behavior when the auth.usr join produced NULL.
    let reviewer_ids: HashSet<Uuid> = rows.iter().map(|r| r.reviewed_by).collect();
    let mut reviewer_names: HashMap<Uuid, String> = HashMap::with_capacity(reviewer_ids.len());
    for id in reviewer_ids {
        if let Ok(user) = state.auth_client.get_user_by_uuid(&id, true).await
            && let Some(name) = user["display_name"].as_str()
        {
            reviewer_names.insert(id, name.to_string());
        }
    }

    let items = rows
        .into_iter()
        .map(|r| ReviewHistoryItem {
            id: r.id,
            incident: r.incident,
            reviewed_by: r.reviewed_by,
            reviewer_name: reviewer_names
                .get(&r.reviewed_by)
                .cloned()
                .unwrap_or_default(),
            result: r.result,
            min_review_level: r.min_review_level,
            comments: r.comments,
            reviewed_at: r.reviewed_at,
        })
        .collect();

    Ok(Json(items))
}

// ---------------------------------------------------------------------------
// Pending reviews
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetPendingReviewsRequest {
    /// Org unit to scope the search (descendants included). Defaults to
    /// the root org unit when omitted (resolved via odo-org).
    #[serde(default)]
    pub org_unit: Option<Uuid>,
    /// Cursor from a prior call's response (`next_cursor`). Resumes
    /// the keyset-paged scan right after the last incident examined
    /// (not the last incident *returned*). Omit to start from the
    /// oldest open incident.
    #[serde(default)]
    pub cursor: Option<PendingReviewsCursor>,
    /// Cap on the number of visible rows returned in this page.
    /// Defaults to `DEFAULT_PAGE_LIMIT` and is clamped to `MAX_PAGE_LIMIT`.
    /// The inner DB scan may examine more rows than this — the cap
    /// only controls the visible-row count in the response.
    #[serde(default)]
    pub limit: Option<u64>,
}

/// Keyset cursor for `get_pending_reviews`. Pair `(created_at, id)`
/// uniquely orders the open-incident set under
/// `ORDER BY created_at ASC, id ASC` — perfect for stable pagination
/// without offsets.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct PendingReviewsCursor {
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub id: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PendingReviewsResponse {
    pub rows: Vec<PendingReviewRow>,
    /// Pass back unchanged on the next request to resume. `None` when
    /// the inner DB scan reached the end of the open-incident set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<PendingReviewsCursor>,
}

/// Default visible-row count per page when the caller doesn't specify.
const DEFAULT_PAGE_LIMIT: u64 = 100;
/// Hard cap on visible rows per page.
const MAX_PAGE_LIMIT: u64 = 500;
/// How many open incidents to pull from the DB per inner scan
/// iteration. The visibility filter is in Rust, so we may need
/// multiple inner scans to fill one visible page.
const DB_SCAN_CHUNK: u64 = 500;

#[derive(Debug, Serialize, ToSchema)]
pub struct PendingReviewRow {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub org_unit: Uuid,
    pub created_by: Uuid,
    pub created_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub occurred_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: Option<chrono::DateTime<chrono::FixedOffset>>,

    pub org_unit_name: Option<String>,
    pub created_by_name: Option<String>,
    pub created_by_username: Option<String>,

    pub current_review_level: i32,
    pub creator_level: i32,
    pub user_review_level: i32,
    pub is_creator: bool,
    pub can_review: bool,
    pub can_resubmit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_review_result: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/incident/pending-reviews",
    request_body = GetPendingReviewsRequest,
    responses((
        status = 200,
        body = PendingReviewsResponse,
        description = "Incidents pending review for the current user (paged)"
    )),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn get_pending_reviews(
    State(state): State<Arc<AppState>>,
    Json(params): Json<GetPendingReviewsRequest>,
) -> ApiResult<Json<PendingReviewsResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    // Mirror legacy: default to root org_unit when none provided.
    // Resolved via odo-org rather than hardcoded — the root ID is not
    // guaranteed to be 1.
    let org_unit = match params.org_unit {
        Some(id) => id,
        None => state.org_client.root_uuid().await?,
    };

    state
        .auth_client
        .permission_required_uuid("current.incident.read", Some(&org_unit))
        .await?;

    // Expand to descendants for the search scope.
    let scope = state.org_client.descendant_uuids(&org_unit).await?;
    if scope.is_empty() {
        return Ok(Json(PendingReviewsResponse {
            rows: Vec::new(),
            next_cursor: None,
        }));
    }

    let page_limit = params
        .limit
        .unwrap_or(DEFAULT_PAGE_LIMIT)
        .min(MAX_PAGE_LIMIT);

    // Pull rows in keyset-paged DB chunks; the visibility filter runs
    // in Rust so we may need multiple chunks to fill one visible page.
    //
    // Cursor placement matters: when the page limit is reached
    // mid-chunk, the cursor must advance to the *last visible row's*
    // position, NOT the last DB row examined. Advancing past the
    // chunk would silently skip the rows between the last visible
    // row and the chunk end. When a chunk is fully drained without
    // hitting the page limit, the cursor advances to the chunk's
    // last DB row so we don't re-examine already-filtered rows.
    let mut cursor = params.cursor.clone();
    let mut visible: Vec<PendingReviewRow> = Vec::with_capacity(page_limit as usize);
    let mut decorations = PageDecorations::default();

    loop {
        let chunk = fetch_pending_chunk(&state.db, &scope, cursor.as_ref(), DB_SCAN_CHUNK).await?;
        if chunk.is_empty() {
            // DB exhausted.
            cursor = None;
            break;
        }

        let chunk_was_full = chunk.len() as u64 == DB_SCAN_CHUNK;
        let last_in_chunk_cursor = PendingReviewsCursor {
            created_at: chunk
                .last()
                .expect("non-empty chunk")
                .created_at
                .unwrap_or_else(|| chunk.last().unwrap().occurred_at),
            id: chunk.last().unwrap().id,
        };

        decorations
            .extend(&state, &chunk, org_unit, user_id)
            .await?;

        let mut hit_page_limit = false;
        let mut last_visible_cursor: Option<PendingReviewsCursor> = None;
        for inc in chunk {
            if visible.len() as u64 >= page_limit {
                hit_page_limit = true;
                break;
            }
            let inc_cursor = PendingReviewsCursor {
                created_at: inc.created_at.unwrap_or(inc.occurred_at),
                id: inc.id,
            };
            if let Some(row) = build_pending_row(&decorations, &state, &inc, user_id).await? {
                visible.push(row);
                last_visible_cursor = Some(inc_cursor);
            }
        }

        if hit_page_limit {
            // Page is full. Anchor the cursor at the last visible row
            // so the next call resumes right after it and doesn't lose
            // the rows between here and the chunk end. `last_visible_cursor`
            // is Some(_) here — we couldn't have hit the page limit
            // without pushing at least one visible row in this chunk
            // (page_limit >= 1).
            cursor = last_visible_cursor;
            break;
        }

        if !chunk_was_full {
            // Partial chunk → DB exhausted. No more rows to scan.
            cursor = None;
            break;
        }

        // Chunk fully consumed without filling the page. Advance the
        // cursor past the last DB row so the next chunk picks up where
        // this one left off, skipping the rows we already filtered out.
        cursor = Some(last_in_chunk_cursor);
    }

    Ok(Json(PendingReviewsResponse {
        rows: visible,
        next_cursor: cursor,
    }))
}

/// Fetch the next chunk of candidate incidents from the DB. Keyset
/// pagination on `(created_at, id)` so chunks are stable under
/// concurrent inserts (no offset drift).
///
/// The `id IN (SELECT incident FROM incident_review)` subquery
/// ensures the chunk only contains incidents that have at least one
/// review row — matching the post-filter's `level >= 1 || is_returned`
/// precondition. See the longer note above the `get_pending_reviews`
/// handler about why this matters (level-0 noise used to dominate the
/// LIMIT window before this subquery was added).
async fn fetch_pending_chunk(
    db: &DatabaseConnection,
    scope: &[Uuid],
    cursor: Option<&PendingReviewsCursor>,
    limit: u64,
) -> LocalResult<Vec<crate::entity::incidents::Model>> {
    use crate::entity::incidents as inc_entity;
    use sea_orm::sea_query::Expr;

    let pending_subquery = incident_review::Entity::find()
        .select_only()
        .column(incident_review::Column::Incident)
        .distinct()
        .into_query();

    let mut q = inc_entity::Entity::find()
        .filter(inc_entity::Column::DeletedAt.is_null())
        .filter(inc_entity::Column::ResolvedAt.is_null())
        .filter(inc_entity::Column::OrgUnit.is_in(scope.iter().copied()))
        .filter(inc_entity::Column::Id.in_subquery(pending_subquery));

    if let Some(c) = cursor {
        // Keyset predicate: (created_at, id) > (cursor.created_at,
        // cursor.id). Postgres tuple-comparison semantics handle the
        // tiebreaker correctly on rows that share a `created_at`
        // timestamp (rare but possible during bulk imports).
        //
        // The values list mixes a timestamptz and an int4, so cast
        // both to sea_orm::Value explicitly — type inference can't
        // pick a homogeneous element type from a mixed-array literal.
        let bind: Vec<sea_orm::Value> = vec![
            sea_orm::Value::from(c.created_at),
            sea_orm::Value::from(c.id),
        ];
        q = q.filter(Expr::cust_with_values(
            "(\"incidents\".\"created_at\", \"incidents\".\"id\") > ($1, $2)",
            bind,
        ));
    }

    Ok(q.order_by_asc(inc_entity::Column::CreatedAt)
        .order_by_asc(inc_entity::Column::Id)
        .limit(limit)
        .all(db)
        .await?)
}

/// Per-page lookup caches for reviewer levels, creator levels, latest
/// reviews, creator display names, and org-unit labels. Built
/// incrementally across DB chunks so we don't re-fetch the same
/// org / user metadata when paging through.
#[derive(Default)]
struct PageDecorations {
    reviewer_levels: HashMap<Uuid, i32>,
    creator_levels: HashMap<Uuid, i32>,
    latest_reviews: HashMap<i32, (Option<i32>, Option<ReviewResult>)>,
    creator_info: HashMap<Uuid, (Option<String>, Option<String>)>,
    org_labels: HashMap<Uuid, String>,
    /// Org units and creators we've already resolved. Tracking these
    /// separately from the maps above lets us skip the per-row "do
    /// we already have it" check when extending across chunks.
    seen_orgs: HashSet<Uuid>,
    seen_creators: HashSet<Uuid>,
}

impl PageDecorations {
    /// Add lookups for any unseen orgs / creators / incidents in
    /// `chunk`. Idempotent: re-passing a chunk we've already seen is
    /// a no-op.
    async fn extend(
        &mut self,
        state: &Arc<AppState>,
        chunk: &[crate::entity::incidents::Model],
        org_unit_for_creator_scope: Uuid,
        user_id: Uuid,
    ) -> LocalResult<()> {
        // New orgs and creators in this chunk.
        let new_orgs: HashSet<Uuid> = chunk
            .iter()
            .map(|r| r.org_unit)
            .filter(|id| !self.seen_orgs.contains(id))
            .collect();
        let new_creators: HashSet<Uuid> = chunk
            .iter()
            .map(|r| r.created_by)
            .filter(|id| !self.seen_creators.contains(id))
            .collect();

        if !new_orgs.is_empty() {
            let levels = batch_reviewer_levels(state.as_ref(), &new_orgs, user_id).await?;
            self.reviewer_levels.extend(levels);
            for id in &new_orgs {
                if let Ok(detail) = state.org_client.get_unit_detail_by_uuid(id).await
                    && let Some(name) = detail
                        .get("org_unit")
                        .and_then(|u| u.get("label"))
                        .and_then(|v| v.as_str())
                {
                    self.org_labels.insert(*id, name.to_string());
                }
            }
            self.seen_orgs.extend(new_orgs);
        }

        if !new_creators.is_empty() {
            let levels =
                batch_creator_levels(state.as_ref(), &new_creators, org_unit_for_creator_scope)
                    .await?;
            self.creator_levels.extend(levels);
            for id in &new_creators {
                if let Ok(user) = state.auth_client.get_user_by_uuid(id, true).await {
                    let display_name = user["display_name"].as_str().map(|s| s.to_string());
                    let username = user["username"].as_str().map(|s| s.to_string());
                    self.creator_info.insert(*id, (display_name, username));
                }
            }
            self.seen_creators.extend(new_creators);
        }

        // Latest-review lookup is per-incident — always re-run for
        // the new chunk's incidents.
        let chunk_ids: Vec<i32> = chunk.iter().map(|r| r.id).collect();
        let latest = batch_latest_reviews(&state.db, &chunk_ids).await?;
        self.latest_reviews.extend(latest);

        Ok(())
    }
}

/// Decide whether an incident is visible to the current user and, if
/// so, materialize the response row. Returns `None` when the
/// visibility filter drops the incident (caller skips it).
async fn build_pending_row(
    deco: &PageDecorations,
    state: &Arc<AppState>,
    inc: &crate::entity::incidents::Model,
    user_id: Uuid,
) -> LocalResult<Option<PendingReviewRow>> {
    let user_review_level = deco
        .reviewer_levels
        .get(&inc.org_unit)
        .copied()
        .unwrap_or(0);
    let creator_level = deco
        .creator_levels
        .get(&inc.created_by)
        .copied()
        .unwrap_or(0);
    let (current_level_opt, current_result) = deco
        .latest_reviews
        .get(&inc.id)
        .cloned()
        .unwrap_or((None, None));
    let level = current_level_opt.unwrap_or(0);

    let is_creator = inc.created_by == user_id;
    let is_returned = current_result == Some(ReviewResult::Returned);
    let is_same_level_peer = user_review_level == creator_level && creator_level > 0 && !is_creator;
    let can_resubmit = is_returned && (is_creator || is_same_level_peer);

    let can_review = if is_creator || can_resubmit || is_returned {
        false
    } else {
        check_review_permission(
            state.as_ref(),
            inc.id,
            inc.org_unit,
            level,
            user_review_level,
            user_id,
        )
        .await?
    };

    let can_see = can_review || is_creator || can_resubmit;
    if !(can_see && (level >= 1 || is_returned)) {
        return Ok(None);
    }

    let (created_by_name, created_by_username) = deco
        .creator_info
        .get(&inc.created_by)
        .cloned()
        .unwrap_or((None, None));

    Ok(Some(PendingReviewRow {
        id: inc.id,
        title: inc.title.clone(),
        description: inc.description.clone(),
        org_unit: inc.org_unit,
        created_by: inc.created_by,
        created_at: inc.created_at,
        occurred_at: inc.occurred_at,
        updated_at: inc.updated_at,
        org_unit_name: deco.org_labels.get(&inc.org_unit).cloned(),
        created_by_name,
        created_by_username,
        current_review_level: level,
        creator_level,
        user_review_level,
        is_creator,
        can_review,
        can_resubmit,
        latest_review_result: current_result.map(|r| r.as_str().to_string()),
    }))
}

// ---------------------------------------------------------------------------
// Batch helpers for pending_reviews
// ---------------------------------------------------------------------------

/// Caller's reviewer level for each org unit in the set.
/// One odo-auth call (incident-admin check) plus two DB queries (max levels
/// and the caller's chain assignments).
async fn batch_reviewer_levels(
    state: &AppState,
    org_units: &HashSet<Uuid>,
    user_id: Uuid,
) -> LocalResult<HashMap<Uuid, i32>> {
    let mut out = HashMap::new();
    if org_units.is_empty() {
        return Ok(out);
    }

    let ids: Vec<Uuid> = org_units.iter().copied().collect();

    // Does the caller hold incident-admin anywhere? Drives the
    // "no explicit chain entry but is admin → max+1" fallback.
    let is_admin = state
        .auth_client
        .user_has_role(INCIDENT_ADMIN_ROLE, None)
        .await?;

    // Max review_level per org unit (one query, group by org_unit).
    let mut max_levels: HashMap<Uuid, i32> = HashMap::new();
    if is_admin {
        // Only needed for the admin fallback path.
        let rows = review_chain::Entity::find()
            .filter(review_chain::Column::OrgUnit.is_in(ids.clone()))
            .all(&state.db)
            .await?;
        for r in rows {
            max_levels
                .entry(r.org_unit)
                .and_modify(|m| *m = (*m).max(r.review_level))
                .or_insert(r.review_level);
        }
    }

    // Caller's own chain assignments via review_group_member.
    let assignments = review_chain::Entity::find()
        .inner_join(review_group::Entity)
        .join(
            sea_orm::JoinType::InnerJoin,
            review_group::Relation::ReviewGroupMember.def(),
        )
        .filter(review_chain::Column::OrgUnit.is_in(ids.clone()))
        .filter(review_group_member::Column::Usr.eq(user_id))
        .all(&state.db)
        .await?;

    for chain in assignments {
        out.entry(chain.org_unit)
            .and_modify(|level| *level = (*level).max(chain.review_level))
            .or_insert(chain.review_level);
    }

    // Fill in any org units the caller has no chain entry for.
    for id in org_units {
        out.entry(*id).or_insert_with(|| {
            if is_admin {
                max_levels.get(id).copied().unwrap_or(0) + 1
            } else {
                0
            }
        });
    }

    Ok(out)
}

/// Creator level for each user at the given org unit.
///
/// Three classes of result:
///   1. User is in the chain via a review group → that level (highest wins
///      if they belong to multiple groups).
///   2. User holds `incident-admin` at the org unit → `max_level + 1`,
///      placing them implicitly above every reviewer.
///   3. Neither → 0 (regular staff).
///
/// All role/membership data is fetched in a fixed number of round-trips
/// regardless of how many creators are in the set.
async fn batch_creator_levels(
    state: &AppState,
    creators: &HashSet<Uuid>,
    org_unit: Uuid,
) -> LocalResult<HashMap<Uuid, i32>> {
    let mut out = HashMap::new();
    if creators.is_empty() {
        return Ok(out);
    }

    let ids: Vec<Uuid> = creators.iter().copied().collect();

    // (1) Chain membership: pull every chain entry at this org unit whose
    // reviewer_group has any of our creators as a member. SeaORM's join
    // gives us back review_chain rows; we then re-join to membership
    // rows in a second query to recover which creator → which group.
    let assignments = review_chain::Entity::find()
        .inner_join(review_group::Entity)
        .join(
            sea_orm::JoinType::InnerJoin,
            review_group::Relation::ReviewGroupMember.def(),
        )
        .filter(review_chain::Column::OrgUnit.eq(org_unit))
        .filter(review_group_member::Column::Usr.is_in(ids.clone()))
        .all(&state.db)
        .await?;

    if !assignments.is_empty() {
        let group_ids: Vec<i32> = assignments.iter().map(|c| c.reviewer_group).collect();
        let members = review_group_member::Entity::find()
            .filter(review_group_member::Column::ReviewGroup.is_in(group_ids))
            .filter(review_group_member::Column::Usr.is_in(ids.clone()))
            .all(&state.db)
            .await?;

        let mut group_levels: HashMap<i32, i32> = HashMap::new();
        for chain in &assignments {
            group_levels
                .entry(chain.reviewer_group)
                .and_modify(|l| *l = (*l).max(chain.review_level))
                .or_insert(chain.review_level);
        }

        for m in members {
            if let Some(level) = group_levels.get(&m.review_group) {
                out.entry(m.usr)
                    .and_modify(|l| *l = (*l).max(*level))
                    .or_insert(*level);
            }
        }
    }

    // (2) Bulk admin check via odo-auth — one round-trip for the whole
    // creator set. Filtered to creators not already placed in the chain
    // since chain placement wins over the admin bump.
    let unplaced: Vec<Uuid> = ids
        .iter()
        .copied()
        .filter(|id| !out.contains_key(id))
        .collect();
    if !unplaced.is_empty() {
        let admins = state
            .auth_client
            .users_with_role_uuids(INCIDENT_ADMIN_ROLE, &unplaced, Some(&org_unit))
            .await?;

        if !admins.is_empty() {
            let max = max_review_level(&state.db, org_unit).await?;
            for id in admins {
                out.insert(id, max + 1);
            }
        }
    }

    // (3) Remaining creators are staff (level 0).
    for id in creators {
        out.entry(*id).or_insert(0);
    }

    Ok(out)
}

/// Latest review row (min_review_level, result) for each incident in the set.
async fn batch_latest_reviews(
    db: &DatabaseConnection,
    incident_ids: &[i32],
) -> LocalResult<HashMap<i32, (Option<i32>, Option<ReviewResult>)>> {
    let mut out = HashMap::new();
    if incident_ids.is_empty() {
        return Ok(out);
    }

    // Pull all reviews for the set, newest first. First row seen per
    // incident wins (it's the latest).
    let rows = incident_review::Entity::find()
        .filter(incident_review::Column::Incident.is_in(incident_ids.iter().copied()))
        .order_by_desc(incident_review::Column::ReviewedAt)
        .all(db)
        .await?;

    for r in rows {
        let result = ReviewResult::try_from_str(&r.result)?;
        out.entry(r.incident)
            .or_insert((Some(r.min_review_level), Some(result)));
    }

    Ok(out)
}

// ===========================================================================
// Create incident review
// ===========================================================================
//
// Records a review action against an incident and updates the incident's
// resolved/deleted timestamps where appropriate. Auto-resolution path:
// when the final reviewer takes a progressing action (submit/approve), a
// second `resolved` review row is also recorded so the resolution is
// visible in review history.
//
// Notifications: after commit, we fan out to the next-level reviewers
// (or back to the creator when level drops to 0) via odo-notify's
// /enqueue endpoint. Skipped for final/auto-resolved reviews and when
// the level didn't actually change. See `send_review_notifications`.

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateReviewRequest {
    pub incident: i32,
    /// Wire-format string: "submitted" | "approved" | "approved-with-edits"
    /// | "returned" | "deleted" | "resolved" | "reopened".
    pub result: String,
    #[serde(default)]
    pub comments: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateReviewResponse {
    /// ID of the primary review row that was just inserted. Auto-
    /// resolution may also have inserted a second `resolved` row; its ID
    /// is in `auto_resolved_review_id` when present.
    pub id: i32,
    pub incident: i32,
    pub reviewed_by: Uuid,
    pub reviewed_at: chrono::DateTime<chrono::FixedOffset>,
    /// Wire-format string of the recorded review result.
    pub result: String,
    pub min_review_level: i32,
    pub comments: Option<String>,

    /// True when this action implicitly resolved the incident because
    /// the actor was the final reviewer and the action was a progressing
    /// one (submit/approve/approve-with-edits).
    pub was_auto_resolved: bool,

    /// ID of the synthetic `resolved` review row written by the
    /// auto-resolution path, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_resolved_review_id: Option<i32>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/incident/review/create",
    request_body = CreateReviewRequest,
    responses((
        status = 200,
        body = CreateReviewResponse,
        description = "Recorded review with computed level and any auto-resolution side effects"
    )),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn create_incident_review(
    State(state): State<Arc<AppState>>,
    Json(params): Json<CreateReviewRequest>,
) -> ApiResult<Json<CreateReviewResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    let review_result = ReviewResult::try_from_str(&params.result)?;

    // Load the incident outside the transaction so we have its org_unit
    // for permission/level lookups.
    let incident = incidents::Entity::find_by_id(params.incident)
        .filter(incidents::Column::DeletedAt.is_null())
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("incident {}", params.incident)))?;
    let org_unit = incident.org_unit;

    // Permission gate: scope-aware "can this user act on this incident
    // with this result?" check using the same logic the read-side
    // `can_review` decoration uses.
    let flags = ReviewActionFlags {
        is_returning: review_result.is_returning(),
        is_reopening: review_result.is_reopening(),
        is_resolving: review_result.is_resolving(),
        is_deleting: review_result.is_deleting(),
    };
    if !user_can_review(&state, &incident, user_id, flags).await? {
        return Err(LocalError::permission_denied("current.review", None).into());
    }

    let (prev_level, next_level) =
        calculate_review_level(&state, params.incident, &review_result, org_unit, user_id).await?;

    tracing::info!(
        incident = params.incident,
        result = %params.result,
        prev_level,
        next_level,
        "CreateIncidentReview"
    );

    // Compute auto-resolution before the transaction so the closure
    // doesn't need to make additional auth calls.
    let was_auto_resolved =
        is_user_final_reviewer(&state, org_unit, user_id).await? && review_result.is_progressing();

    let txn = state.db.begin().await?;

    // 1. Primary review row.
    let review_model = incident_review::ActiveModel {
        incident: Set(params.incident),
        reviewed_by: Set(user_id),
        result: Set(review_result.as_str().to_string()),
        min_review_level: Set(next_level),
        comments: Set(params.comments.clone()),
        ..Default::default()
    };
    let inserted_review = review_model.insert(&txn).await?;

    // 2. Update incident resolved/deleted state based on result.
    apply_incident_state_change(
        &txn,
        params.incident,
        &review_result,
        was_auto_resolved,
        user_id,
    )
    .await?;

    // 3. Activity log for the primary review action.
    log_review_activity(
        &txn,
        params.incident,
        org_unit,
        user_id,
        &review_result,
        params.comments.as_deref(),
    )
    .await?;

    // 4. Auto-resolution: second review row + activity entry.
    let auto_resolved_review_id = if was_auto_resolved {
        let auto_row = incident_review::ActiveModel {
            incident: Set(params.incident),
            reviewed_by: Set(user_id),
            result: Set(ReviewResult::Resolved.as_str().to_string()),
            min_review_level: Set(next_level),
            comments: Set(Some(format!(
                "Auto-resolved: {} by final reviewer",
                review_result.as_str()
            ))),
            ..Default::default()
        };
        let inserted_auto = auto_row.insert(&txn).await?;

        let auto_log = activity_log::ActiveModel {
            event_type: Set("incident.review.resolved".to_string()),
            actor_id: Set(user_id),
            org_unit: Set(Some(org_unit)),
            incident_id: Set(Some(params.incident)),
            event_data: Set(serde_json::json!({"auto_resolved": true})),
            ..Default::default()
        };
        auto_log.insert(&txn).await?;

        Some(inserted_auto.id)
    } else {
        None
    };

    txn.commit().await?;

    // Notification fan-out (post-commit, best-effort). Skipped for
    // final/auto-resolved reviews and when the level didn't actually
    // change — same legacy gating.
    let needs_notify = !review_result.is_final() && !was_auto_resolved && prev_level != next_level;
    if needs_notify
        && let Err(e) = send_review_notifications(
            &state,
            &incident,
            next_level,
            user_id,
            inserted_review.id,
            &review_result,
        )
        .await
    {
        // A notification failure shouldn't roll back the already-
        // committed review. Log and move on.
        tracing::error!(
            incident_id = params.incident,
            review_id = inserted_review.id,
            error = %e,
            "review notification fan-out failed"
        );
    }

    Ok(Json(CreateReviewResponse {
        id: inserted_review.id,
        incident: inserted_review.incident,
        reviewed_by: inserted_review.reviewed_by,
        reviewed_at: inserted_review.reviewed_at,
        result: review_result.as_str().to_string(),
        min_review_level: inserted_review.min_review_level,
        comments: inserted_review.comments,
        was_auto_resolved,
        auto_resolved_review_id,
    }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Update the incident row's `resolved_at` / `resolved_by` / `deleted_at`
/// timestamps based on the review result.
async fn apply_incident_state_change<C: ConnectionTrait>(
    txn: &C,
    incident_id: i32,
    result: &ReviewResult,
    was_auto_resolved: bool,
    user_id: Uuid,
) -> LocalResult<()> {
    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
    let mut model = incidents::ActiveModel {
        id: Set(incident_id),
        ..Default::default()
    };

    if matches!(result, ReviewResult::Deleted) {
        model.deleted_at = Set(Some(now));
    } else if matches!(result, ReviewResult::Resolved) || was_auto_resolved {
        model.resolved_at = Set(Some(now));
        model.resolved_by = Set(Some(user_id));
    } else if result.is_reopening() {
        model.resolved_at = Set(None);
        model.resolved_by = Set(None);
    } else {
        // No state change for plain submit/approve/return.
        return Ok(());
    }

    incidents::Entity::update(model).exec(txn).await?;
    Ok(())
}

/// Insert the activity_log row for a review action. event_type is
/// `incident.review.{result_string}` to match legacy.
async fn log_review_activity<C: ConnectionTrait>(
    txn: &C,
    incident_id: i32,
    org_unit: Uuid,
    user_id: Uuid,
    result: &ReviewResult,
    comments: Option<&str>,
) -> LocalResult<()> {
    let row = activity_log::ActiveModel {
        event_type: Set(format!("incident.review.{}", result.as_str())),
        actor_id: Set(user_id),
        org_unit: Set(Some(org_unit)),
        incident_id: Set(Some(incident_id)),
        event_data: Set(serde_json::json!({"comments": comments})),
        ..Default::default()
    };
    row.insert(txn).await?;
    Ok(())
}

/// Notify the users responsible for the next review step. Fired post-
/// commit; called only when [`create_incident_review`]'s gating returns
/// `needs_notify = true` (not a final review, not auto-resolved, and
/// the review level actually advanced).
///
/// One enqueue call per target user — odo-notify handles de-duplication
/// via the `dedup_key`. Failures fan out to a warning log per recipient
/// rather than short-circuiting; one unreachable target shouldn't
/// silence the rest.
async fn send_review_notifications(
    state: &AppState,
    incident: &incidents::Model,
    next_level: i32,
    source_user: Uuid,
    source_review: i32,
    result: &ReviewResult,
) -> LocalResult<()> {
    let org_unit = incident.org_unit;
    let incident_id = incident.id;
    let incident_creator = incident.created_by;

    // Who to notify: either the creator (when level resets to 0) or the
    // reviewers at the next chain level. Self-notifications are filtered.
    let mut target_ids = if next_level == 0 {
        vec![incident_creator]
    } else {
        find_reviewers_for_review_level(&state.db, org_unit, next_level).await?
    };
    target_ids.retain(|&id| id != source_user);

    if target_ids.is_empty() {
        tracing::warn!(
            incident_id,
            %org_unit,
            next_level,
            "no users to notify for review at next_level"
        );
        return Ok(());
    }

    // Build the shared template variables. Each lookup is best-effort:
    // failures degrade the template-variable content but don't block the
    // notification from being sent.
    let (org_label, org_timezone) = fetch_org_label_and_timezone(state, org_unit).await;
    let template_type = fetch_incident_template_names(&state.db, incident_id).await;
    let source_user_name = state
        .auth_client
        .get_user_by_uuid(&source_user, true)
        .await
        .ok()
        .and_then(|u| u["display_name"].as_str().map(|s| s.to_string()))
        .unwrap_or_default();

    let incident_url = format!("{}/incidents/{incident_id}", state.public_url);
    let action_url = format!("/incidents/{incident_id}");
    let occurred_at = incident.occurred_at.to_rfc3339();

    let template_variables = serde_json::json!({
        "source_user_name": source_user_name,
        "incident_id": incident_id,
        "incident_type": template_type,
        "incident_location": org_label,
        "incident_occurred_at": occurred_at,
        "incident_timezone": org_timezone.unwrap_or_else(|| "America/Los_Angeles".to_string()),
        "incident_url": incident_url,
        "action_url": action_url,
    });

    let template_code = if result.is_returning() {
        "incident-review-returned"
    } else if result.is_reopening() {
        "incident-review-reopened"
    } else {
        // submit / approve / approve-with-edits — "you have something to look at"
        "incident-review-pending"
    };

    for target_user in target_ids {
        let payload = serde_json::json!({
            "recipients": [{
                "type": "user",
                "user_id": target_user,
                "channels": ["in_app", "email"],
            }],
            "template_code": template_code,
            "template_variables": template_variables,
            "source_service": "current",
            "source_entity_type": "incident",
            "source_entity_id": incident_id,
            "dedup_key": format!("incident-review:{incident_id}:{source_review}:{target_user}"),
        });

        if let Err(e) = state
            .notify_client
            .post::<serde_json::Value, _>("/api/v1/odo/notify/enqueue", &payload)
            .await
        {
            tracing::warn!(
                incident_id,
                %target_user,
                error = %e,
                "review notification enqueue failed"
            );
        }
    }

    Ok(())
}

/// User IDs of every member of every review group assigned to the given
/// review_level for an org_unit. Mirrors the legacy
/// `find_reviewers_for_review_level`.
async fn find_reviewers_for_review_level(
    db: &DatabaseConnection,
    org_unit: Uuid,
    review_level: i32,
) -> LocalResult<Vec<Uuid>> {
    // Two-step rather than one chained join: find the reviewer_groups
    // at this level, then list members of those groups.
    let chain_rows = review_chain::Entity::find()
        .filter(review_chain::Column::OrgUnit.eq(org_unit))
        .filter(review_chain::Column::ReviewLevel.eq(review_level))
        .all(db)
        .await?;

    if chain_rows.is_empty() {
        return Ok(Vec::new());
    }

    let group_ids: Vec<i32> = chain_rows.iter().map(|c| c.reviewer_group).collect();
    let members = review_group_member::Entity::find()
        .filter(review_group_member::Column::ReviewGroup.is_in(group_ids))
        .all(db)
        .await?;

    let mut ids: Vec<Uuid> = members.into_iter().map(|m| m.usr).collect();
    // Distinct: a user could be in multiple groups at the same level.
    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}

/// Best-effort (label, timezone) lookup via odo-org. Returns None for
/// either field if the org call fails or the response is missing it.
pub(crate) async fn fetch_org_label_and_timezone(
    state: &AppState,
    org_unit: Uuid,
) -> (Option<String>, Option<String>) {
    let Ok(detail) = state.org_client.get_unit_detail_by_uuid(&org_unit).await else {
        return (None, None);
    };
    let unit = detail.get("org_unit");
    let label = unit
        .and_then(|u| u.get("label"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let tz = unit
        .and_then(|u| u.get("timezone"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    (label, tz)
}

/// Comma-separated template names for the incident, used as the
/// "incident_type" template variable. Empty string if none.
pub(crate) async fn fetch_incident_template_names(
    db: &DatabaseConnection,
    incident_id: i32,
) -> String {
    use crate::entity::{incident_template_map, templates};

    let map_rows = incident_template_map::Entity::find()
        .filter(incident_template_map::Column::Incident.eq(incident_id))
        .all(db)
        .await
        .unwrap_or_default();
    if map_rows.is_empty() {
        return String::new();
    }

    let template_ids: Vec<i32> = map_rows.iter().map(|m| m.template).collect();
    let template_rows = templates::Entity::find()
        .filter(templates::Column::Id.is_in(template_ids))
        .all(db)
        .await
        .unwrap_or_default();

    template_rows
        .into_iter()
        .map(|t| t.name)
        .collect::<Vec<_>>()
        .join(",")
}
