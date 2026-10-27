use axum::Json;
use axum::extract::State;
use odo_client::context::RequestContext;
use odo_client::error::{ApiResult, LocalError, LocalResult};
use sea_orm::prelude::*;
use sea_orm::{QueryOrder, Set};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::{categories, templates};

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListTemplatesRequest {
    #[serde(default)]
    pub id: Option<i32>,
    #[serde(default)]
    pub is_active: Option<bool>,
    #[serde(default)]
    pub category: Option<Vec<String>>,
    /// Also return soft-deleted templates; requires
    /// `current.incident_template.read`.
    #[serde(default)]
    pub include_deleted: bool,
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
    pub deleted_at: Option<chrono::DateTime<chrono::FixedOffset>>,
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
            deleted_at: m.deleted_at,
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

    let mut query = templates::Entity::find().order_by_asc(templates::Column::Name);

    if params.include_deleted {
        state
            .auth_client
            .permission_required_uuid("current.incident_template.read", None)
            .await?;
    } else {
        query = query.filter(templates::Column::DeletedAt.is_null());
    }

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

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveTemplateFields {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub category: String,
    #[serde(default = "empty_fields")]
    #[schema(value_type = Vec<Object>)]
    pub fields: serde_json::Value,
    #[serde(default = "default_true")]
    pub is_active: bool,
    #[serde(default = "default_true")]
    pub requires_patron: bool,
    #[serde(default = "default_true")]
    pub show_called_emergency: bool,
}

fn empty_fields() -> serde_json::Value {
    serde_json::json!([])
}

fn default_true() -> bool {
    true
}

impl SaveTemplateFields {
    /// Trim and check the caller-supplied values against what the table
    /// accepts, so bad input is a 400 rather than a database error.
    async fn validate<C: sea_orm::ConnectionTrait>(mut self, db: &C) -> LocalResult<Self> {
        self.name = self.name.trim().to_string();
        if self.name.is_empty() {
            return Err(LocalError::invalid_input("Template name is required"));
        }
        if self.name.chars().count() > 255 {
            return Err(LocalError::invalid_input(
                "Template name must be at most 255 characters",
            ));
        }
        self.description = self
            .description
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty());
        if !self.fields.is_array() {
            return Err(LocalError::invalid_input(
                "Template fields must be an array",
            ));
        }
        if categories::Entity::find_by_id(self.category.clone())
            .one(db)
            .await?
            .is_none()
        {
            return Err(LocalError::invalid_input(format!(
                "Unknown template category: {}",
                self.category
            )));
        }
        Ok(self)
    }
}

pub type CreateTemplateRequest = SaveTemplateFields;

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTemplateRequest {
    pub id: i32,
    #[serde(flatten)]
    pub template: SaveTemplateFields,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteTemplateRequest {
    pub id: i32,
}

async fn find_live_template<C: sea_orm::ConnectionTrait>(
    db: &C,
    id: i32,
) -> LocalResult<templates::Model> {
    templates::Entity::find_by_id(id)
        .filter(templates::Column::DeletedAt.is_null())
        .one(db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("template {id}")))
}

#[utoipa::path(
    post,
    path = "/api/v1/current/template/create",
    request_body = SaveTemplateFields,
    responses((status = 200, body = TemplateResponse, description = "Created template")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn create_template(
    State(state): State<Arc<AppState>>,
    Json(params): Json<CreateTemplateRequest>,
) -> ApiResult<Json<TemplateResponse>> {
    let user_id = RequestContext::user_uuid().ok_or(LocalError::unauthenticated())?;

    state
        .auth_client
        .permission_required_uuid("current.incident_template.write", None)
        .await?;

    let t = params.validate(&state.db).await?;

    let row = templates::ActiveModel {
        name: Set(t.name),
        description: Set(t.description),
        category: Set(t.category),
        fields: Set(t.fields),
        is_active: Set(Some(t.is_active)),
        version: Set(Some(1)),
        requires_patron: Set(t.requires_patron),
        show_called_emergency: Set(t.show_called_emergency),
        created_by: Set(Some(user_id)),
        ..Default::default()
    }
    .insert(&state.db)
    .await?;

    tracing::info!(template_id = row.id, "CreateTemplate");
    Ok(Json(row.into()))
}

/// Replace a template's editable values. `version` is bumped whenever
/// `fields` changes, so it tracks revisions of the form definition.
#[utoipa::path(
    post,
    path = "/api/v1/current/template/update",
    request_body = UpdateTemplateRequest,
    responses((status = 200, body = TemplateResponse, description = "Updated template")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn update_template(
    State(state): State<Arc<AppState>>,
    Json(params): Json<UpdateTemplateRequest>,
) -> ApiResult<Json<TemplateResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident_template.write", None)
        .await?;

    let existing = find_live_template(&state.db, params.id).await?;
    let t = params.template.validate(&state.db).await?;

    let fields_changed = existing.fields != t.fields;
    let version = existing.version.unwrap_or(1);

    let mut active: templates::ActiveModel = existing.into();
    active.name = Set(t.name);
    active.description = Set(t.description);
    active.category = Set(t.category);
    active.fields = Set(t.fields);
    active.is_active = Set(Some(t.is_active));
    active.requires_patron = Set(t.requires_patron);
    active.show_called_emergency = Set(t.show_called_emergency);
    if fields_changed {
        active.version = Set(Some(version + 1));
    }
    let row = active.update(&state.db).await?;

    tracing::info!(template_id = row.id, "UpdateTemplate");
    Ok(Json(row.into()))
}

/// Soft-delete a template. Incidents already filed against it keep their
/// mapping; the template just stops being offered.
#[utoipa::path(
    post,
    path = "/api/v1/current/template/delete",
    request_body = DeleteTemplateRequest,
    responses((status = 200, body = TemplateResponse, description = "Deleted template")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn delete_template(
    State(state): State<Arc<AppState>>,
    Json(params): Json<DeleteTemplateRequest>,
) -> ApiResult<Json<TemplateResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident_template.write", None)
        .await?;

    let existing = find_live_template(&state.db, params.id).await?;

    let mut active: templates::ActiveModel = existing.into();
    active.deleted_at = Set(Some(chrono::Utc::now().fixed_offset()));
    let row = active.update(&state.db).await?;

    tracing::info!(template_id = row.id, "DeleteTemplate");
    Ok(Json(row.into()))
}
