use integration_tests::*;
use serde_json::json;

/// Resolve an org unit's uuid by code (fresh client + cached admin token).
async fn unit_by_code(code: &str) -> String {
    let c = client();
    let token = admin_token(&c).await;
    unit_uuid_by_code(&c, &token, code).await
}

/// Main Street Branch — the e2e-seeded org unit with a review chain
/// configured, resolved to its uuid at runtime.
async fn test_org_unit() -> String {
    unit_by_code("MAIN").await
}

/// Helper for tests in this module that need a fresh incident to operate
/// on. Returns the created incident id.
async fn create_test_incident(
    c: &reqwest::Client,
    token: &str,
    title: &str,
) -> i64 {
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": title,
            "description": "Created by integration test",
        }))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "create_test_incident: expected 200, got {}", resp.status());
    let data: serde_json::Value = resp.json().await.unwrap();
    data["id"].as_i64().expect("incident id in create response")
}

// ============================================================================
// TODO — back-fill behavioral coverage now that incidents can be created
// ============================================================================
//
// The tests below were initially shape/auth-only because no incident seed
// data existed. With `create_test_incident` available, the following gaps
// can now be closed without waiting on more endpoint ports. (Items that
// still need future endpoints are flagged.)
//
// ## get_incident (read-side decoration)
//
// - Verify `created_by_name` is populated from odo-auth: create with COORD,
//   fetch back, assert `created_by_name == "E2E Coordinator"`.
// - Verify `code` and `label` are populated from odo-org for the
//   `TEST_ORG_UNIT` — assert `code == "MAIN"`, `label == "Main Street Branch"`.
// - Verify `template_ids` round-trips when create includes `template_ids`.
//   Requires a known-good template id; pull one via `/template/list` first.
// - Verify the `with_external_links` flag toggles the inclusion correctly
//   when the incident was created with metadata.external_links (the
//   create_incident_with_metadata_persists_clean_metadata test partly
//   covers this, but a dedicated negative test — "create with links,
//   fetch *without* the include flag, expect no `external_links` field" —
//   would lock in the behavior).
// - **External-party round-trip** (regression for the bug fixed when
//   incident.create landed): create with a party_type="external" +
//   external_name, fetch with `with_involved_parties: true`, assert
//   `parties[0].external_name` is populated. There's a test for this
//   already but it could be tightened to also assert external_contact.
//
// ## search_incidents (filters previously untestable)
//
// Most of the originally-deferred coverage was implemented when the
// back-fill PR added decoration / search / activity tests, and again when
// incidents.review.create landed (see tests/current/reviews.rs for the
// review-flow assertions including the previously-blocked
// is_resolved/soft-delete/pending-reviews-threshold paths).
//
// What remains:
//
// - `patron` filter on search: create with an involved patron, search
//   with `patron: patron_id`, assert result. Testable today via the
//   unknown-patron path; will be cleaner once `patron.create` lands.
// - `has_active_bans` / `has_active_trespass` filters on search:
//   blocked on `ban.create` (phase 3).
// - Multi-user pending_reviews coverage: COORD viewing an incident
//   created by COORD has `is_creator=true`, so the "can_review: true on
//   someone else's incident" branch isn't exercised. Needs a test that
//   logs in as STAFF (to create) then COORD (to review). Mechanically
//   easy now that we have review.create — just hasn't been written.

// ============================================================================

// --- create_incident ---

#[tokio::test]
async fn create_incident_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "test",
            "description": "test",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn create_incident_minimal_succeeds() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "Minimal incident",
            "description": "Created by integration test",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["id"].as_i64().is_some(), "expected id in response");
    assert!(data["created_at"].is_string(), "expected created_at timestamp");
    assert!(data["occurred_at"].is_string(), "expected occurred_at timestamp");
}

#[tokio::test]
async fn create_incident_roundtrips_through_get() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let id = create_test_incident(&c, &token, "Roundtrip test").await;

    // Fetch it back via incident/get.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["id"].as_i64().unwrap(), id);
    assert_eq!(data["title"].as_str().unwrap(), "Roundtrip test");
    assert_eq!(data["org_unit"].as_str().unwrap(), test_org_unit().await);
    assert_eq!(
        data["description"].as_str().unwrap(),
        "Created by integration test"
    );
}

