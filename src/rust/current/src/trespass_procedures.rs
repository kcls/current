use axum::Json;
use axum::extract::State;
use odo_client::error::{ApiResult, LocalError, LocalResult};
use sea_orm::prelude::*;
use sea_orm::QueryOrder;
use serde::Serialize;
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::trespass_procedure_item;

/// Load active checklist items ordered for display
pub(crate) async fn active_items<C: sea_orm::ConnectionTrait>(
    db: &C,
) -> LocalResult<Vec<trespass_procedure_item::Model>> {
    Ok(trespass_procedure_item::Entity::find()
        .filter(trespass_procedure_item::Column::IsActive.eq(true))
        .order_by_asc(trespass_procedure_item::Column::DisplayOrder)
        .all(db)
        .await?)
}

pub(crate) fn build_snapshot(
    items: &[trespass_procedure_item::Model],
    submitted: &serde_json::Value,
) -> serde_json::Value {
    let is_checked =
        |code: &str| -> bool { submitted.get(code).and_then(|v| v.as_bool()).unwrap_or(false) };
    let snapshot_items: Vec<serde_json::Value> = items
        .iter()
        .map(|it| {
            serde_json::json!({
                "code": it.code,
                "label": it.label,
                "checked": is_checked(&it.code),
                "required": it.required,
                "account_dependent": it.account_dependent,
                "is_escape_hatch": it.is_escape_hatch,
            })
        })
        .collect();
    serde_json::json!({ "items": snapshot_items })
}

/// Labels of required steps still missing
fn missing_required(
    items: &[trespass_procedure_item::Model],
    submitted: &serde_json::Value,
) -> Vec<String> {
    let is_checked =
        |code: &str| -> bool { submitted.get(code).and_then(|v| v.as_bool()).unwrap_or(false) };
    let escape_checked = items
        .iter()
        .any(|it| it.is_escape_hatch && is_checked(&it.code));
    items
        .iter()
        .filter(|it| {
            it.required
                && !it.is_escape_hatch
                && !is_checked(&it.code)
                && !(it.account_dependent && escape_checked)
        })
        .map(|it| it.label.clone())
        .collect()
}

/// Validate completeness and return the snapshot
pub(crate) fn build_and_validate(
    items: &[trespass_procedure_item::Model],
    submitted: &serde_json::Value,
) -> LocalResult<serde_json::Value> {
    let missing = missing_required(items, submitted);
    if !missing.is_empty() {
        return Err(LocalError::invalid_input(format!(
            "Trespass procedures incomplete: {}",
            missing.join(", ")
        )));
    }
    Ok(build_snapshot(items, submitted))
}

/// True when the active checklist has at least one required item. When it
/// doesn't, the review-submission gate is a no-op — there is nothing to
/// enforce, so trespasses submit without a checklist.
pub(crate) async fn has_required_items<C: sea_orm::ConnectionTrait>(db: &C) -> LocalResult<bool> {
    Ok(trespass_procedure_item::Entity::find()
        .filter(trespass_procedure_item::Column::IsActive.eq(true))
        .filter(trespass_procedure_item::Column::Required.eq(true))
        .one(db)
        .await?
        .is_some())
}

/// Validate the submitted checklist against the active items and return the
/// frozen snapshot. Called at review submission (not creation). `submitted`
/// is None when the caller sent nothing — treated as an empty checklist so
/// the missing-required error names every required step.
pub(crate) async fn validate_and_snapshot<C: sea_orm::ConnectionTrait>(
    db: &C,
    submitted: Option<&serde_json::Value>,
) -> LocalResult<serde_json::Value> {
    let items = active_items(db).await?;
    let submitted = submitted.cloned().unwrap_or(serde_json::Value::Null);
    build_and_validate(&items, &submitted)
}

// ===========================================================================
// List endpoint
// ===========================================================================

