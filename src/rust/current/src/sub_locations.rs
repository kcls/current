use axum::Json;
use axum::extract::State;
use odo_client::error::ApiResult;
use sea_orm::QueryOrder;
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::sub_locations;

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListSubLocationsRequest {
    pub org_unit: Option<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SubLocationResponse {
    pub id: i32,
    pub org_unit: Uuid,
    pub label: String,
    pub description: Option<String>,
    pub code: Option<String>,
}

impl From<sub_locations::Model> for SubLocationResponse {
    fn from(m: sub_locations::Model) -> Self {
        Self {
            id: m.id,
            org_unit: m.org_unit,
            label: m.label,
            description: m.description,
            code: m.code,
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/current/sub-location/list",
    request_body = ListSubLocationsRequest,
    responses((
        status = 200,
        body = Vec<SubLocationResponse>,
        description = "Sub-locations for the org unit and its ancestors"
    )),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn list_sub_locations(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ListSubLocationsRequest>,
) -> ApiResult<Json<Vec<SubLocationResponse>>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    let mut query = sub_locations::Entity::find()
        .filter(sub_locations::Column::DeletedAt.is_null())
        .order_by_asc(sub_locations::Column::Label);

    if let Some(org_id) = params.org_unit {
        let ancestor_ids = state.org_client.ancestor_uuids(&org_id).await?;
        query = query.filter(sub_locations::Column::OrgUnit.is_in(ancestor_ids));
    }

    let results = query
        .all(&state.db)
        .await?
        .into_iter()
        .map(SubLocationResponse::from)
        .collect();

    Ok(Json(results))
}
