use integration_tests::*;
use serde_json::json;

// ============================================================================
// TODO — back-fill behavioral coverage
// ============================================================================
//
// The ban-read tests below are shape/auth-only because creating bans is
// not yet possible (the ban-write endpoints — `ban.create`, `ban.extend`,
// `ban.archive`, `ban.letter.create` — are phase 3). Almost everything
// here is **blocked on phase 3**.
//
// ## What CAN be tested today, using `create_test_incident`
//
// - **`list_ban_letter_templates`**: nothing new — templates are global
//   and seeded independently of incidents.
//
// - **`list_bans` shape**: create an incident, search bans filtered by
//   that incident id, assert empty result (no bans created → nothing to
//   list). This verifies the join path doesn't crash on the
//   no-matching-bans case (currently un-exercised since we only test the
//   "unknown id" path).
//
// - **`get_ban_details` / `get_ban_activity` / `get_ban_letter`**: each
//   needs a ban row to fetch — no way to create one yet. Tests stay
//   error-path-only until phase 3.
//
// ## What unlocks after phase 3 (ban.create + ban.letter.create)
//
// - End-to-end ban flow: create incident → create ban → fetch
//   `ban/details`, assert the patron/incident/org_unit/created_by are
//   linked correctly and `created_by_name` (odo-auth) +
//   `org_unit_name` (odo-org) are resolved.
// - `list_bans` filters: create N bans across patrons/incidents/org_units,
//   exercise each filter (patron_id, incident_id, org_unit, limit) and
//   the `include_archived` flag.
// - **Trespass cross-location semantics**: create a trespass at one branch,
//   search at a sibling branch, assert it appears (proves the
//   `is_trespass = true OR org_unit IN scope` short-circuit).
// - `has_ban_letter` toggle: create ban (false), then create letter,
//   re-list and assert it flipped to true.
// - `get_ban_activity` decorations: create ban → add note/letter, fetch
//   activity, assert attachments/external_links/letter fields are
//   populated where applicable.
// - `get_ban_letter` happy path: create ban + letter, fetch the letter,
//   assert content matches what was inserted.

// ============================================================================

// --- list_ban_letter_templates ---

#[tokio::test]
async fn list_ban_letter_templates_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/letter/template/list", current_base()))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn list_ban_letter_templates_returns_envelope() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/letter/template/list", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["templates"].is_array(), "expected templates array");

    // If any templates exist, sanity-check the shape.
    if let Some(t) = data["templates"].as_array().and_then(|arr| arr.first()) {
        assert!(t["id"].as_i64().is_some());
        assert!(t["body"].as_str().is_some());
        assert!(t["is_default"].as_bool().is_some());
        assert!(t["is_trespass"].as_bool().is_some());
        assert!(t["operation_type"].as_str().is_some());
    }
}

// --- get_ban_details ---

