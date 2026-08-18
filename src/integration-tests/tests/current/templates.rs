use integration_tests::*;
use serde_json::json;

// ============================================================================
// TODO — back-fill behavioral coverage
// ============================================================================
//
// Templates are read-only via the `current` API; the existing tests cover
// list/order/filter/auth adequately. No integration-test gap that incident
// creation unblocks.
//
// One *nice-to-have* once `incidents.create` exercises template_ids:
// cross-test verifying that `incident/create` with `template_ids: [<id>]`
// using a real id returned by `template/list` actually persists the
// mapping (verifiable via incident/get's `template_ids` array). Lives
// better in `incidents.rs` than here.

// ============================================================================

#[tokio::test]
async fn list_templates_returns_results() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/template/list", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();
    let templates = data.as_array().unwrap();

    assert!(!templates.is_empty(), "expected at least one template");

    let t = &templates[0];
    assert!(t["id"].as_i64().is_some());
    assert!(t["name"].as_str().is_some());
    assert!(t["category"].as_str().is_some());
    assert!(t["fields"].is_object() || t["fields"].is_array());
}

#[tokio::test]
async fn list_templates_ordered_by_name() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/template/list", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();
    let templates = data.as_array().unwrap();

    let names: Vec<&str> = templates
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();

    let mut sorted = names.clone();
    sorted.sort_by_key(|s| s.to_lowercase());

    assert_eq!(names, sorted, "templates should be sorted by name ascending");
}

#[tokio::test]
async fn list_templates_filter_by_is_active() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/template/list", current_base()))
        .json(&json!({"is_active": true}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();
    let templates = data.as_array().unwrap();

    assert!(!templates.is_empty(), "expected at least one active template");

    for t in templates {
        assert_eq!(
            t["is_active"].as_bool().unwrap(),
            true,
            "all returned templates should be active"
        );
    }
}

#[tokio::test]
async fn list_templates_filter_by_id() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // First grab any valid ID from the unfiltered list.
    let all: serde_json::Value = c
        .post(format!("{}/api/v1/current/template/list", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let id = all.as_array().unwrap()[0]["id"].as_i64().unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/template/list", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();
    let templates = data.as_array().unwrap();

    assert_eq!(templates.len(), 1);
    assert_eq!(templates[0]["id"].as_i64().unwrap(), id);
}

#[tokio::test]
async fn list_templates_requires_auth() {
    let c = client();

    let resp = c
        .post(format!("{}/api/v1/current/template/list", current_base()))
        .json(&json!({}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);
}