#[tokio::test]
async fn create_incident_with_metadata_persists_clean_metadata() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Metadata includes external_links (special-cased — should NOT end up
    // in the persisted metadata blob) plus a regular custom field.
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "With metadata",
            "description": "test",
            "metadata": {
                "custom_note": "preserved",
                "external_links": [
                    {"url": "/path/to/thing", "title": "Doc"}
                ],
            }
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    // Fetch with includes; external_links should be returned via their
    // own field, NOT via metadata.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id, "options": {"with_external_links": true}}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();

    // metadata round-trips as a real JSON object. The create path's
    // `extract_special_metadata` strips `external_links` out — they
    // live in their own table and are surfaced via the top-level
    // `external_links` array instead.
    let meta = &data["metadata"];
    assert_eq!(meta["custom_note"].as_str().unwrap(), "preserved");
    assert!(
        meta.get("external_links").is_none(),
        "external_links should be stripped from persisted metadata; got {meta:?}"
    );

    // External links should be present at the top level.
    let links = data["external_links"].as_array().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["url"].as_str().unwrap(), "/path/to/thing");
    assert_eq!(links[0]["title"].as_str().unwrap(), "Doc");
}

#[tokio::test]
async fn create_incident_with_involved_parties() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "With parties",
            "description": "test",
            "involved_parties": [
                {
                    "party_type": "external",
                    "external_name": "Jane Witness",
                    "role": "witness",
                }
            ]
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    // Verify via get with the include.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id, "options": {"with_involved_parties": true}}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();


    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();

    println!("\n{data}\n");

    let parties = data["involved_parties"].as_array().unwrap();
    assert_eq!(parties.len(), 1);
    assert_eq!(parties[0]["party_type"].as_str().unwrap(), "external");
    assert_eq!(
        parties[0]["external_name"].as_str().unwrap(),
        "Jane Witness"
    );
}

#[tokio::test]
async fn create_incident_with_unknown_patron_party_creates_patron() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "Unknown patron",
            "description": "test",
            "involved_parties": [
                {
                    "party_type": "patron",
                    "is_unknown_patron": true,
                }
            ]
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id, "options": {"with_involved_parties": true}}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let parties = data["involved_parties"].as_array().unwrap();
    assert_eq!(parties.len(), 1);
    assert_eq!(parties[0]["party_type"].as_str().unwrap(), "patron");
    assert!(
        parties[0]["patron_id"].as_i64().is_some(),
        "an unknown_patron party should have a newly-created patron_id"
    );
    assert_eq!(parties[0]["is_unknown_patron"].as_bool(), Some(true));
}

#[tokio::test]
async fn create_incident_rejects_missing_required_fields() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({"org_unit": test_org_unit().await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for missing title/description, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn create_incident_accepts_stringified_metadata() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // The UI's transformToData calls JSON.stringify on metadata, so
    // the wire sometimes carries `metadata: "{...}"` instead of
    // `metadata: {...}`. The server unwraps the outer string via the
    // shared `deserialize_metadata` and persists a real JSON object —
    // no quoting layers piled on for the round-trip.
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "Stringified meta",
            "description": "test",
            "metadata": "{\"custom_note\":\"works\"}",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        data["metadata"],
        json!({"custom_note": "works"}),
        "metadata should round-trip as a real JSON object, not a string"
    );
}

#[tokio::test]
async fn get_incident_requires_auth() {
    let c = client();

    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": 1}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn get_incident_not_found() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Use a deliberately huge ID that should not exist.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn get_incident_rejects_missing_id() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    // Axum's Json extractor returns 422 for malformed/missing-required-field bodies.
    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for missing id, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn get_incident_rejects_wrong_type() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": "not-a-number"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for wrong id type, got {}",
        resp.status()
    );
}

// --- search_incidents ---

#[tokio::test]
async fn search_incidents_requires_auth() {
    let c = client();

    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn search_incidents_empty_request_returns_envelope() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();

    assert!(data["incidents"].is_array(), "expected `incidents` array");
    assert!(data["total_count"].is_u64(), "expected numeric `total_count`");
}

#[tokio::test]
async fn search_incidents_respects_limit() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({"limit": 5}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();
    let count = data["incidents"].as_array().unwrap().len();
    assert!(count <= 5, "expected at most 5 rows, got {count}");
}

#[tokio::test]
async fn search_incidents_org_unit_filter() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Main Street Branch is the e2e-seeded review-chain org. If any
    // incidents exist for it, all results should fall under that subtree.
    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({"org_unit": test_org_unit().await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["incidents"].is_array());
    assert!(data["total_count"].is_u64());
}

// --- get_activity ---

