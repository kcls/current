use axum::Json;
use axum::extract::State;
use odo_client::error::ApiResult;
use sea_orm::QueryOrder;
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::templates;

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListTemplatesRequest {
    #[serde(default)]
    pub id: Option<i32>,
    #[serde(default)]
    pub is_active: Option<bool>,
    #[serde(default)]
    pub category: Option<Vec<String>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TemplateResponse {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub fields: serde_json::Value,
    pub is_active: Option<bool>,
    pub version: Option<i32>,
    pub requires_patron: bool,
    pub show_called_emergency: bool,
    pub created_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub updated_at: Option<chrono::DateTime<chrono::FixedOffset>>,
}

impl From<templates::Model> for TemplateResponse {
    fn from(m: templates::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            description: m.description,
            category: m.category,
            fields: m.fields,
            is_active: m.is_active,
            version: m.version,
            requires_patron: m.requires_patron,
            show_called_emergency: m.show_called_emergency,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/current/template/list",
    request_body = ListTemplatesRequest,
    responses((status = 200, body = Vec<TemplateResponse>, description = "Incident templates")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn list_templates(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ListTemplatesRequest>,
) -> ApiResult<Json<Vec<TemplateResponse>>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", None)
        .await?;

    let mut query = templates::Entity::find()
        .filter(templates::Column::DeletedAt.is_null())
        .order_by_asc(templates::Column::Name);

    if let Some(id) = params.id {
        query = query.filter(templates::Column::Id.eq(id));
    }

    if let Some(is_active) = params.is_active {
        query = query.filter(templates::Column::IsActive.eq(is_active));
    }

    if let Some(ref cats) = params.category
        && !cats.is_empty()
    {
        query = query.filter(templates::Column::Category.is_in(cats.clone()));
    }

    let rows: Vec<templates::Model> = query.all(&state.db).await?;
    let results = rows.into_iter().map(TemplateResponse::from).collect();

    Ok(Json(results))
}
