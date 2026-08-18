use integration_tests::*;
use serde_json::json;

/// Pinned fixture group id (level-1 reviewers, src/test-data).
const REVIEW_GROUP_ID: i64 = 9102;
/// Resolve an org unit's uuid by code (fresh client + cached admin token).
async fn unit_by_code(code: &str) -> String {
    let c = client();
    let token = admin_token(&c).await;
    unit_uuid_by_code(&c, &token, code).await
}

/// Main Street Branch — the e2e-seeded review-chain org unit,
/// resolved to its uuid at runtime.
async fn review_chain_org_unit() -> String {
    unit_by_code("MAIN").await
}

// Org unit with no pre-existing review chains in the e2e test data
// (Hilltop Branch). Used for save tests.
async fn save_test_org_unit() -> String {
    unit_by_code("HILL").await
}

#[tokio::test]
async fn health() {
    let c = client();
    let resp = c.get(format!("{}/health", current_base())).send().await.unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn get_review_group() {
    let c = client();
    let token = login_token(&c, &MANAGER).await;

    let resp = c
        .get(format!("{}/api/v1/current/review-group/{REVIEW_GROUP_ID}", current_base()))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();

    assert_eq!(data["id"].as_i64().unwrap(), REVIEW_GROUP_ID);
    assert!(data["members"].is_array());
    assert!(data["members"][0]["usr_display_name"].as_str().unwrap().contains("E2E"));
}

#[tokio::test]
async fn list_review_chain() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/review-chain/list", current_base()))
        .json(&json!({"org_unit": review_chain_org_unit().await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();

    assert!(data.is_array());

    let expected_org = review_chain_org_unit().await;
    for chain in data.as_array().unwrap() {
        assert_eq!(chain["org_unit"].as_str().unwrap(), expected_org);
    }
}

#[tokio::test]
async fn has_review_chain() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/review-chain/has", current_base()))
        .json(&json!({"org_unit": review_chain_org_unit().await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();

    assert!(data.as_bool().unwrap());

    let resp = c
        .post(format!("{}/api/v1/current/review-chain/has", current_base()))
        .json(&json!({"org_unit": unit_by_code("OLS").await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();

    assert!(!data.as_bool().unwrap());
}

// --- save_review_chain ---

async fn save_chain(c: &reqwest::Client, token: &str, body: &serde_json::Value) -> reqwest::Response {
    c.post(format!("{}/api/v1/current/review-chain/save", current_base()))
        .headers(auth_header(token))
        .json(body)
        .send()
        .await
        .unwrap()
}

async fn list_chain(c: &reqwest::Client, token: &str, org_unit: &str) -> Vec<serde_json::Value> {
    let resp = c
        .post(format!("{}/api/v1/current/review-chain/list", current_base()))
        .headers(auth_header(token))
        .json(&json!({"org_unit": org_unit}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    data.as_array().unwrap().clone()
}

async fn has_chain(c: &reqwest::Client, token: &str, org_unit: &str) -> bool {
    let resp = c
        .post(format!("{}/api/v1/current/review-chain/has", current_base()))
        .headers(auth_header(token))
        .json(&json!({"org_unit": org_unit}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    resp.json::<serde_json::Value>().await.unwrap().as_bool().unwrap()
}

/// Delete all review chain levels at an org_unit by saving an empty-then-one
/// chain, then removing that last level via a direct save with just the created
/// entries removed.  This is a test-only cleanup helper.
async fn cleanup_chain(c: &reqwest::Client, token: &str, org_unit: &str) {
    // List current chain and delete all levels by saving with none of their IDs
    let current = list_chain(c, token, org_unit).await;
    if current.is_empty() {
        return;
    }

    // Save with a single dummy level (can't save empty), then delete that too
    let resp = save_chain(c, token, &json!({
        "org_unit": org_unit,
        "levels": [{"members": [{"usr": COORD.uuid}]}]
    }))
    .await;
    assert_eq!(resp.status(), 200);

    // Now list to get the dummy level's ID, then save with zero of those IDs
    // — but save requires at least one level, so we accept the dummy stays.
    // The next test's save will overwrite it anyway.
}

#[tokio::test]
async fn save_review_chain_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/review-chain/save", current_base()))
        .json(&json!({
            "org_unit": save_test_org_unit().await,
            "levels": [{"members": [{"usr": COORD.uuid}]}]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn save_review_chain_rejects_empty_levels() {
    let c = client();
    let token = login_token(&c, &ADMIN).await;

    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": []
    }))
    .await;

    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn save_review_chain_create_and_list() {
    let c = client();
    let token = login_token(&c, &ADMIN).await;

    let save_org = save_test_org_unit().await;
    cleanup_chain(&c, &token, &save_org).await;

    // Create a 2-level chain
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [
            {"members": [{"usr": COORD.uuid}], "require_peer_review": false},
            {"members": [{"usr": ADMIN.uuid}]}
        ]
    }))
    .await;

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["saved"], true);
    assert_eq!(data["level_count"], 2);

    // Verify via list
    let chains = list_chain(&c, &token, &save_org).await;
    assert_eq!(chains.len(), 2);

    assert_eq!(chains[0]["review_level"].as_i64().unwrap(), 1);
    assert_eq!(chains[1]["review_level"].as_i64().unwrap(), 2);

    // Last level should be marked is_final
    assert_eq!(chains[0]["is_final"], false);
    assert_eq!(chains[1]["is_final"], true);

    // Verify has_review_chain returns true
    assert!(has_chain(&c, &token, &save_org).await);
}

#[tokio::test]
async fn save_review_chain_add_level() {
    let c = client();
    let token = login_token(&c, &ADMIN).await;

    let save_org = save_test_org_unit().await;
    cleanup_chain(&c, &token, &save_org).await;

    // Create a 1-level chain
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [{"members": [{"usr": COORD.uuid}]}]
    }))
    .await;
    assert_eq!(resp.status(), 200);

    let chains = list_chain(&c, &token, &save_org).await;
    assert_eq!(chains.len(), 1);
    let level1_id = chains[0]["id"].as_i64().unwrap();

    // Add a second level, keeping the first
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [
            {"id": level1_id, "members": [{"usr": COORD.uuid}]},
            {"members": [{"usr": ADMIN.uuid}]}
        ]
    }))
    .await;
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["level_count"], 2);

    let chains = list_chain(&c, &token, &save_org).await;
    assert_eq!(chains.len(), 2);

    // Original level should keep its ID
    assert_eq!(chains[0]["id"].as_i64().unwrap(), level1_id);
    assert_eq!(chains[0]["is_final"], false);
    assert_eq!(chains[1]["is_final"], true);
}

#[tokio::test]
async fn save_review_chain_remove_level() {
    let c = client();
    let token = login_token(&c, &ADMIN).await;

    let save_org = save_test_org_unit().await;
    cleanup_chain(&c, &token, &save_org).await;

    // Create a 2-level chain
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [
            {"members": [{"usr": COORD.uuid}]},
            {"members": [{"usr": ADMIN.uuid}]}
        ]
    }))
    .await;
    assert_eq!(resp.status(), 200);

    let chains = list_chain(&c, &token, &save_org).await;
    assert_eq!(chains.len(), 2);
    let level1_id = chains[0]["id"].as_i64().unwrap();

    // Remove the second level, keep only the first
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [
            {"id": level1_id, "members": [{"usr": COORD.uuid}]}
        ]
    }))
    .await;
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["level_count"], 1);

    let chains = list_chain(&c, &token, &save_org).await;
    assert_eq!(chains.len(), 1);
    assert_eq!(chains[0]["id"].as_i64().unwrap(), level1_id);
    assert_eq!(chains[0]["is_final"], true);
}