#[tokio::test]
async fn get_activity_requires_auth() {
    let c = client();

    let resp = c
        .post(format!("{}/api/v1/current/incident/activity", current_base()))
        .json(&json!({"incident_id": 1}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn get_activity_unknown_incident_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/activity", current_base()))
        .json(&json!({"incident_id": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn get_activity_rejects_missing_incident_id() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/activity", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for missing incident_id, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn search_incidents_unknown_org_unit_returns_zero() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // A nonsensical org_unit id should still return a valid envelope with
    // zero results — odo-org's descendants endpoint will 404 or return empty.
    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({"org_unit": "00000000-0000-4000-a000-00000000dead"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    // An org uuid that doesn't resolve is a 404 from the perm check
    // (403 kept for compatibility with permission-denied responses).
    assert!(resp.status() == 404 || resp.status() == 403, "got {}", resp.status());
}

// ============================================================================
// Back-fill: behavioral coverage now that incidents can be created.
//
// These tests assert real wire-level effects rather than just envelope
// shape. Each creates its own fixture data via `create_test_incident` (or
// an inline variant) — there's no shared state between tests, so they're
// safe to run in any order or in parallel.
// ============================================================================

/// Parent of Main Street Branch in the seeded org tree. Used to prove that
/// `incident/search` walks descendants when a non-leaf org_unit is given.
/// East Region — the parent region of Main Street Branch.
async fn parent_org_unit() -> String {
    unit_by_code("ERG").await
}

// --- get_incident: decoration & name resolution ---

#[tokio::test]
async fn get_incident_decorations_resolved() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let id = create_test_incident(&c, &token, "decoration-test").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();

    // odo-auth resolution — the creator's display_name comes from
    // /api/v1/odo/auth/user/get.
    assert_eq!(
        data["created_by_name"].as_str(),
        Some("E2E Coordinator"),
        "created_by_name should be resolved via odo-auth"
    );

    // odo-org resolution — the branch's code/label come from
    // /api/v1/odo/org/unit/{id}. These prove the cross-service lookup chain.
    assert_eq!(data["code"].as_str(), Some("MAIN"), "org code should be resolved");
    assert_eq!(
        data["label"].as_str(),
        Some("Main Street Branch"),
        "org label should be resolved"
    );

    // A brand-new incident has no template_ids — assert the field exists
    // as an array (not null) so consumers that iterate it don't blow up.
    assert!(
        data["template_ids"].is_array(),
        "template_ids should always be an array"
    );
    assert_eq!(data["template_ids"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn get_incident_external_link_include_toggles() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Create with an external link in metadata.
    let create_resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "link-include-test",
            "description": "test",
            "metadata": {
                "external_links": [
                    {"url": "/some/path", "title": "Linked Doc"}
                ]
            }
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(create_resp.status(), 200);
    let id = create_resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    // Fetch WITHOUT the include flag: external_links should be absent
    // (skip_serializing_if = "Option::is_none" on the response field).
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(
        data.get("external_links").is_none(),
        "external_links should not be in the response when the include flag is off; got {:?}",
        data.get("external_links")
    );

    // Fetch WITH the include flag: external_links should be present and
    // populated (proves the link was actually persisted by create).
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id, "options": {"with_external_links": true}}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let links = data["external_links"].as_array().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["url"].as_str().unwrap(), "/some/path");
}

#[tokio::test]
async fn get_incident_external_party_contact_round_trips() {
    // Regression: the read-side InvolvedPartyResponse was silently dropping
    // external_name / external_contact before incident.create landed.
    let c = client();
    let token = login_token(&c, &COORD).await;

    let create_resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "external-contact-test",
            "description": "test",
            "involved_parties": [
                {
                    "party_type": "external",
                    "external_name": "Pat Witness",
                    "external_contact": "555-0100",
                    "role": "witness",
                }
            ]
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let id = create_resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id, "options": {"with_involved_parties": true}}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let parties = data["involved_parties"].as_array().unwrap();
    assert_eq!(parties.len(), 1);
    assert_eq!(
        parties[0]["external_name"].as_str(),
        Some("Pat Witness"),
        "external_name must round-trip through create→get"
    );
    assert_eq!(
        parties[0]["external_contact"].as_str(),
        Some("555-0100"),
        "external_contact must round-trip through create→get"
    );
}

// --- search_incidents: filters, sort, pagination, descendant expansion ---

#[tokio::test]
async fn search_incidents_query_filter() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Distinguish with a unique substring no other test would produce.
    let needle = "ZWAYNE_QUERY_TEST_TOKEN_99";
    let needle_title = format!("incident with {needle} marker");
    let _matching_id = create_test_incident(&c, &token, &needle_title).await;
    let _decoy_id = create_test_incident(&c, &token, "decoy without marker").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({"query": needle, "limit": 50}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let hits = data["incidents"].as_array().unwrap();

    // Only the needle-bearing incident should match (the token is unique
    // enough that no other test fixture should collide).
    assert!(
        !hits.is_empty(),
        "expected at least one match for the unique query token"
    );
    for hit in hits {
        let title = hit["title"].as_str().unwrap();
        assert!(
            title.contains(needle),
            "search returned a non-matching title: {title}"
        );
    }
}

#[tokio::test]
async fn search_incidents_descendant_expansion() {
    // Prove that searching at a non-leaf org_unit returns incidents from
    // its descendants. Create at TEST_ORG_UNIT (Main Street Branch),
    // search at its parent region.
    let c = client();
    let token = login_token(&c, &COORD).await;

    let id = create_test_incident(&c, &token, "descendant-search-test").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({"org_unit": parent_org_unit().await, "limit": 500}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let hits = data["incidents"].as_array().unwrap();

    let found = hits.iter().any(|h| h["id"].as_i64() == Some(id));
    assert!(
        found,
        "incident created at the branch should be visible \
         when searching at its parent region; proves \
         odo-org descendant expansion is wired correctly"
    );
}

#[tokio::test]
async fn search_incidents_occurred_window_filter() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Create two incidents with known occurred_at: one in 2026, one in 2024.
    let recent = "2026-08-15T12:00:00+00:00";
    let old = "2024-01-15T12:00:00+00:00";

    let recent_resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "window-test recent",
            "description": "x",
            "occurred_at": recent,
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let recent_id = recent_resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let old_resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "window-test old",
            "description": "x",
            "occurred_at": old,
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let old_id = old_resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    // Window covering 2025-2027 — should include `recent`, exclude `old`.
    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({
            "occurred_after": "2025-01-01T00:00:00+00:00",
            "occurred_before": "2027-01-01T00:00:00+00:00",
            "limit": 500,
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let hits: Vec<i64> = data["incidents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["id"].as_i64().unwrap())
        .collect();

    assert!(
        hits.contains(&recent_id),
        "recent incident ({recent_id}) should be in the 2025-2027 window"
    );
    assert!(
        !hits.contains(&old_id),
        "old incident ({old_id}, occurred 2024) should NOT be in the 2025-2027 window"
    );
}

#[tokio::test]
async fn search_incidents_sort_by_occurred_date() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Create two with known relative ordering. Use widely-separated dates
    // and a per-run unique title token so the filter returns exactly the
    // two rows from *this* run (without it, accumulated test data from
    // prior runs floods the result and pushes our pair past the limit).
    let token_tag = format!(
        "SORT_TEST_TAG_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let earlier = format!("{token_tag} earlier");
    let later = format!("{token_tag} later");

    let earlier_resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": earlier,
            "description": "x",
            "occurred_at": "2026-01-01T00:00:00+00:00",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let earlier_id = earlier_resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let later_resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": later,
            "description": "x",
            "occurred_at": "2026-12-31T00:00:00+00:00",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let later_id = later_resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    // Ascending by occurred_at: earlier first.
    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({
            "query": token_tag,
            "sort_incident_date": true,
            "sort_dir": "asc",
            "limit": 50,
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let ids: Vec<i64> = data["incidents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["id"].as_i64().unwrap())
        .collect();
    let earlier_pos = ids.iter().position(|i| *i == earlier_id);
    let later_pos = ids.iter().position(|i| *i == later_id);
    assert!(earlier_pos.is_some() && later_pos.is_some());
    assert!(
        earlier_pos < later_pos,
        "ascending sort_incident_date should put 2026-01 ({earlier_id}) before 2026-12 ({later_id}); got {ids:?}"
    );

    // Descending: later first.
    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({
            "query": token_tag,
            "sort_incident_date": true,
            "sort_dir": "desc",
            "limit": 50,
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let ids: Vec<i64> = data["incidents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["id"].as_i64().unwrap())
        .collect();
    let earlier_pos = ids.iter().position(|i| *i == earlier_id);
    let later_pos = ids.iter().position(|i| *i == later_id);
    assert!(earlier_pos.is_some() && later_pos.is_some());
    assert!(
        later_pos < earlier_pos,
        "descending sort_incident_date should put 2026-12 ({later_id}) before 2026-01 ({earlier_id}); got {ids:?}"
    );
}

#[tokio::test]
async fn search_incidents_pagination() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Use a unique token so we can scope to just our fixture rows.
    let tag = "PAGINATION_TEST_TAG_XYZ";
    let n = 3;
    for i in 0..n {
        create_test_incident(&c, &token, &format!("{tag} #{i}")).await;
    }

    let resp = c
        .post(format!("{}/api/v1/current/incident/search", current_base()))
        .json(&json!({"query": tag, "limit": n - 1}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let returned = data["incidents"].as_array().unwrap().len();
    let total = data["total_count"].as_u64().unwrap();

    assert_eq!(
        returned,
        (n - 1) as usize,
        "with limit={}, should return exactly that many rows",
        n - 1
    );
    assert!(
        total >= n as u64,
        "total_count should reflect all {n} fixture rows (got {total}); limit only constrains the page"
    );
}

// --- get_activity: actor & org-unit decoration ---

#[tokio::test]
async fn get_activity_decorates_creation_event() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let id = create_test_incident(&c, &token, "activity-decoration-test").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/activity", current_base()))
        .json(&json!({"incident_id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let entries = data["entries"].as_array().unwrap();

    assert!(
        !entries.is_empty(),
        "newly-created incident should have at least one activity entry"
    );

    // Find the `incident.created` row. There may be only one entry, but
    // be explicit so the test doesn't false-pass if the order changes.
    let created = entries
        .iter()
        .find(|e| e["event_type"].as_str() == Some("incident.created"))
        .expect("expected an incident.created activity entry");

    // odo-auth resolution.
    assert_eq!(
        created["actor_name"].as_str(),
        Some("E2E Coordinator"),
        "actor_name should be resolved via odo-auth"
    );

    // odo-org resolution.
    assert_eq!(
        created["org_unit_name"].as_str(),
        Some("Main Street Branch"),
        "org_unit_name should be resolved via odo-org"
    );

    // event_data should carry the title the legacy handler logs.
    assert_eq!(
        created["event_data"]["title"].as_str(),
        Some("activity-decoration-test"),
        "event_data.title should match the created incident title"
    );

    // incident_id linkage.
    assert_eq!(created["incident_id"].as_i64(), Some(id));
}

// ============================================================================
// update_incident
// ============================================================================

async fn get_incident(
    c: &reqwest::Client,
    token: &str,
    id: i64,
    options: serde_json::Value,
) -> serde_json::Value {
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id, "options": options}))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    resp.json().await.unwrap()
}

async fn get_activity(c: &reqwest::Client, token: &str, id: i64) -> Vec<serde_json::Value> {
    let resp = c
        .post(format!("{}/api/v1/current/incident/activity", current_base()))
        .json(&json!({"incident_id": id}))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    data["entries"].as_array().cloned().unwrap_or_default()
}

#[tokio::test]
async fn update_incident_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": 1, "title": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn update_incident_unknown_id_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": 2_000_000_000_i64, "title": "x"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn update_incident_partial_fields_leaves_others_alone() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "update-partial-original-title").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "title": "update-partial-new-title"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["title"].as_str(), Some("update-partial-new-title"));
    // description left unchanged
    assert_eq!(
        data["description"].as_str(),
        Some("Created by integration test")
    );
    // org_unit not editable; should still be the original
    assert_eq!(data["org_unit"].as_str(), Some(test_org_unit().await.as_str()));
    // updated_at gets bumped on every call
    assert!(data["updated_at"].is_string());
}

#[tokio::test]
async fn update_incident_silently_ignores_org_unit_change() {
    // Security: legacy accepted an org_unit field on the update payload
    // and would relocate the incident, but the permission check ran
    // against the *old* org. The new endpoint drops the field entirely.
    // Stray clients still sending it should see their value silently
    // ignored — not an error — so they keep working.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "update-org-immutable").await;
    let original_org = test_org_unit().await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": id,
            "title": "still-here",
            "org_unit": unit_by_code("HILL").await,
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        data["org_unit"].as_str(),
        Some(original_org.as_str()),
        "update must not move incidents across orgs"
    );

    // Re-fetch to make sure the persisted row didn't move either.
    let reloaded = get_incident(&c, &token, id, json!({})).await;
    assert_eq!(reloaded["org_unit"].as_str(), Some(original_org.as_str()));
}

#[tokio::test]
async fn update_incident_is_resolved_true_sets_resolved_fields() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "update-resolve").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "is_resolved": true}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["resolved_at"].is_string());
    assert_eq!(data["resolved_by"].as_str(), Some(COORD.uuid));
}

#[tokio::test]
async fn update_incident_is_resolved_false_is_a_no_op_when_open() {
    // is_resolved=false isn't a reopen — to clear resolved_at, callers
    // go through review.create with result="reopened" so the chain
    // permission check applies. is_resolved=false on an open incident
    // should be silently ignored.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "update-resolve-false-noop").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "is_resolved": false, "title": "still-open"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["resolved_at"].is_null());
    assert_eq!(data["title"].as_str(), Some("still-open"));
}

#[tokio::test]
async fn update_incident_is_deleted_true_soft_deletes() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "update-delete").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "is_deleted": true}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // After soft-delete, get filters deleted_at.is_null() → 404.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404, "soft-deleted incident should be hidden");
}

#[tokio::test]
async fn update_incident_add_and_remove_involved_parties() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "update-parties").await;

    // Add one external party + one unknown-patron (creates a patron row).
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": id,
            "add_involved_parties": [
                {"party_type": "external", "external_name": "Officer Brown"},
                {"party_type": "patron", "is_unknown_patron": true},
            ],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);

    let after_add = get_incident(&c, &token, id, json!({"with_involved_parties": true})).await;
    let parties = after_add["involved_parties"].as_array().unwrap();
    assert_eq!(parties.len(), 2, "should have two parties; got {parties:?}");

    let unknown_patron_row = parties
        .iter()
        .find(|p| p["party_type"] == "patron")
        .expect("patron party");
    assert!(
        unknown_patron_row["patron_id"].as_i64().is_some(),
        "unknown-patron flow should have created and linked a patron row"
    );

    // Remove the external party; keep the patron party.
    let external_id = parties
        .iter()
        .find(|p| p["party_type"] == "external")
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": id,
            "remove_involved_parties": [external_id],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let after_remove = get_incident(&c, &token, id, json!({"with_involved_parties": true})).await;
    let parties = after_remove["involved_parties"].as_array().unwrap();
    assert_eq!(parties.len(), 1);
    assert_eq!(parties[0]["party_type"], "patron");
}

