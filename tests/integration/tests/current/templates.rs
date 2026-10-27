use integration_tests::*;
use serde_json::json;

// Cross-check still worth adding in `incidents.rs`: `incident/create` with
// `template_ids: [<id>]` from `template/list` persists the mapping
// (visible in incident/get's `template_ids`).

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

// ============================================================================
// Admin: create / update / delete
// ============================================================================

fn unique_name(label: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("itest {label} {nanos}")
}

async fn post(c: &reqwest::Client, token: &str, path: &str, body: serde_json::Value) -> reqwest::Response {
    c.post(format!("{}/api/v1/current/template/{path}", current_base()))
        .headers(auth_header(token))
        .json(&body)
        .send()
        .await
        .unwrap()
}

/// A category code known to exist, taken from a seeded template.
async fn some_category(c: &reqwest::Client, token: &str) -> String {
    let all: serde_json::Value = post(c, token, "list", json!({})).await.json().await.unwrap();
    all[0]["category"].as_str().unwrap().to_string()
}

async fn create(c: &reqwest::Client, token: &str, label: &str) -> serde_json::Value {
    let category = some_category(c, token).await;
    let resp = post(
        c,
        token,
        "create",
        json!({
            "name": unique_name(label),
            "description": "integration test template",
            "category": category,
            "fields": [{"name": "f1", "label": "Field 1", "type": "text", "required": false}],
            "is_active": false,
        }),
    )
    .await;
    assert_eq!(resp.status(), 200);
    resp.json().await.unwrap()
}

async fn delete(c: &reqwest::Client, token: &str, id: i64) {
    let resp = post(c, token, "delete", json!({"id": id})).await;
    assert_eq!(resp.status(), 200, "cleanup delete of template {id}");
}

#[tokio::test]
async fn create_template_returns_saved_values() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let category = some_category(&c, &token).await;
    let name = unique_name("create");

    let resp = post(
        &c,
        &token,
        "create",
        json!({
            "name": format!("  {name}  "),
            "description": "  ",
            "category": category,
        }),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let t: serde_json::Value = resp.json().await.unwrap();
    let id = t["id"].as_i64().unwrap();

    assert_eq!(t["name"], name, "name is trimmed");
    assert!(t["description"].is_null(), "blank description stored as null");
    assert_eq!(t["category"], category);
    assert_eq!(t["fields"], json!([]), "fields default to empty");
    assert_eq!(t["is_active"], true);
    assert_eq!(t["requires_patron"], true);
    assert_eq!(t["show_called_emergency"], true);
    assert_eq!(t["version"], 1);
    assert!(t["deleted_at"].is_null());

    let listed: serde_json::Value = post(&c, &token, "list", json!({"id": id}))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["name"], name);

    delete(&c, &token, id).await;
}

#[tokio::test]
async fn update_template_replaces_values_and_bumps_version_on_fields_change() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let t = create(&c, &token, "update").await;
    let id = t["id"].as_i64().unwrap();
    let new_name = unique_name("updated");

    // Same fields: version stays put.
    let resp = post(
        &c,
        &token,
        "update",
        json!({
            "id": id,
            "name": new_name,
            "category": t["category"],
            "fields": t["fields"],
            "is_active": false,
            "requires_patron": false,
            "show_called_emergency": false,
        }),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let u: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(u["name"], new_name);
    assert!(u["description"].is_null(), "omitted description is cleared");
    assert_eq!(u["is_active"], false);
    assert_eq!(u["requires_patron"], false);
    assert_eq!(u["show_called_emergency"], false);
    assert_eq!(u["version"], 1, "unchanged fields keep the version");

    // Changed fields: version bumps.
    let resp = post(
        &c,
        &token,
        "update",
        json!({
            "id": id,
            "name": new_name,
            "category": t["category"],
            "fields": [],
            "is_active": false,
        }),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let u: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(u["fields"], json!([]));
    assert_eq!(u["version"], 2, "changed fields bump the version");

    delete(&c, &token, id).await;
}

#[tokio::test]
async fn delete_template_soft_deletes() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let t = create(&c, &token, "delete").await;
    let id = t["id"].as_i64().unwrap();

    let resp = post(&c, &token, "delete", json!({"id": id})).await;
    assert_eq!(resp.status(), 200);
    let d: serde_json::Value = resp.json().await.unwrap();
    assert!(d["deleted_at"].is_string());

    let listed: serde_json::Value = post(&c, &token, "list", json!({"id": id}))
        .await
        .json()
        .await
        .unwrap();
    assert!(listed.as_array().unwrap().is_empty(), "deleted template hidden by default");

    let listed: serde_json::Value =
        post(&c, &token, "list", json!({"id": id, "include_deleted": true}))
            .await
            .json()
            .await
            .unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1, "include_deleted returns it");
    assert!(listed[0]["deleted_at"].is_string());

    let resp = post(&c, &token, "delete", json!({"id": id})).await;
    assert_eq!(resp.status(), 404, "deleting twice is not found");

    let resp = post(
        &c,
        &token,
        "update",
        json!({"id": id, "name": "x", "category": t["category"]}),
    )
    .await;
    assert_eq!(resp.status(), 404, "a deleted template cannot be updated");
}

#[tokio::test]
async fn update_unknown_template_is_not_found() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let category = some_category(&c, &token).await;

    let resp = post(
        &c,
        &token,
        "update",
        json!({"id": i32::MAX, "name": "x", "category": category}),
    )
    .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn create_template_validates_input() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let category = some_category(&c, &token).await;

    let cases = [
        ("blank name", json!({"name": "   ", "category": category})),
        (
            "over-long name",
            json!({"name": "x".repeat(256), "category": category}),
        ),
        (
            "unknown category",
            json!({"name": unique_name("bad"), "category": "no-such-category"}),
        ),
        (
            "non-array fields",
            json!({"name": unique_name("bad"), "category": category, "fields": {}}),
        ),
    ];
    for (label, body) in cases {
        let resp = post(&c, &token, "create", body).await;
        assert_eq!(resp.status(), 400, "expected 400 for: {label}");
    }
}

#[tokio::test]
async fn template_writes_require_permission() {
    let c = client();
    let coord = login_token(&c, &COORD).await;
    let t = create(&c, &coord, "perm").await;
    let id = t["id"].as_i64().unwrap();

    for user in [&STAFF, &MANAGER] {
        let token = login_token(&c, user).await;

        let resp = post(
            &c,
            &token,
            "create",
            json!({"name": unique_name("denied"), "category": t["category"]}),
        )
        .await;
        assert_eq!(resp.status(), 403, "{} create", user.username);

        let resp = post(
            &c,
            &token,
            "update",
            json!({"id": id, "name": "denied", "category": t["category"]}),
        )
        .await;
        assert_eq!(resp.status(), 403, "{} update", user.username);

        let resp = post(&c, &token, "delete", json!({"id": id})).await;
        assert_eq!(resp.status(), 403, "{} delete", user.username);

        let resp = post(&c, &token, "list", json!({"include_deleted": true})).await;
        assert_eq!(resp.status(), 403, "{} include_deleted", user.username);
    }

    delete(&c, &coord, id).await;
}

#[tokio::test]
async fn template_writes_require_auth() {
    let c = client();
    for path in ["create", "update", "delete"] {
        let resp = c
            .post(format!("{}/api/v1/current/template/{path}", current_base()))
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 401, "template/{path} without token");
    }
}