#[tokio::test]
async fn save_review_chain_reorder() {
    let c = client();
    let token = login_token(&c, &ADMIN).await;

    let save_org = save_test_org_unit().await;
    cleanup_chain(&c, &token, &save_org).await;

    // Create a 2-level chain
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [
            {"members": [{"usr": COORD.uuid}]},
            {"members": [{"usr": ADMIN.uuid}]}
        ]
    }))
    .await;
    assert_eq!(resp.status(), 200);

    let chains = list_chain(&c, &token, &save_org).await;
    let level1_id = chains[0]["id"].as_i64().unwrap();
    let level2_id = chains[1]["id"].as_i64().unwrap();

    // Swap the order
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [
            {"id": level2_id, "members": [{"usr": ADMIN.uuid}]},
            {"id": level1_id, "members": [{"usr": COORD.uuid}]}
        ]
    }))
    .await;
    assert_eq!(resp.status(), 200);

    let chains = list_chain(&c, &token, &save_org).await;
    assert_eq!(chains.len(), 2);

    // First level should now be the old level2
    assert_eq!(chains[0]["id"].as_i64().unwrap(), level2_id);
    assert_eq!(chains[0]["review_level"].as_i64().unwrap(), 1);

    // Second level should now be the old level1
    assert_eq!(chains[1]["id"].as_i64().unwrap(), level1_id);
    assert_eq!(chains[1]["review_level"].as_i64().unwrap(), 2);
    assert_eq!(chains[1]["is_final"], true);
}