#[tokio::test]
async fn update_incident_remove_party_scoped_to_incident() {
    // Defense-in-depth: remove_involved_parties must filter on
    // incident_id so a caller can't delete another incident's party
    // rows by id-guessing.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id_a = create_test_incident(&c, &token, "update-party-scope-a").await;
    let id_b = create_test_incident(&c, &token, "update-party-scope-b").await;

    // Add a party to incident B.
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": id_b,
            "add_involved_parties": [
                {"party_type": "external", "external_name": "Belongs to B"},
            ],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let b_after_add = get_incident(&c, &token, id_b, json!({"with_involved_parties": true})).await;
    let b_party_id = b_after_add["involved_parties"][0]["id"].as_i64().unwrap();

    // Attempt to delete B's party while editing A: should be a no-op.
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": id_a,
            "remove_involved_parties": [b_party_id],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // B's party must still exist.
    let b_after = get_incident(&c, &token, id_b, json!({"with_involved_parties": true})).await;
    let b_parties = b_after["involved_parties"].as_array().unwrap();
    assert!(
        b_parties.iter().any(|p| p["id"].as_i64() == Some(b_party_id)),
        "incident A's update should not have been able to delete incident B's party"
    );
}

#[tokio::test]
async fn update_incident_add_and_remove_external_links() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "update-links").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": id,
            "add_external_links": [
                {"url": "https://example.com/a", "title": "A"},
                {"url": "https://example.com/b", "title": "B"},
            ],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let after_add = get_incident(&c, &token, id, json!({"with_external_links": true})).await;
    let links = after_add["external_links"].as_array().unwrap();
    assert_eq!(links.len(), 2);
    let link_a_id = links
        .iter()
        .find(|l| l["title"] == "A")
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": id,
            "remove_external_links": [link_a_id],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let after_remove = get_incident(&c, &token, id, json!({"with_external_links": true})).await;
    let links = after_remove["external_links"].as_array().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["title"], "B");
}

