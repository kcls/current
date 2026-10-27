use integration_tests::*;
use serde_json::json;

// There is no category delete (templates reference categories by code), so
// categories created here stay behind, inactive, under an `itest_` code.

fn unique_code() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("itest_{nanos}")
}

async fn post(
    c: &reqwest::Client,
    token: &str,
    path: &str,
    body: serde_json::Value,
) -> reqwest::Response {
    c.post(format!("{}/api/v1/current/category/{path}", current_base()))
        .headers(auth_header(token))
        .json(&body)
        .send()
        .await
        .unwrap()
}

async fn list(c: &reqwest::Client, token: &str, body: serde_json::Value) -> Vec<serde_json::Value> {
    let resp = post(c, token, "list", body).await;
    assert_eq!(resp.status(), 200);
    resp.json::<serde_json::Value>()
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

#[tokio::test]
async fn list_categories_returns_seeded_categories() {
    let c = client();
    let token = staff_token(&c).await;

    let categories = list(&c, &token, json!({"is_active": true})).await;
    let security = categories
        .iter()
        .find(|cat| cat["code"] == "security")
        .expect("seeded security category");
    assert_eq!(security["label"], "Security");
    assert!(categories.iter().all(|cat| cat["is_active"] == true));

    let orders: Vec<i64> = categories
        .iter()
        .map(|cat| cat["display_order"].as_i64().unwrap_or(0))
        .collect();
    let mut sorted = orders.clone();
    sorted.sort();
    assert_eq!(orders, sorted, "categories are ordered by display_order");
}

#[tokio::test]
async fn create_and_update_category() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let code = unique_code();

    let resp = post(
        &c,
        &token,
        "create",
        json!({
            "code": code,
            "label": "  Integration Test  ",
            "description": "",
            "icon": "🧪",
            "display_order": 99,
            "is_active": false,
        }),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let cat: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(cat["code"], code);
    assert_eq!(cat["label"], "Integration Test", "label is trimmed");
    assert!(
        cat["description"].is_null(),
        "blank description stored as null"
    );
    assert_eq!(cat["icon"], "🧪");
    assert_eq!(cat["display_order"], 99);
    assert_eq!(cat["is_active"], false);

    let resp = post(
        &c,
        &token,
        "update",
        json!({"code": code, "label": "Renamed", "description": "described", "is_active": false}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let cat: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(cat["label"], "Renamed");
    assert_eq!(cat["description"], "described");
    assert!(cat["icon"].is_null(), "omitted icon is cleared");
    assert_eq!(cat["display_order"], 0);

    let listed = list(&c, &token, json!({"is_active": false})).await;
    assert!(
        listed
            .iter()
            .any(|cat| cat["code"] == code && cat["label"] == "Renamed"),
        "updated category listed as inactive"
    );
    let active = list(&c, &token, json!({"is_active": true})).await;
    assert!(!active.iter().any(|cat| cat["code"] == code));
}

#[tokio::test]
async fn new_category_is_usable_by_templates() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let code = unique_code();

    let resp = post(
        &c,
        &token,
        "create",
        json!({"code": code, "label": "Template target", "is_active": false}),
    )
    .await;
    assert_eq!(resp.status(), 200);

    let resp = c
        .post(format!("{}/api/v1/current/template/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"name": format!("itest category {code}"), "category": code, "is_active": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let template: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(template["category"], code);

    let resp = c
        .post(format!("{}/api/v1/current/template/delete", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"id": template["id"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn create_category_rejects_duplicate_code() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = post(
        &c,
        &token,
        "create",
        json!({"code": "security", "label": "Dup"}),
    )
    .await;
    assert_eq!(resp.status(), 409);
}

#[tokio::test]
async fn create_category_validates_input() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let cases = [
        ("uppercase code", json!({"code": "Bad", "label": "x"})),
        ("hyphenated code", json!({"code": "bad-code", "label": "x"})),
        ("empty code", json!({"code": "", "label": "x"})),
        (
            "over-long code",
            json!({"code": "a".repeat(51), "label": "x"}),
        ),
        ("blank label", json!({"code": unique_code(), "label": "  "})),
        (
            "over-long label",
            json!({"code": unique_code(), "label": "x".repeat(101)}),
        ),
        (
            "over-long icon",
            json!({"code": unique_code(), "label": "x", "icon": "x".repeat(11)}),
        ),
    ];
    for (label, body) in cases {
        let resp = post(&c, &token, "create", body).await;
        assert_eq!(resp.status(), 400, "expected 400 for: {label}");
    }
}

#[tokio::test]
async fn update_unknown_category_is_not_found() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = post(
        &c,
        &token,
        "update",
        json!({"code": unique_code(), "label": "x"}),
    )
    .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn category_writes_require_permission() {
    let c = client();

    for user in [&STAFF, &MANAGER] {
        let token = login_token(&c, user).await;

        let resp = post(
            &c,
            &token,
            "create",
            json!({"code": unique_code(), "label": "x"}),
        )
        .await;
        assert_eq!(resp.status(), 403, "{} create", user.username);

        let resp = post(
            &c,
            &token,
            "update",
            json!({"code": "security", "label": "x"}),
        )
        .await;
        assert_eq!(resp.status(), 403, "{} update", user.username);
    }
}

#[tokio::test]
async fn category_endpoints_require_auth() {
    let c = client();
    for path in ["list", "create", "update"] {
        let resp = c
            .post(format!("{}/api/v1/current/category/{path}", current_base()))
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 401, "category/{path} without token");
    }
}