#[derive(Debug, Serialize, ToSchema)]
pub struct TrespassProcedureItemResponse {
    pub id: i32,
    pub code: String,
    pub label: String,
    pub required: bool,
    pub account_dependent: bool,
    pub is_escape_hatch: bool,
    pub display_order: i32,
    pub is_active: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListTrespassProceduresResponse {
    pub items: Vec<TrespassProcedureItemResponse>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/trespass-procedure/list",
    responses((
        status = 200,
        body = ListTrespassProceduresResponse,
        description = "Active trespass procedure checklist items, ordered for display"
    )),
    security(("bearer" = [])),
    tag = "bans"
)]
pub async fn list_trespass_procedures(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<ListTrespassProceduresResponse>> {
    let items = active_items(&state.db).await?;
    Ok(Json(ListTrespassProceduresResponse {
        items: items
            .into_iter()
            .map(|m| TrespassProcedureItemResponse {
                id: m.id,
                code: m.code,
                label: m.label,
                required: m.required,
                account_dependent: m.account_dependent,
                is_escape_hatch: m.is_escape_hatch,
                display_order: m.display_order,
                is_active: m.is_active,
            })
            .collect(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(
        code: &str,
        required: bool,
        account_dependent: bool,
        is_escape_hatch: bool,
    ) -> trespass_procedure_item::Model {
        let now = chrono::Utc::now().fixed_offset();
        trespass_procedure_item::Model {
            id: 0,
            code: code.to_string(),
            label: code.to_string(),
            required,
            account_dependent,
            is_escape_hatch,
            display_order: 0,
            is_active: true,
            created_by: None,
            created_at: now,
            updated_by: None,
            updated_at: now,
        }
    }

    fn kcls() -> Vec<trespass_procedure_item::Model> {
        vec![
            item("police_letter_issued", true, false, false),
            item("letter_mailed", false, false, false),
            item("evergreen_alert_set", true, true, false),
            item("account_barred", true, true, false),
            item("no_computer_access", true, true, false),
            item("holds_cancelled", true, true, false),
            item("no_evergreen_account", false, false, true),
        ]
    }

    #[test]
    fn all_required_checked_passes() {
        let submitted = serde_json::json!({
            "police_letter_issued": true,
            "evergreen_alert_set": true,
            "account_barred": true,
            "no_computer_access": true,
            "holds_cancelled": true,
        });
        let snap = build_and_validate(&kcls(), &submitted).unwrap();
        assert_eq!(snap["items"].as_array().unwrap().len(), 7);
    }

    #[test]
    fn escape_hatch_waives_account_dependent() {
        let submitted = serde_json::json!({
            "police_letter_issued": true,
            "no_evergreen_account": true,
        });
        assert!(build_and_validate(&kcls(), &submitted).is_ok());
    }

    #[test]
    fn escape_hatch_does_not_waive_police_letter() {
        let submitted = serde_json::json!({ "no_evergreen_account": true });
        let err = build_and_validate(&kcls(), &submitted).unwrap_err();
        assert!(err.to_string().contains("police_letter_issued"));
    }

    #[test]
    fn missing_account_step_without_escape_fails() {
        let submitted = serde_json::json!({
            "police_letter_issued": true,
            "evergreen_alert_set": true,
            "account_barred": true,
            "no_computer_access": true,
        });
        let err = build_and_validate(&kcls(), &submitted).unwrap_err();
        assert!(err.to_string().contains("holds_cancelled"));
    }

    #[test]
    fn null_submission_fails() {
        assert!(build_and_validate(&kcls(), &serde_json::Value::Null).is_err());
    }

    #[test]
    fn escape_hatch_marked_required_is_not_itself_required() {
        let cfg = vec![
            item("police_letter_issued", true, false, false),
            item("no_evergreen_account", true, false, true),
        ];
        let submitted = serde_json::json!({ "police_letter_issued": true });
        assert!(build_and_validate(&cfg, &submitted).is_ok());
    }

    #[test]
    fn no_escape_hatch_means_account_steps_always_required() {
        let cfg = vec![
            item("police_letter_issued", true, false, false),
            item("alert", true, true, false),
        ];
        assert!(build_and_validate(&cfg, &serde_json::json!({ "police_letter_issued": true })).is_err());
        assert!(build_and_validate(
            &cfg,
            &serde_json::json!({ "police_letter_issued": true, "alert": true })
        )
        .is_ok());
    }
}