#[tokio::test]
async fn update_incident_metadata_round_trip_is_idempotent() {
    // Regression: the UI sends `metadata` pre-stringified
    // (`JSON.stringify({...})`). Without unwrapping on input, each save
    // adds a JSON quote layer and storage drifts toward `"\"{}\""` and
    // beyond. Repeated saves of the same payload must converge — once
    // a value lands in the DB, saving again with the round-tripped
    // value should produce the same stored shape.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "update-meta-roundtrip").await;

    // First save: empty-object payload, sent stringified like the UI.
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "metadata": "{}"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let after_first = get_incident(&c, &token, id, json!({})).await;
    let first_metadata = after_first["metadata"].clone();

    // Echo the value back as a second save. Without the deserializer
    // unwrap, this would add another layer of quoting.
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "metadata": first_metadata.clone()}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let after_second = get_incident(&c, &token, id, json!({})).await;
    assert_eq!(
        after_second["metadata"], first_metadata,
        "metadata round-trip must be idempotent; got {:?} → {:?}",
        first_metadata, after_second["metadata"],
    );
}

#[tokio::test]
async fn create_incident_with_attachment_file_upload_ids_round_trips() {
    // Phase 3b: attachments come through as already-uploaded
    // file_upload ids (the UI uploads via odo-asset first). We
    // shouldn't need to ship full file metadata in the request anymore.
    // get_incident with `with_attachments: true` should decorate via
    // odo-asset and return the same file the test uploaded.
    use reqwest::multipart;

    let c = client();
    let token = login_token(&c, &COORD).await;

    // Upload a tiny test file via odo-asset.
    let bytes = vec![0x89, 0x50, 0x4E, 0x47]; // PNG magic
    let part = multipart::Part::bytes(bytes).file_name("attach-rt.png");
    let form = multipart::Form::new()
        .part("file", part)
        .text("category", "photo")
        .text("entity_type", "incident");
    let upload_resp = c
        .post(format!("{}/api/v1/odo/asset/upload", asset_base()))
        .headers(auth_header(&token))
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(upload_resp.status(), 200);
    let file_upload_id = upload_resp.json::<serde_json::Value>().await.unwrap()["uuid"]
        .as_str()
        .unwrap()
        .to_string();

    // Create incident with the file_upload id bound as an attachment.
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "attachment-rt-fixture",
            "description": "incident with one attachment via file_upload_ids",
            "attachment_file_upload_ids": [file_upload_id],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let incident_id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    // get with the new with_attachments flag should return the file.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({
            "id": incident_id,
            "options": {"with_attachments": true},
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let attachments = data["attachments"].as_array().unwrap();
    assert_eq!(attachments.len(), 1, "expected one attachment; got {data:?}");
    let a = &attachments[0];
    assert_eq!(a["id"].as_str().map(String::from), Some(file_upload_id.clone()));
    assert_eq!(a["original_name"].as_str(), Some("attach-rt.png"));
    assert_eq!(a["mime_type"].as_str(), Some("image/png"));
    assert_eq!(a["category"].as_str(), Some("photo"));
    assert!(
        a["relative_path"].as_str().unwrap().contains("current/photos"),
        "expected the current/photos directory; got {:?}",
        a["relative_path"]
    );
}