#[tokio::test]
async fn get_ban_details_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/details", current_base()))
        .json(&json!({"ban_id": 1}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn get_ban_details_unknown_ban_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/details", current_base()))
        .json(&json!({"ban_id": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

// --- get_ban_activity ---

// --- list_bans ---

#[tokio::test]
async fn list_bans_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/list", current_base()))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn list_bans_empty_request_returns_envelope() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/list", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["bans"].is_array(), "expected `bans` array");
}

#[tokio::test]
async fn list_bans_respects_limit() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/list", current_base()))
        .json(&json!({"limit": 3}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let count = data["bans"].as_array().unwrap().len();
    assert!(count <= 3, "expected at most 3 rows, got {count}");
}

#[tokio::test]
async fn list_bans_org_unit_filter() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/list", current_base()))
        .json(&json!({"org_unit": ban_test_org_unit().await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["bans"].is_array());
}

#[tokio::test]
async fn list_bans_unknown_patron_returns_empty() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/list", current_base()))
        .json(&json!({"patron_id": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["bans"].as_array().unwrap().is_empty());
}

// --- get_ban_letter ---

#[tokio::test]
async fn get_ban_letter_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/letter/get", current_base()))
        .json(&json!({"letter_id": 1}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn get_ban_letter_unknown_returns_null() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/letter/get", current_base()))
        .json(&json!({"letter_id": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    // Soft-missing contract: 200 with {letter: null}.
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["letter"].is_null(), "expected letter: null, got {:?}", data["letter"]);
}

#[tokio::test]
async fn get_ban_letter_rejects_missing_letter_id() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/letter/get", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for missing letter_id, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn get_ban_activity_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/activity", current_base()))
        .json(&json!({"ban_id": 1}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn get_ban_activity_unknown_ban_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/activity", current_base()))
        .json(&json!({"ban_id": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn get_ban_activity_rejects_missing_ban_id() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/activity", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for missing ban_id, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn get_ban_details_rejects_missing_ban_id() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/details", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx for missing ban_id, got {}",
        resp.status()
    );
}

// ============================================================================
// Write-side fixtures
// ============================================================================

/// Resolve an org unit's uuid by code (fresh client + cached admin token).
async fn unit_by_code(code: &str) -> String {
    let c = client();
    let token = admin_token(&c).await;
    unit_uuid_by_code(&c, &token, code).await
}

/// Main Street Branch, resolved to its uuid at runtime.
async fn ban_test_org_unit() -> String {
    unit_by_code("MAIN").await
}

/// Create an incident with an unknown-patron involved party and return
/// (incident_id, patron_id). Every test gets a fresh patron so the
/// `active ban already exists` overlap check from prior runs doesn't
/// poison new tests.
async fn create_test_incident_with_patron(
    c: &reqwest::Client,
    token: &str,
    title: &str,
) -> (i64, i64) {
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": ban_test_org_unit().await,
            "title": title,
            "description": "ban-write fixture",
            "involved_parties": [
                {"party_type": "patron", "is_unknown_patron": true}
            ]
        }))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let incident_id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .json(&json!({"id": incident_id, "options": {"with_involved_parties": true}}))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let patron_id = data["involved_parties"][0]["patron_id"]
        .as_i64()
        .expect("unknown_patron party should have patron_id populated");
    (incident_id, patron_id)
}

async fn create_basic_ban(
    c: &reqwest::Client,
    token: &str,
    title: &str,
    is_trespass: bool,
) -> (i64, i64, i64) {
    let (incident_id, patron_id) = create_test_incident_with_patron(c, token, title).await;
    let resp = c
        .post(format!("{}/api/v1/current/ban/create", current_base()))
        .json(&json!({
            "patron": patron_id,
            "incident": incident_id,
            "org_unit": ban_test_org_unit().await,
            "is_trespass": is_trespass,
        }))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "create_basic_ban: body {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    let ban_id = data["patron_ban"]["id"].as_i64().unwrap();
    (incident_id, patron_id, ban_id)
}

// ============================================================================
// ban.create
// ============================================================================

#[tokio::test]
async fn create_ban_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/create", current_base()))
        .json(&json!({"patron": 1, "incident": 1, "org_unit": ban_test_org_unit().await}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn create_ban_minimal_succeeds() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (incident_id, patron_id) =
        create_test_incident_with_patron(&c, &token, "ban-minimal").await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/create", current_base()))
        .json(&json!({
            "patron": patron_id,
            "incident": incident_id,
            "org_unit": ban_test_org_unit().await,
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    let ban = &data["patron_ban"];
    assert!(ban["id"].as_i64().unwrap() > 0);
    assert_eq!(ban["patron"].as_i64().unwrap(), patron_id);
    assert_eq!(ban["incident"].as_i64().unwrap(), incident_id);
    assert_eq!(ban["org_unit"].as_str().unwrap(), ban_test_org_unit().await);
    assert_eq!(ban["is_trespass"].as_bool(), Some(false));
    assert!(ban["lifts_at"].is_string());
    assert!(
        ban["archives_at"].is_string(),
        "bans default archives_at to lifts_at + 30d"
    );
    assert!(data.get("ban_letter_id").is_none() || data["ban_letter_id"].is_null());
}

#[tokio::test]
async fn create_ban_trespass_has_no_default_archives_at() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (incident_id, patron_id) =
        create_test_incident_with_patron(&c, &token, "ban-trespass-default").await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/create", current_base()))
        .json(&json!({
            "patron": patron_id,
            "incident": incident_id,
            "org_unit": ban_test_org_unit().await,
            "is_trespass": true,
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let ban = &data["patron_ban"];
    assert_eq!(ban["is_trespass"].as_bool(), Some(true));
    assert!(
        ban["archives_at"].is_null(),
        "trespasses should never auto-archive; got {:?}",
        ban["archives_at"]
    );
}

#[tokio::test]
async fn create_ban_rejects_overlapping_active_ban() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (incident_id, patron_id) =
        create_test_incident_with_patron(&c, &token, "ban-overlap").await;

    let body = json!({
        "patron": patron_id,
        "incident": incident_id,
        "org_unit": ban_test_org_unit().await,
    });
    assert_eq!(
        c.post(format!("{}/api/v1/current/ban/create", current_base()))
            .json(&body)
            .headers(auth_header(&token))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );

    let resp = c
        .post(format!("{}/api/v1/current/ban/create", current_base()))
        .json(&body)
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400, "overlapping active ban should 400");
}

#[tokio::test]
async fn create_ban_overlap_check_distinguishes_trespass_from_ban() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (incident_id, patron_id) =
        create_test_incident_with_patron(&c, &token, "ban-overlap-distinct").await;

    let post_kind = |is_trespass: bool| {
        let c = c.clone();
        let token = token.clone();
        async move {
            c.post(format!("{}/api/v1/current/ban/create", current_base()))
                .json(&json!({
                    "patron": patron_id,
                    "incident": incident_id,
                    "org_unit": ban_test_org_unit().await,
                    "is_trespass": is_trespass,
                }))
                .headers(auth_header(&token))
                .send()
                .await
                .unwrap()
        }
    };
    assert_eq!(post_kind(false).await.status(), 200);
    assert_eq!(
        post_kind(true).await.status(),
        200,
        "trespass should not be blocked by an existing ban"
    );
}

#[tokio::test]
async fn create_ban_with_letter_emits_letter_id() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (incident_id, patron_id) =
        create_test_incident_with_patron(&c, &token, "ban-with-letter").await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/create", current_base()))
        .json(&json!({
            "patron": patron_id,
            "incident": incident_id,
            "org_unit": ban_test_org_unit().await,
            "ban_letter_content": "Letter body for create-with-letter test",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let letter_id = data["ban_letter_id"]
        .as_i64()
        .expect("letter content provided → ban_letter_id should be set");
    assert!(letter_id > 0);
}

#[tokio::test]
async fn create_ban_writes_activity_entry() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) =
        create_basic_ban(&c, &token, "ban-activity-create", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/activity", current_base()))
        .json(&json!({"ban_id": ban_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let kinds: Vec<&str> = data["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["event_type"].as_str().unwrap())
        .collect();
    assert!(
        kinds.contains(&"ban.created"),
        "expected ban.created in ban activity; got {kinds:?}"
    );
}

// ============================================================================
// ban.edit
// ============================================================================

#[tokio::test]
async fn edit_ban_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/edit", current_base()))
        .json(&json!({"ban_id": 1, "comments": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn edit_ban_unknown_id_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/ban/edit", current_base()))
        .json(&json!({"ban_id": 2_000_000_000_i64, "comments": "x"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn edit_ban_updates_fields_and_logs_changes() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) =
        create_basic_ban(&c, &token, "ban-edit-changes", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/edit", current_base()))
        .json(&json!({
            "ban_id": ban_id,
            "comments": "Edited comment",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["patron_ban"]["comments"].as_str(), Some("Edited comment"));

    let resp = c
        .post(format!("{}/api/v1/current/ban/activity", current_base()))
        .json(&json!({"ban_id": ban_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = resp.json().await.unwrap();
    let kinds: Vec<&str> = body["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["event_type"].as_str().unwrap())
        .collect();
    assert!(kinds.contains(&"ban.updated"));
}

#[tokio::test]
async fn edit_ban_ignores_org_unit_change() {
    // org_unit isn't a field on EditBanRequest; legacy payloads that
    // include it should still succeed and the org_unit must not move.
    // Same security-shape decision as incident.update.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) =
        create_basic_ban(&c, &token, "ban-edit-org-immutable", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/edit", current_base()))
        .json(&json!({
            "ban_id": ban_id,
            "org_unit": unit_by_code("HILL").await,
            "comments": "should-still-be-saved",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        data["patron_ban"]["org_unit"].as_str(),
        Some(ban_test_org_unit().await.as_str()),
        "org_unit must not change via edit"
    );
    assert_eq!(
        data["patron_ban"]["comments"].as_str(),
        Some("should-still-be-saved")
    );
}

// ============================================================================
// ban.archive
// ============================================================================

#[tokio::test]
async fn archive_ban_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/archive", current_base()))
        .json(&json!({"ban_id": 1}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn archive_ban_unknown_id_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/ban/archive", current_base()))
        .json(&json!({"ban_id": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn archive_ban_marks_archived_and_logs() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) = create_basic_ban(&c, &token, "ban-archive", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/archive", current_base()))
        .json(&json!({"ban_id": ban_id, "comments": "archive-reason"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        data["patron_ban"]["archived_by"].as_str(),
        Some(COORD.uuid)
    );
    assert!(data["patron_ban"]["archives_at"].is_string());

    let resp = c
        .post(format!("{}/api/v1/current/ban/archive", current_base()))
        .json(&json!({"ban_id": ban_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400, "double-archive should 400");
}

// ============================================================================
// ban.extend
// ============================================================================

#[tokio::test]
async fn extend_ban_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/extend", current_base()))
        .json(&json!({"ban_id": 1, "lifts_at": "2030-01-01T00:00:00Z"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn extend_ban_unknown_id_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/ban/extend", current_base()))
        .json(&json!({"ban_id": 2_000_000_000_i64, "lifts_at": "2030-01-01T00:00:00Z"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn extend_ban_updates_lifts_at_and_logs() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) = create_basic_ban(&c, &token, "ban-extend", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/extend", current_base()))
        .json(&json!({
            "ban_id": ban_id,
            "lifts_at": "2030-01-01T00:00:00+00:00",
            "comments": "extend-reason",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        &data["patron_ban"]["lifts_at"].as_str().unwrap()[..10],
        "2030-01-01"
    );
    // Non-trespass + no explicit archives_at → recompute to lifts_at + 30d.
    assert_eq!(
        &data["patron_ban"]["archives_at"].as_str().unwrap()[..10],
        "2030-01-31",
        "archives_at should be recomputed to lifts_at + 30d"
    );
    assert!(data["activity_log_id"].as_i64().unwrap() > 0);
    assert!(data["letter_id"].is_null());
}

#[tokio::test]
async fn extend_ban_with_letter_emits_letter_id() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) =
        create_basic_ban(&c, &token, "ban-extend-letter", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/extend", current_base()))
        .json(&json!({
            "ban_id": ban_id,
            "lifts_at": "2030-06-15T00:00:00+00:00",
            "ban_letter_content": "Extension letter content",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["letter_id"].as_i64().unwrap() > 0);
}

// ============================================================================
// ban.add_to
// ============================================================================

#[tokio::test]
async fn add_to_ban_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/add-to", current_base()))
        .json(&json!({"ban_id": 1, "comments": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn add_to_ban_unknown_id_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/ban/add-to", current_base()))
        .json(&json!({"ban_id": 2_000_000_000_i64, "comments": "x"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn add_to_ban_empty_payload_is_invalid() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) =
        create_basic_ban(&c, &token, "ban-addto-empty", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/add-to", current_base()))
        .json(&json!({"ban_id": ban_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        400,
        "must require at least one of comments/attachments/external_links"
    );
}

#[tokio::test]
async fn add_to_ban_with_comment_succeeds_and_logs_note() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) =
        create_basic_ban(&c, &token, "ban-addto-comment", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/add-to", current_base()))
        .json(&json!({"ban_id": ban_id, "comments": "Follow-up note"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["activity_log_id"].as_i64().unwrap() > 0);

    let resp = c
        .post(format!("{}/api/v1/current/ban/activity", current_base()))
        .json(&json!({"ban_id": ban_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = resp.json().await.unwrap();
    let kinds: Vec<&str> = body["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["event_type"].as_str().unwrap())
        .collect();
    assert!(kinds.contains(&"ban.note"));
}

#[tokio::test]
async fn add_to_ban_with_external_link_attaches_link() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) = create_basic_ban(&c, &token, "ban-addto-link", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/add-to", current_base()))
        .json(&json!({
            "ban_id": ban_id,
            "external_links": [
                {"url": "https://example.com/case", "title": "Case file"}
            ],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let resp = c
        .post(format!("{}/api/v1/current/ban/activity", current_base()))
        .json(&json!({"ban_id": ban_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let entries = resp.json::<serde_json::Value>().await.unwrap()["entries"]
        .as_array()
        .unwrap()
        .clone();
    let note = entries
        .iter()
        .find(|e| e["event_type"] == "ban.note")
        .expect("ban.note entry");
    let links = note["external_links"]
        .as_array()
        .expect("external_links array on the ban.note entry");
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["url"].as_str(), Some("https://example.com/case"));
}

// ============================================================================
// ban.letter.create
// ============================================================================

#[tokio::test]
async fn create_ban_letter_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/ban/letter/create", current_base()))
        .json(&json!({"ban_id": 1, "content": "body"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn create_ban_letter_unknown_ban_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/ban/letter/create", current_base()))
        .json(&json!({"ban_id": 2_000_000_000_i64, "content": "body"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn create_ban_letter_round_trip_through_letter_get() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (_inc, _patron, ban_id) = create_basic_ban(&c, &token, "ban-letter-rt", false).await;

    let resp = c
        .post(format!("{}/api/v1/current/ban/letter/create", current_base()))
        .json(&json!({
            "ban_id": ban_id,
            "content": "Letter content for round-trip",
            "case_number": "CASE-123",
            "law_enforcement_agency": "Bellevue PD",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let letter_id = data["letter_id"].as_i64().unwrap();
    assert!(data["activity_log_id"].as_i64().unwrap() > 0);

    let resp = c
        .post(format!("{}/api/v1/current/ban/letter/get", current_base()))
        .json(&json!({"letter_id": letter_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        data["letter"]["content"].as_str(),
        Some("Letter content for round-trip")
    );
}
