use axum::Json;
use axum::extract::State;
use odo_client::error::{ApiResult, LocalError, LocalResult};
use sea_orm::prelude::*;
use sea_orm::{QueryOrder, Set};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::categories;

// Categories have no soft-delete column and templates reference them by
// code, so there is no delete endpoint: retire a category with
// `is_active: false`.

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListCategoriesRequest {
    #[serde(default)]
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CategoryResponse {
    pub code: String,
    pub label: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub display_order: Option<i32>,
    pub is_active: Option<bool>,
    pub created_at: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub updated_at: Option<chrono::DateTime<chrono::FixedOffset>>,
}

impl From<categories::Model> for CategoryResponse {
    fn from(m: categories::Model) -> Self {
        Self {
            code: m.code,
            label: m.label,
            description: m.description,
            icon: m.icon,
            display_order: m.display_order,
            is_active: m.is_active,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/current/category/list",
    request_body = ListCategoriesRequest,
    responses((status = 200, body = Vec<CategoryResponse>, description = "Incident template categories")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn list_categories(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ListCategoriesRequest>,
) -> ApiResult<Json<Vec<CategoryResponse>>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", None)
        .await?;

    let mut query = categories::Entity::find()
        .order_by_asc(categories::Column::DisplayOrder)
        .order_by_asc(categories::Column::Label);

    if let Some(is_active) = params.is_active {
        query = query.filter(categories::Column::IsActive.eq(is_active));
    }

    let results = query
        .all(&state.db)
        .await?
        .into_iter()
        .map(CategoryResponse::from)
        .collect();

    Ok(Json(results))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveCategoryRequest {
    /// Natural key; set on create and fixed afterwards
    pub code: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub display_order: i32,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

impl SaveCategoryRequest {
    /// Trim and check values against the column limits so bad input is a
    /// 400 rather than a database error.
    fn validate(mut self) -> LocalResult<Self> {
        self.label = self.label.trim().to_string();
        if self.label.is_empty() {
            return Err(LocalError::invalid_input("Category label is required"));
        }
        if self.label.chars().count() > 100 {
            return Err(LocalError::invalid_input(
                "Category label must be at most 100 characters",
            ));
        }
        self.description = trimmed(self.description);
        self.icon = trimmed(self.icon);
        if self.icon.as_ref().is_some_and(|i| i.chars().count() > 10) {
            return Err(LocalError::invalid_input(
                "Category icon must be at most 10 characters",
            ));
        }
        Ok(self)
    }
}

/// Codes are stored and compared verbatim, so keep them to a plain
/// identifier form.
fn validate_code(code: &str) -> LocalResult<()> {
    let valid = !code.is_empty()
        && code.len() <= 50
        && code
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if valid {
        Ok(())
    } else {
        Err(LocalError::invalid_input(
            "Category code must be 1-50 characters of a-z, 0-9 and _",
        ))
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/current/category/create",
    request_body = SaveCategoryRequest,
    responses((status = 200, body = CategoryResponse, description = "Created category")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn create_category(
    State(state): State<Arc<AppState>>,
    Json(params): Json<SaveCategoryRequest>,
) -> ApiResult<Json<CategoryResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident_template.write", None)
        .await?;

    validate_code(&params.code)?;
    let c = params.validate()?;

    if categories::Entity::find_by_id(c.code.clone())
        .one(&state.db)
        .await?
        .is_some()
    {
        return Err(LocalError::conflict(
            "CATEGORY_CODE_TAKEN",
            Some("code"),
            format!("Category {} already exists", c.code),
        )
        .into());
    }

    let row = categories::ActiveModel {
        code: Set(c.code),
        label: Set(c.label),
        description: Set(c.description),
        icon: Set(c.icon),
        display_order: Set(Some(c.display_order)),
        is_active: Set(Some(c.is_active)),
        ..Default::default()
    }
    .insert(&state.db)
    .await?;

    tracing::info!(code = row.code, "CreateCategory");
    Ok(Json(row.into()))
}

/// Replace a category's values; `code` selects the row and cannot change.
#[utoipa::path(
    post,
    path = "/api/v1/current/category/update",
    request_body = SaveCategoryRequest,
    responses((status = 200, body = CategoryResponse, description = "Updated category")),
    security(("bearer" = [])),
    tag = "incidents"
)]
pub async fn update_category(
    State(state): State<Arc<AppState>>,
    Json(params): Json<SaveCategoryRequest>,
) -> ApiResult<Json<CategoryResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident_template.write", None)
        .await?;

    let existing = categories::Entity::find_by_id(params.code.clone())
        .one(&state.db)
        .await?
        .ok_or_else(|| LocalError::not_found(format!("category {}", params.code)))?;
    let c = params.validate()?;

    let mut active: categories::ActiveModel = existing.into();
    active.label = Set(c.label);
    active.description = Set(c.description);
    active.icon = Set(c.icon);
    active.display_order = Set(Some(c.display_order));
    active.is_active = Set(Some(c.is_active));
    let row = active.update(&state.db).await?;

    tracing::info!(code = row.code, "UpdateCategory");
    Ok(Json(row.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(label: &str, icon: Option<&str>) -> SaveCategoryRequest {
        SaveCategoryRequest {
            code: "x".to_string(),
            label: label.to_string(),
            description: Some("  ".to_string()),
            icon: icon.map(str::to_string),
            display_order: 0,
            is_active: true,
        }
    }

    #[test]
    fn code_accepts_plain_identifiers() {
        assert!(validate_code("security").is_ok());
        assert!(validate_code("after_hours_2").is_ok());
        assert!(validate_code(&"a".repeat(50)).is_ok());
    }

    #[test]
    fn code_rejects_everything_else() {
        for code in [
            "",
            "Security",
            "after-hours",
            "with space",
            "café",
            &"a".repeat(51),
        ] {
            assert!(validate_code(code).is_err(), "{code:?} should be rejected");
        }
    }

    #[test]
    fn validate_trims_and_blanks_to_none() {
        let c = request("  Security  ", Some(" 🔒 ")).validate().unwrap();
        assert_eq!(c.label, "Security");
        assert_eq!(c.icon.as_deref(), Some("🔒"));
        assert_eq!(c.description, None);
    }

    #[test]
    fn validate_rejects_blank_and_overlong() {
        assert!(request("   ", None).validate().is_err());
        assert!(request(&"x".repeat(101), None).validate().is_err());
        assert!(request("ok", Some(&"x".repeat(11))).validate().is_err());
        assert!(request(&"é".repeat(100), None).validate().is_ok());
    }
}