#[tokio::test]
async fn update_incident_adds_and_removes_attachments() {
    // Verifies the edit-flow attachment binding: an incident created with
    // no attachments can have one added via update's
    // add_attachment_file_upload_ids, then removed via remove_attachment_ids
    // (keyed on the file_upload id, which is what incident/get returns).
    use reqwest::multipart;

    let c = client();
    let token = login_token(&c, &COORD).await;

    // Upload a file via odo-asset.
    let bytes = vec![0x89, 0x50, 0x4E, 0x47]; // PNG magic
    let part = multipart::Part::bytes(bytes).file_name("update-attach.png");
    let form = multipart::Form::new()
        .part("file", part)
        .text("category", "photo")
        .text("entity_type", "incident");
    let upload_resp = c
        .post(format!("{}/api/v1/odo/asset/upload", asset_base()))
        .headers(auth_header(&token))
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(upload_resp.status(), 200);
    let file_upload_id = upload_resp.json::<serde_json::Value>().await.unwrap()["uuid"]
        .as_str()
        .unwrap()
        .to_string();

    // Create an incident with no attachments.
    let incident_id = create_test_incident(&c, &token, "update-attach-fixture").await;

    // Update: bind the file as an attachment.
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": incident_id,
            "add_attachment_file_upload_ids": [file_upload_id],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);

    // get should now show one attachment.
    let attachments = get_incident_attachments(&c, &token, incident_id).await;
    assert_eq!(attachments.len(), 1, "expected one attachment after add");
    assert_eq!(attachments[0]["id"].as_str().map(String::from), Some(file_upload_id.clone()));

    // Update: remove it by file_upload id.
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": incident_id,
            "remove_attachment_ids": [file_upload_id],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);

    // get should now show zero attachments.
    let attachments = get_incident_attachments(&c, &token, incident_id).await;
    assert_eq!(attachments.len(), 0, "expected no attachments after remove");
}