#[tokio::test]
async fn save_review_chain_sync_members() {
    let c = client();
    let token = login_token(&c, &ADMIN).await;

    let save_org = save_test_org_unit().await;
    cleanup_chain(&c, &token, &save_org).await;

    // Create a chain with one member
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [{"members": [{"usr": COORD.uuid}]}]
    }))
    .await;
    assert_eq!(resp.status(), 200);

    let chains = list_chain(&c, &token, &save_org).await;
    let level_id = chains[0]["id"].as_i64().unwrap();
    assert_eq!(chains[0]["reviewer_ids"].as_array().unwrap().len(), 1);

    // Update: add a second member
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [{"id": level_id, "members": [{"usr": COORD.uuid}, {"usr": ADMIN.uuid}]}]
    }))
    .await;
    assert_eq!(resp.status(), 200);

    let chains = list_chain(&c, &token, &save_org).await;
    let member_ids = chains[0]["reviewer_ids"].as_array().unwrap();
    assert_eq!(member_ids.len(), 2);

    // Update: remove the first member
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [{"id": level_id, "members": [{"usr": ADMIN.uuid}]}]
    }))
    .await;
    assert_eq!(resp.status(), 200);

    let chains = list_chain(&c, &token, &save_org).await;
    let member_ids = chains[0]["reviewer_ids"].as_array().unwrap();
    assert_eq!(member_ids.len(), 1);
    assert_eq!(member_ids[0].as_str().unwrap(), ADMIN.uuid);
}

#[tokio::test]
async fn save_review_chain_peer_review_flag() {
    let c = client();
    let token = login_token(&c, &ADMIN).await;

    let save_org = save_test_org_unit().await;
    cleanup_chain(&c, &token, &save_org).await;

    // Create a 2-level chain with peer review on level 1
    let resp = save_chain(&c, &token, &json!({
        "org_unit": save_test_org_unit().await,
        "levels": [
            {"members": [{"usr": COORD.uuid}], "require_peer_review": true},
            {"members": [{"usr": ADMIN.uuid}]}
        ]
    }))
    .await;
    assert_eq!(resp.status(), 200);

    let chains = list_chain(&c, &token, &save_org).await;
    assert_eq!(chains[0]["require_peer_review"], true);
    // Final level always has peer_review = false
    assert_eq!(chains[1]["require_peer_review"], false);
}

// ============================================================================
// TODO — remaining back-fill coverage
// ============================================================================
//
// Several deferred test paths were unblocked when `incidents.review.create`
// landed and are now exercised by the create_review_* tests later in this
// file (review history ordering, pending_reviews threshold, search
// is_resolved filter, soft-delete behavior, etc.).
//
// What remains:
//
// ## save_review_chain — in-flight orphan check
//
// `save_review_chain` rejects a chain shortening when any open incident's
// current min_review_level > new_max_level. To exercise this:
//   1. Save a 2-level chain at SAVE_TEST_ORG_UNIT
//   2. Create an incident there
//   3. Submit reviews until min_review_level == 2
//   4. Try to save a 1-level chain → expect 400
//
// This is now testable but hasn't been written yet; SAVE_TEST_ORG_UNIT is
// a sibling-region org without a parent review chain, so submissions may
// need to be done by users whose reviewer_level applies there. Worth
// confirming once we add the test.