/// Fetch an incident's attachments via `incident/get` with the
/// `with_attachments` option set.
async fn get_incident_attachments(
    c: &reqwest::Client,
    token: &str,
    incident_id: i64,
) -> Vec<serde_json::Value> {
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({
            "id": incident_id,
            "options": {"with_attachments": true},
        }))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    data["attachments"].as_array().cloned().unwrap_or_default()
}

#[tokio::test]
async fn create_incident_rejects_unknown_attachment_id() {
    // Bind-time validation: an attachment id that doesn't resolve in
    // odo-asset is rejected with a 400, not trusted (which would either
    // 500 on the FK or silently link a bogus row).
    let c = client();
    let token = login_token(&c, &COORD).await;

    // 2_000_000_000 is far beyond any real file_upload id.
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "bad-attachment-fixture",
            "description": "Created by integration test",
            "attachment_file_upload_ids": ["00000000-0000-4000-a000-00000000dead"],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        400,
        "expected 400 for unknown file id; body: {:?}",
        resp.text().await
    );
}

#[tokio::test]
async fn update_incident_rejects_unknown_attachment_id() {
    // Same bind-time validation on the update path's add list.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let incident_id = create_test_incident(&c, &token, "bad-attachment-update-fixture").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({
            "id": incident_id,
            "add_attachment_file_upload_ids": ["00000000-0000-4000-a000-00000000dead"],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        400,
        "expected 400 for unknown file id; body: {:?}",
        resp.text().await
    );

    // The incident must remain attachment-free — validation happens before
    // the txn, so nothing was written.
    let attachments = get_incident_attachments(&c, &token, incident_id).await;
    assert_eq!(attachments.len(), 0, "no attachment should have been bound");
}

#[tokio::test]
async fn create_incident_rejects_attachment_owned_by_another_user() {
    // Ownership gate: a file uploaded by one user cannot be bound by a
    // different user (files are uploaded and linked by the same person).
    // COORD uploads; MANAGER tries to bind it -> 400.
    use reqwest::multipart;

    let c = client();
    let coord_token = login_token(&c, &COORD).await;
    let manager_token = login_token(&c, &MANAGER).await;

    let bytes = vec![0x89, 0x50, 0x4E, 0x47]; // PNG magic
    let part = multipart::Part::bytes(bytes).file_name("foreign-file.png");
    let form = multipart::Form::new()
        .part("file", part)
        .text("category", "photo")
        .text("entity_type", "incident");
    let upload_resp = c
        .post(format!("{}/api/v1/odo/asset/upload", asset_base()))
        .headers(auth_header(&coord_token))
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(upload_resp.status(), 200);
    let file_upload_id = upload_resp.json::<serde_json::Value>().await.unwrap()["uuid"]
        .as_str()
        .unwrap()
        .to_string();

    // MANAGER (who has incident.incident.write, so this reaches the
    // ownership check rather than 403-ing first) tries to bind COORD's file.
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "foreign-attachment-fixture",
            "description": "Created by integration test",
            "attachment_file_upload_ids": [file_upload_id],
        }))
        .headers(auth_header(&manager_token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        400,
        "expected 400 binding another user's file; body: {:?}",
        resp.text().await
    );
}

#[tokio::test]
async fn create_incident_without_attachments_omits_attachments_key() {
    // Default-off: callers that don't opt in via with_attachments
    // should not see an `attachments` field in the response.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "no-attachments-default").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(
        data.get("attachments").is_none(),
        "attachments should be omitted when not opted in; got {data:?}"
    );
}

#[tokio::test]
async fn create_incident_with_pending_bans_creates_them_inline() {
    // Regression: legacy supported `metadata.pending_bans[]` to create
    // bans in the same transaction as the incident. The current port
    // used to silently no-op this with a warn; phase 3 wires it up to
    // bans::apply_pending_bans. Confirm the bans are in fact created
    // and surfaced via created_ban_ids.
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Create a one-off patron we can ban.
    let patron_resp = c
        .post(format!("{}/api/v1/current/patron/create", current_base()))
        .json(&json!({"first_name": "Inline-ban", "last_name": "Target"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(patron_resp.status(), 200);
    let patron_id = patron_resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "inline-bans-fixture",
            "description": "incident with inline pending_bans",
            "metadata": {
                "pending_bans": [
                    {"patron_ref": patron_id, "ban_type": "ban"}
                ]
            }
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    let created = data["created_ban_ids"].as_array().unwrap();
    assert_eq!(created.len(), 1, "expected exactly one created ban; got {data:?}");
    let ban_id = created[0].as_i64().unwrap();
    assert!(ban_id > 0);

    // The created ban should reference the new incident.
    let incident_id = data["id"].as_i64().unwrap();
    let resp = c
        .post(format!("{}/api/v1/current/ban/details", current_base()))
        .json(&json!({"ban_id": ban_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["ban"]["incident"].as_i64(), Some(incident_id));
    assert_eq!(data["ban"]["patron"].as_i64(), Some(patron_id));
}

#[tokio::test]
async fn update_incident_template_ids_full_replace() {
    // CRT-88 contract: passing `template_ids` is a full replace —
    // existing mappings are deleted and the new ids inserted.
    // Omitting the field leaves the mapping untouched.
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Seed with two templates.
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "update-templates-fixture",
            "description": "starts with two templates",
            "template_ids": [1, 2],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    // Update replaces [1, 2] with [1].
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "template_ids": [1]}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);

    let data = get_incident(&c, &token, id, json!({})).await;
    let ids: Vec<i64> = data["template_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![1], "template_ids should be replaced; got {ids:?}");

    // Title-only update (no `template_ids` key) must NOT clear the
    // mapping — None means "leave it alone", not "wipe it".
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "title": "title-only update"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let data = get_incident(&c, &token, id, json!({})).await;
    let ids: Vec<i64> = data["template_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    assert_eq!(
        ids,
        vec![1],
        "title-only update should not touch templates; got {ids:?}"
    );

    // Explicit empty array clears the mapping.
    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "template_ids": []}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let data = get_incident(&c, &token, id, json!({})).await;
    let ids: Vec<i64> = data["template_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    assert!(
        ids.is_empty(),
        "explicit empty template_ids should clear the mapping; got {ids:?}"
    );
}

#[tokio::test]
async fn update_incident_writes_activity_entry() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let id = create_test_incident(&c, &token, "update-activity-log").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/update", current_base()))
        .json(&json!({"id": id, "title": "edited-for-activity"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let entries = get_activity(&c, &token, id).await;
    let kinds: Vec<&str> = entries
        .iter()
        .map(|e| e["event_type"].as_str().unwrap())
        .collect();
    assert!(
        kinds.contains(&"incident.updated"),
        "expected incident.updated in activity; got {kinds:?}"
    );
    // Sanity: create event still there from the fixture.
    assert!(kinds.contains(&"incident.created"));
}