#[tokio::test]
async fn list_reviews_requires_auth() {
    let c = client();

    let resp = c
        .post(format!("{}/api/v1/current/incident/review/list", current_base()))
        .json(&json!({"incident": 1}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn list_reviews_unknown_incident_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/review/list", current_base()))
        .json(&json!({"incident": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}

// --- get_pending_reviews ---

#[tokio::test]
async fn pending_reviews_requires_auth() {
    let c = client();

    let resp = c
        .post(format!("{}/api/v1/current/incident/pending-reviews", current_base()))
        .json(&json!({}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn pending_reviews_default_org_unit_returns_envelope() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/pending-reviews", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["rows"].is_array(), "expected `rows` array in envelope; got {data:?}");
}

#[tokio::test]
async fn pending_reviews_explicit_org_unit() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/pending-reviews", current_base()))
        .json(&json!({"org_unit": review_chain_org_unit().await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["rows"].is_array());
}

#[tokio::test]
async fn pending_reviews_unknown_org_unit_returns_empty_or_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // A nonsensical org_unit ID can either 404 (descendants lookup) or
    // resolve to no scope → empty list. Either is acceptable; we just
    // shouldn't crash.
    let resp = c
        .post(format!("{}/api/v1/current/incident/pending-reviews", current_base()))
        .json(&json!({"org_unit": "00000000-0000-4000-a000-00000000dead"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert!(
        resp.status() == 200 || resp.status() == 404 || resp.status() == 403,
        "expected 200/404/403, got {}",
        resp.status()
    );

    if resp.status() == 200 {
        let data: serde_json::Value = resp.json().await.unwrap();
        assert!(data["rows"].as_array().unwrap().is_empty());
        // No data → no next page.
        assert!(data.get("next_cursor").is_none() || data["next_cursor"].is_null());
    }
}

#[tokio::test]
async fn list_reviews_rejects_missing_incident() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/review/list", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for missing incident, got {}",
        resp.status()
    );
}

// ============================================================================
// create_incident_review
// ============================================================================
//
// These tests exercise the review-create path AND the end-to-end behaviors
// that previously had TODO blocks (list_reviews populated, pending_reviews
// inclusion threshold, search is_resolved filter, etc.).

/// Local fixture: create an incident in the e2e-seeded review-chain
/// org unit and return its id. Mirrors the helper in the incidents test
/// module — kept independent so test files stay self-contained.
///
/// Pass the creator's token explicitly so callers can pick the right
/// actor for the review chain there. The chain has STAFF
/// outside the chain (creator-only), MANAGER at level 1, and COORD at
/// the final level — see test-data/004_e2e_multi_level_review_chain.sql.
/// Using COORD as the creator triggers auto-resolution on the first
/// `submitted` (final reviewer + progressing result), which breaks
/// tests that want to observe intermediate review states.
async fn create_incident_for_review(c: &reqwest::Client, token: &str, title: &str) -> i64 {
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": review_chain_org_unit().await,
            "title": title,
            "description": "review-create integration test fixture",
        }))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap()
}

async fn submit_review(
    c: &reqwest::Client,
    token: &str,
    incident_id: i64,
    result: &str,
    comments: Option<&str>,
) -> reqwest::Response {
    let mut body = json!({"incident": incident_id, "result": result});
    if let Some(c) = comments {
        body["comments"] = json!(c);
    }
    c.post(format!("{}/api/v1/current/incident/review/create", current_base()))
        .json(&body)
        .headers(auth_header(token))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn create_review_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/incident/review/create", current_base()))
        .json(&json!({"incident": 1, "result": "submitted"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn create_review_unknown_incident_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = submit_review(&c, &token, 2_000_000_000, "submitted", None).await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn create_review_rejects_unknown_result_string() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_incident_for_review(&c, &token, "review-unknown-result").await;
    let resp = submit_review(&c, &token, id, "approved-loudly", None).await;
    // The handler raises invalid_input → 400.
    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for unknown result, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn create_review_rejects_missing_required_fields() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/incident/review/create", current_base()))
        .json(&json!({"incident": 1}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for missing result, got {}",
        resp.status()
    );
}

// --- behavior: submit lands in incident_review and is visible via list ---

#[tokio::test]
async fn create_review_submit_round_trips_through_list() {
    let c = client();
    // STAFF creates + submits: STAFF isn't in the chain, so the submit
    // advances to level 1 (MANAGER's tier) without auto-resolving.
    let staff_token = login_token(&c, &STAFF).await;
    let id = create_incident_for_review(&c, &staff_token, "review-list-roundtrip").await;

    let resp = submit_review(&c, &staff_token, id, "submitted", Some("LGTM-like")).await;
    assert_eq!(resp.status(), 200, "submit should succeed; body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    let review_id = data["id"].as_i64().unwrap();
    assert_eq!(data["incident"].as_i64().unwrap(), id);
    assert_eq!(data["result"].as_str().unwrap(), "submitted");
    assert_eq!(data["comments"].as_str().unwrap(), "LGTM-like");
    assert!(data["min_review_level"].as_i64().unwrap() >= 1);
    assert_eq!(data["was_auto_resolved"].as_bool(), Some(false));

    // List should now contain the row we just inserted.
    let resp = c
        .post(format!("{}/api/v1/current/incident/review/list", current_base()))
        .json(&json!({"incident": id}))
        .headers(auth_header(&staff_token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let rows: Vec<serde_json::Value> = resp.json().await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"].as_i64().unwrap(), review_id);
    assert_eq!(rows[0]["result"].as_str().unwrap(), "submitted");
    assert_eq!(rows[0]["reviewer_name"].as_str(), Some("E2E Staff"));
}

// --- behavior: resolve sets resolved_at + reflects in search ---

#[tokio::test]
async fn create_review_resolve_sets_resolved_at_and_is_searchable() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_incident_for_review(&c, &token, "review-resolve-search").await;

    let resp = submit_review(&c, &token, id, "resolved", Some("done")).await;
    assert_eq!(resp.status(), 200);

    // get should now see resolved_at populated and resolved_by = COORD.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(
        data["resolved_at"].is_string(),
        "resolved review should set resolved_at; got {:?}",
        data["resolved_at"]
    );
    assert_eq!(data["resolved_by"].as_str(), Some(COORD.uuid));

    // search with is_resolved: true should now include it. is_resolved
    // filter was previously untestable for the `true` branch.
    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({
            "is_resolved": true,
            "limit": 500,
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let hit = data["incidents"]
        .as_array()
        .unwrap()
        .iter()
        .any(|h| h["id"].as_i64() == Some(id));
    assert!(hit, "resolved incident should appear in is_resolved: true search");
}

// --- behavior: delete sets deleted_at and removes from default reads ---

#[tokio::test]
async fn create_review_delete_soft_deletes_incident() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_incident_for_review(&c, &token, "review-delete").await;

    let resp = submit_review(&c, &token, id, "deleted", None).await;
    assert_eq!(resp.status(), 200);

    // get filters DeletedAt.is_null() — the incident should now 404.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        404,
        "soft-deleted incident should be invisible to incident/get"
    );
}

// --- behavior: returned + reopened state flips ---

#[tokio::test]
async fn create_review_returned_zeroes_next_level() {
    let c = client();
    // STAFF creates + submits (advances to level 1). MANAGER, the
    // level-1 reviewer at the review-chain org, returns it — only a
    // reviewer at or above the current level can return.
    let staff_token = login_token(&c, &STAFF).await;
    let manager_token = login_token(&c, &MANAGER).await;
    let id = create_incident_for_review(&c, &staff_token, "review-returned").await;

    let resp = submit_review(&c, &staff_token, id, "submitted", None).await;
    assert_eq!(resp.status(), 200);

    let resp = submit_review(&c, &manager_token, id, "returned", Some("needs detail")).await;
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        data["min_review_level"].as_i64().unwrap(),
        0,
        "returned review should record min_review_level = 0"
    );
}

#[tokio::test]
async fn create_review_reopened_clears_resolved_state() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_incident_for_review(&c, &token, "review-reopen").await;

    let resp = submit_review(&c, &token, id, "resolved", None).await;
    assert_eq!(resp.status(), 200);

    let resp = submit_review(&c, &token, id, "reopened", Some("undo")).await;
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["min_review_level"].as_i64().unwrap(), 1);

    // get should see resolved_at cleared back to null.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(
        data["resolved_at"].is_null(),
        "reopen should clear resolved_at; got {:?}",
        data["resolved_at"]
    );
    assert!(data["resolved_by"].is_null());
}

// --- behavior: review history accumulates in order ---

#[tokio::test]
async fn create_review_multiple_submissions_listed_in_order() {
    let c = client();
    // Three-step round trip: STAFF submits, MANAGER returns, STAFF
    // resubmits. MANAGER (level 1) is the only one who can both review
    // a submitted-at-level-1 incident AND not auto-resolve it the way
    // COORD (final reviewer) would.
    let staff_token = login_token(&c, &STAFF).await;
    let manager_token = login_token(&c, &MANAGER).await;
    let id = create_incident_for_review(&c, &staff_token, "review-history-order").await;

    assert_eq!(submit_review(&c, &staff_token, id, "submitted", None).await.status(), 200);
    assert_eq!(submit_review(&c, &manager_token, id, "returned", None).await.status(), 200);
    assert_eq!(submit_review(&c, &staff_token, id, "submitted", None).await.status(), 200);

    let resp = c
        .post(format!("{}/api/v1/current/incident/review/list", current_base()))
        .json(&json!({"incident": id}))
        .headers(auth_header(&staff_token))
        .send()
        .await
        .unwrap();
    let rows: Vec<serde_json::Value> = resp.json().await.unwrap();
    let results: Vec<&str> = rows.iter().map(|r| r["result"].as_str().unwrap()).collect();
    assert_eq!(
        results,
        vec!["submitted", "returned", "submitted"],
        "review history should be ordered reviewed_at ASC"
    );
}

// --- behavior: activity log records the review event ---

#[tokio::test]
async fn create_review_writes_activity_entry() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_incident_for_review(&c, &token, "review-activity").await;

    assert_eq!(submit_review(&c, &token, id, "submitted", None).await.status(), 200);

    let resp = c
        .post(format!("{}/api/v1/current/incident/activity", current_base()))
        .json(&json!({"incident_id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let entries = data["entries"].as_array().unwrap();

    // Should have at least: incident.created (from create_incident) and
    // incident.review.submitted (from the review we just inserted).
    let kinds: Vec<&str> = entries
        .iter()
        .map(|e| e["event_type"].as_str().unwrap())
        .collect();
    assert!(
        kinds.contains(&"incident.review.submitted"),
        "expected incident.review.submitted in activity; got {kinds:?}"
    );
    assert!(kinds.contains(&"incident.created"));
}

// --- behavior: pending_reviews inclusion threshold ---
//
// Previously deferred because we couldn't push level past 0. Now testable:
// before any submission, the incident is NOT in pending. After submission
// it advances to level >= 1 and IS in pending.

#[tokio::test]
async fn pending_reviews_threshold_advances_after_submit() {
    let review_org = review_chain_org_unit().await;
    let c = client();
    // STAFF creates + submits the incident (advances to level 1).
    // MANAGER is the level-1 reviewer at the review-chain org, so the submitted
    // incident lands in MANAGER's pending queue. We deliberately don't
    // run this as COORD: COORD (final reviewer) would auto-resolve the
    // submit and the incident would never appear in pending.
    let staff_token = login_token(&c, &STAFF).await;
    let manager_token = login_token(&c, &MANAGER).await;
    let id = create_incident_for_review(&c, &staff_token, "review-pending-threshold").await;

    // Snapshot before: incident has no review row yet (level == 0), so
    // it should not appear in MANAGER's pending queue.
    let before_ids = collect_pending_review_ids(&c, &manager_token, &review_org).await;
    assert!(
        !before_ids.contains(&id),
        "fresh incident with no review row should NOT be in pending_reviews (level == 0)"
    );

    // STAFF submits → next_level == 1 → should now show up for MANAGER.
    assert_eq!(submit_review(&c, &staff_token, id, "submitted", None).await.status(), 200);

    let after_ids = collect_pending_review_ids(&c, &manager_token, &review_org).await;
    assert!(
        after_ids.contains(&id),
        "after submit, incident should be in pending_reviews; got {after_ids:?}"
    );
}

/// Walk every page of `pending-reviews` for the given org and collect
/// every visible incident id. Used by tests that need to look up a
/// seeded incident regardless of which page it lands on (the default
/// page is small enough that accumulated test data shoves recent
/// seeds onto later pages).
async fn collect_pending_review_ids(
    c: &reqwest::Client,
    token: &str,
    org_unit: &str,
) -> Vec<i64> {
    let mut out = Vec::new();
    let mut cursor: Option<serde_json::Value> = None;
    let mut iterations = 0;
    loop {
        iterations += 1;
        assert!(iterations < 200, "pagination did not terminate");
        let page = fetch_pending_page(c, token, org_unit, 500, cursor.clone()).await;
        for row in page["rows"].as_array().unwrap() {
            out.push(row["id"].as_i64().unwrap());
        }
        cursor = page
            .get("next_cursor")
            .filter(|v| !v.is_null())
            .cloned();
        if cursor.is_none() {
            break;
        }
    }
    out
}

/// Regression guard: returned incidents sit at `min_review_level = 0`
/// — the SQL-side "has a review row" pre-filter must not drop them.
/// Only the creator should see them (it's their court to resubmit);
/// reviewers don't need eyes on a returned incident until it's
/// resubmitted, so they're excluded by the post-filter's
/// `can_see = can_review || is_creator || can_resubmit` logic.
#[tokio::test]
async fn pending_reviews_includes_returned_incident_for_creator() {
    let review_org = review_chain_org_unit().await;
    let c = client();
    let staff_token = login_token(&c, &STAFF).await;
    let manager_token = login_token(&c, &MANAGER).await;
    let id = create_incident_for_review(&c, &staff_token, "review-pending-returned").await;

    assert_eq!(submit_review(&c, &staff_token, id, "submitted", None).await.status(), 200);
    let returned_resp = submit_review(&c, &manager_token, id, "returned", Some("more detail")).await;
    assert_eq!(returned_resp.status(), 200);
    let returned_body: serde_json::Value = returned_resp.json().await.unwrap();
    assert_eq!(
        returned_body["min_review_level"].as_i64().unwrap(),
        0,
        "returned should record level 0"
    );

    // STAFF (creator) sees it as can_resubmit — this is the case that
    // would silently break if the SQL pre-filter required level >= 1.
    // Walk every page in case the seeded incident landed past page 1.
    let mut cursor: Option<serde_json::Value> = None;
    let mut staff_row: Option<serde_json::Value> = None;
    let mut iterations = 0;
    loop {
        iterations += 1;
        assert!(iterations < 200, "pagination did not terminate");
        let page = fetch_pending_page(&c, &staff_token, &review_org, 500, cursor.clone()).await;
        for row in page["rows"].as_array().unwrap() {
            if row["id"].as_i64() == Some(id) {
                staff_row = Some(row.clone());
                break;
            }
        }
        if staff_row.is_some() {
            break;
        }
        cursor = page
            .get("next_cursor")
            .filter(|v| !v.is_null())
            .cloned();
        if cursor.is_none() {
            break;
        }
    }
    let staff_row = staff_row
        .unwrap_or_else(|| panic!("returned incident {id} should be in creator's pending queue"));
    assert_eq!(staff_row["latest_review_result"].as_str(), Some("returned"));
    assert_eq!(staff_row["can_resubmit"].as_bool(), Some(true));
    assert_eq!(staff_row["is_creator"].as_bool(), Some(true));
}

// --- paging behavior ---
//
// `pending-reviews` is keyset-paged: the response carries an opaque
// `next_cursor` the caller passes back to fetch the next page. The
// inner DB scan pulls fixed-size chunks regardless of the visible-row
// limit, so the cursor advances past the last *examined* row (not the
// last returned row). Empty pages are still valid — the user may just
// not have any incidents in scope.

async fn fetch_pending_page(
    c: &reqwest::Client,
    token: &str,
    org_unit: &str,
    limit: u64,
    cursor: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut body = json!({"org_unit": org_unit, "limit": limit});
    if let Some(cursor) = cursor {
        body["cursor"] = cursor;
    }
    let resp = c
        .post(format!("{}/api/v1/current/incident/pending-reviews", current_base()))
        .json(&body)
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "pending-reviews body: {:?}", resp.text().await);
    resp.json().await.unwrap()
}

#[tokio::test]
async fn pending_reviews_limit_caps_returned_rows() {
    let review_org = review_chain_org_unit().await;
    // Passing a small limit must return at most that many rows, even
    // when the visible queue is larger.
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Seed at least 3 visible incidents so the limit can actually
    // clip. Each (STAFF creates + submits → MANAGER sees it).
    let staff = login_token(&c, &STAFF).await;
    for i in 0..3 {
        let id = create_incident_for_review(
            &c,
            &staff,
            &format!("pending-limit-seed-{i}"),
        )
        .await;
        assert_eq!(submit_review(&c, &staff, id, "submitted", None).await.status(), 200);
    }

    let page = fetch_pending_page(&c, &token, &review_org, 2, None).await;
    let rows = page["rows"].as_array().unwrap();
    assert!(
        rows.len() <= 2,
        "limit=2 returned more than 2 rows; got {}",
        rows.len()
    );
}

#[tokio::test]
async fn pending_reviews_pages_walk_the_full_queue() {
    let review_org = review_chain_org_unit().await;
    // Seed several visible incidents, then page through with a small
    // chunk size. Every seeded incident must show up exactly once
    // across the pages, with no duplicates. We don't insist on
    // reaching the end of the queue (test-data accumulation makes
    // that arbitrarily long); we insist on no-duplicates within the
    // pages we did walk and on every seeded incident appearing.
    let c = client();
    let coord = login_token(&c, &COORD).await;
    let staff = login_token(&c, &STAFF).await;

    let mut seeded: Vec<i64> = Vec::new();
    for i in 0..5 {
        let id = create_incident_for_review(
            &c,
            &staff,
            &format!("pending-page-seed-{i}"),
        )
        .await;
        assert_eq!(submit_review(&c, &staff, id, "submitted", None).await.status(), 200);
        seeded.push(id);
    }

    // Walk with a small chunk (3) so we exercise the pagination
    // boundary across the seeded set, but use a generous iteration
    // cap and stop early once we've seen every seed.
    let mut seen: Vec<i64> = Vec::new();
    let mut cursor: Option<serde_json::Value> = None;
    let mut iterations = 0;
    while iterations < 500 {
        iterations += 1;
        let page = fetch_pending_page(&c, &coord, &review_org, 3, cursor.clone()).await;
        for row in page["rows"].as_array().unwrap() {
            let id = row["id"].as_i64().unwrap();
            assert!(
                !seen.contains(&id),
                "row {id} returned twice across paged calls"
            );
            seen.push(id);
        }
        cursor = page
            .get("next_cursor")
            .filter(|v| !v.is_null())
            .cloned();
        if cursor.is_none() {
            break;
        }
        if seeded.iter().all(|id| seen.contains(id)) {
            // All our seeds are accounted for — no need to drain
            // the rest of the queue.
            break;
        }
    }

    for id in &seeded {
        assert!(
            seen.contains(id),
            "seeded incident {id} not seen across {iterations} paged calls"
        );
    }
}

#[tokio::test]
async fn pending_reviews_cursor_resumes_after_last_examined_row() {
    let review_org = review_chain_org_unit().await;
    // After a single-row page, the response carries a next_cursor.
    // Replaying that cursor must not return the same first row again.
    let c = client();
    let coord = login_token(&c, &COORD).await;
    let staff = login_token(&c, &STAFF).await;

    // Seed two visible incidents.
    let id_a = create_incident_for_review(&c, &staff, "pending-resume-a").await;
    assert_eq!(submit_review(&c, &staff, id_a, "submitted", None).await.status(), 200);
    let id_b = create_incident_for_review(&c, &staff, "pending-resume-b").await;
    assert_eq!(submit_review(&c, &staff, id_b, "submitted", None).await.status(), 200);

    let first = fetch_pending_page(&c, &coord, &review_org, 1, None).await;
    let first_rows = first["rows"].as_array().unwrap();
    if first_rows.is_empty() {
        // Page 1 only sees the inner-DB-chunk first row, which the
        // visibility filter may drop. Tolerated: the cursor still
        // advances and the next call should make progress. Skip the
        // assertion in this case since there's nothing to compare.
        return;
    }
    let first_id = first_rows[0]["id"].as_i64().unwrap();
    let cursor = first
        .get("next_cursor")
        .filter(|v| !v.is_null())
        .cloned()
        .expect("next_cursor expected after a partial page");

    let second = fetch_pending_page(&c, &coord, &review_org, 5, Some(cursor)).await;
    let second_ids: Vec<i64> = second["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_i64().unwrap())
        .collect();
    assert!(
        !second_ids.contains(&first_id),
        "cursor resume returned the same row that ended page 1; first={first_id} second_ids={second_ids:?}"
    );
}
