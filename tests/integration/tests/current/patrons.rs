use integration_tests::*;
use serde_json::json;

/// Resolve an org unit's uuid by code (fresh client + cached admin token).
async fn unit_by_code(code: &str) -> String {
    let c = client();
    let token = admin_token(&c).await;
    unit_uuid_by_code(&c, &token, code).await
}

/// Main Street Branch, resolved to its uuid at runtime.
async fn test_org_unit() -> String {
    unit_by_code("MAIN").await
}

/// Create an incident with an unknown-patron involved party, returning
/// the (incident_id, patron_id) pair. This is the only way to fabricate
/// a patron from the API surface today — `patron.create` is still on
/// the legacy backend.
async fn create_unknown_patron_via_incident(
    c: &reqwest::Client,
    token: &str,
) -> (i64, i64) {
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "patron-fixture",
            "description": "creates a patron via the involved_parties path",
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

    // Fetch back to extract the auto-created patron's id.
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

// --- get_patron_detail_summary ---

#[tokio::test]
async fn detail_summary_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .json(&json!({"patron_id": 1}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn detail_summary_unknown_patron_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .json(&json!({"patron_id": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn detail_summary_rejects_missing_patron_id() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status() == 400 || resp.status() == 422,
        "expected 4xx, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn detail_summary_returns_full_envelope() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let (_incident_id, patron_id) = create_unknown_patron_via_incident(&c, &token).await;

    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .json(&json!({"patron_id": patron_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();

    // Envelope shape.
    let patron = &data["patron"];
    let stats = &data["statistics"];
    let photos = data["photos"].as_array().unwrap();

    assert_eq!(patron["id"].as_i64().unwrap(), patron_id);
    assert_eq!(patron["is_unknown"].as_bool(), Some(true));
    assert!(patron["display_name"].is_string());
    // age_range_label resolves the FK; for the default age_range the
    // label should be a non-empty string.
    assert!(
        patron["age_range_label"].is_string(),
        "age_range_label should be resolved; got {:?}",
        patron["age_range_label"]
    );

    // Statistics shape — all five counters present and non-negative.
    for field in [
        "active_bans_count",
        "active_ban_only_count",
        "active_trespass_count",
        "visible_bans_count",
        "total_incidents_count",
    ] {
        assert!(
            stats[field].is_u64() || stats[field].is_i64(),
            "stats.{field} should be a number; got {:?}",
            stats[field]
        );
    }

    // No bans have been created for this patron — all counts are zero.
    assert_eq!(stats["active_bans_count"].as_i64().unwrap(), 0);
    assert_eq!(stats["active_ban_only_count"].as_i64().unwrap(), 0);
    assert_eq!(stats["active_trespass_count"].as_i64().unwrap(), 0);
    assert_eq!(stats["visible_bans_count"].as_i64().unwrap(), 0);

    // total_incidents_count reflects involved_parties → incidents linkage.
    // We just created the incident, so it should be exactly 1.
    assert_eq!(
        stats["total_incidents_count"].as_i64().unwrap(),
        1,
        "the patron was involved in the one incident we just created"
    );

    // No photos uploaded.
    assert!(photos.is_empty());
}

#[tokio::test]
async fn detail_summary_org_scope_narrows_incident_count() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Patron is created via an incident at TEST_ORG_UNIT (the branch).
    let (_incident_id, patron_id) = create_unknown_patron_via_incident(&c, &token).await;

    // With no org_unit: incident count includes the branch.
    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .json(&json!({"patron_id": patron_id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let unscoped = resp.json::<serde_json::Value>().await.unwrap()["statistics"]
        ["total_incidents_count"]
        .as_i64()
        .unwrap();
    assert!(unscoped >= 1);

    // Scoped to TEST_ORG_UNIT: same incident counts (branch ⊂ branch).
    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .json(&json!({"patron_id": patron_id, "org_unit": test_org_unit().await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let branch_scoped = resp.json::<serde_json::Value>().await.unwrap()["statistics"]
        ["total_incidents_count"]
        .as_i64()
        .unwrap();
    assert_eq!(
        branch_scoped, 1,
        "incident at TEST_ORG_UNIT should be visible when scoped to TEST_ORG_UNIT"
    );

    // Scoped to an unrelated leaf: the count drops to zero. Riverside
    // Branch is a sibling in the demo seed, with no overlap to
    // TEST_ORG_UNIT's subtree.
    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .json(&json!({"patron_id": patron_id, "org_unit": unit_by_code("RIVR").await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    let other_scoped = resp.json::<serde_json::Value>().await.unwrap()["statistics"]
        ["total_incidents_count"]
        .as_i64()
        .unwrap();
    assert_eq!(
        other_scoped, 0,
        "incident at TEST_ORG_UNIT should be invisible when scoped to an unrelated org"
    );
}

// ============================================================================
// TODO — back-fill behavioral coverage when more endpoints land
// ============================================================================
//
// Once `ban.create` (phase 3) is migrated, add:
//   - active_bans_count / active_ban_only_count / active_trespass_count
//     splits, by creating bans of each shape
//   - visible_bans_count vs active counts (a future-archive ban is visible
//     but inactive once lifts_at < now)
//   - org_scope filters bans (not just incidents)
//
// Once `patron.photo.create` (phase 2) is migrated, add:
//   - photos[] population including file_upload_data
//   - is_primary ordering: primary photo first, then others
//
// Once `patron.photo.*` is migrated, similar tests in this file should
// also exercise the photo round-trip.

// ============================================================================
// patron.create
// ============================================================================

async fn create_patron_body(
    c: &reqwest::Client,
    token: &str,
    body: &serde_json::Value,
) -> reqwest::Response {
    c.post(format!("{}/api/v1/current/patron/create", current_base()))
        .json(body)
        .headers(auth_header(token))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn create_patron_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/patron/create", current_base()))
        .json(&json!({"first_name": "A", "last_name": "B"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn create_patron_minimal_succeeds() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = create_patron_body(
        &c,
        &token,
        &json!({"first_name": "Patron-create-min", "last_name": "Last"}),
    )
    .await;
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["id"].as_i64().unwrap() > 0);
    assert_eq!(data["first_name"].as_str().unwrap(), "Patron-create-min");
    assert_eq!(data["last_name"].as_str().unwrap(), "Last");
    assert_eq!(data["is_unknown"].as_bool(), Some(false));
}

#[tokio::test]
async fn create_patron_with_optionals() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = create_patron_body(
        &c,
        &token,
        &json!({
            "first_name": "Patron-create-full",
            "last_name": "Last",
            "alias": "Slim",
            "age_range": 2,
        }),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["alias"].as_str(), Some("Slim"));
    assert_eq!(data["age_range"].as_i64(), Some(2));
}

#[tokio::test]
async fn create_patron_unknown_rewrites_first_name() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    // first_name on input is overwritten with "Unknown Patron #<id>" so
    // unknown-patron rows are visually distinct in the UI.
    let resp = create_patron_body(
        &c,
        &token,
        &json!({"first_name": "Ignored", "last_name": "Last", "is_unknown": true}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let id = data["id"].as_i64().unwrap();
    assert_eq!(data["is_unknown"].as_bool(), Some(true));
    assert_eq!(
        data["first_name"].as_str().unwrap(),
        format!("Unknown Patron #{id}")
    );
}

// ============================================================================
// patron.update
// ============================================================================

#[tokio::test]
async fn update_patron_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/patron/update", current_base()))
        .json(&json!({"patron_id": 1, "first_name": "X"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn update_patron_unknown_id_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/patron/update", current_base()))
        .json(&json!({"patron_id": 2_000_000_000_i64, "first_name": "X"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn update_patron_only_touches_provided_fields() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Seed with a known shape.
    let resp = create_patron_body(
        &c,
        &token,
        &json!({
            "first_name": "Update-original-first",
            "last_name": "Update-original-last",
            "alias": "OriginalAlias",
        }),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let seed: serde_json::Value = resp.json().await.unwrap();
    let id = seed["id"].as_i64().unwrap();

    // Touch only first_name + city — last_name and alias should ride.
    let resp = c
        .post(format!("{}/api/v1/current/patron/update", current_base()))
        .json(&json!({
            "patron_id": id,
            "first_name": "Update-new-first",
            "city": "Bellevue",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["first_name"].as_str(), Some("Update-new-first"));
    assert_eq!(data["last_name"].as_str(), Some("Update-original-last"));
    assert_eq!(data["alias"].as_str(), Some("OriginalAlias"));
    assert_eq!(data["city"].as_str(), Some("Bellevue"));
}

#[tokio::test]
async fn update_patron_empty_string_clears_nullable_fields() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = create_patron_body(
        &c,
        &token,
        &json!({
            "first_name": "Clear-test",
            "last_name": "Last",
            "alias": "ClearMe",
        }),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let seed: serde_json::Value = resp.json().await.unwrap();
    let id = seed["id"].as_i64().unwrap();
    assert_eq!(seed["alias"].as_str(), Some("ClearMe"));

    // Empty string clears alias / library_card / address fields per
    // legacy semantics. (For non-clearable fields like first_name, an
    // empty string would be written literally.)
    let resp = c
        .post(format!("{}/api/v1/current/patron/update", current_base()))
        .json(&json!({
            "patron_id": id,
            "alias": "",
            "library_card": "",
            "city": "",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert!(data["alias"].is_null(), "alias should be null, got {:?}", data["alias"]);
    assert!(data["library_card"].is_null());
    assert!(data["city"].is_null());
}

// ============================================================================
// patron.delete
// ============================================================================

#[tokio::test]
async fn delete_patron_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/patron/delete", current_base()))
        .json(&json!({"patron_id": 1}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn delete_patron_unknown_id_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/patron/delete", current_base()))
        .json(&json!({"patron_id": 2_000_000_000_i64}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn delete_patron_soft_deletes_and_hides_from_details() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = create_patron_body(
        &c,
        &token,
        &json!({"first_name": "Delete-target", "last_name": "Last"}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let seed: serde_json::Value = resp.json().await.unwrap();
    let id = seed["id"].as_i64().unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/patron/delete", current_base()))
        .json(&json!({"patron_id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["success"].as_bool(), Some(true));
    assert_eq!(data["patron_id"].as_i64(), Some(id));
    // No active bans on this fresh patron → 0 lifted.
    assert_eq!(data["bans_lifted"].as_i64(), Some(0));

    // detail-summary filters DeletedAt.is_null() → should now 404.
    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .json(&json!({"patron_id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404, "soft-deleted patron should be hidden from details");
}

#[tokio::test]
async fn delete_patron_twice_is_invalid_input() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = create_patron_body(
        &c,
        &token,
        &json!({"first_name": "Delete-twice", "last_name": "Last"}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let id: i64 = resp.json::<serde_json::Value>().await.unwrap()["id"].as_i64().unwrap();

    assert_eq!(
        c.post(format!("{}/api/v1/current/patron/delete", current_base()))
            .json(&json!({"patron_id": id}))
            .headers(auth_header(&token))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );

    // Second delete: 400 with "already deleted".
    let resp = c
        .post(format!("{}/api/v1/current/patron/delete", current_base()))
        .json(&json!({"patron_id": id}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

// ============================================================================
// patron.photo.{create, set_primary, delete}
// ============================================================================

/// Upload a file via odo-asset (the canonical write path for files) and
/// return its stable file uuid. Mirrors what the UI does before registering
/// a photo against a patron.
async fn upload_patron_photo_file(c: &reqwest::Client, token: &str, label: &str) -> String {
    use reqwest::multipart;
    let bytes = vec![0x89, 0x50, 0x4E, 0x47]; // PNG magic — passes the .png extension check
    let part = multipart::Part::bytes(bytes).file_name(format!("{label}.png"));
    let form = multipart::Form::new()
        .part("file", part)
        .text("category", "photo")
        .text("entity_type", "patron");
    let resp = c
        .post(format!("{}/api/v1/odo/asset/upload", asset_base()))
        .headers(auth_header(token))
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "upload failed: {:?}", resp.text().await);
    resp.json::<serde_json::Value>().await.unwrap()["uuid"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn make_test_patron(c: &reqwest::Client, token: &str, label: &str) -> i64 {
    let resp = c
        .post(format!("{}/api/v1/current/patron/create", current_base()))
        .headers(auth_header(token))
        .json(&json!({"first_name": label, "last_name": "PhotoTest"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap()
}

async fn list_patron_photos(c: &reqwest::Client, token: &str, patron_id: i64) -> Vec<serde_json::Value> {
    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .headers(auth_header(token))
        .json(&json!({"patron_id": patron_id}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    data["photos"].as_array().cloned().unwrap_or_default()
}

#[tokio::test]
async fn create_photo_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/patron/photo/create", current_base()))
        .json(&json!({"patron_id": 1, "file_upload_id": "00000000-0000-4000-a000-00000000dead"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn create_photo_round_trip_appears_in_details() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let patron_id = make_test_patron(&c, &token, "Photo-create-rt").await;
    let upload_id = upload_patron_photo_file(&c, &token, "create-rt").await;

    let resp = c
        .post(format!("{}/api/v1/current/patron/photo/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "patron_id": patron_id,
            "file_upload_id": upload_id,
            "is_primary": true,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    let photo: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(photo["patron"].as_i64(), Some(patron_id));
    assert_eq!(photo["file_upload"].as_str().map(String::from), Some(upload_id.clone()));
    assert_eq!(photo["is_primary"].as_bool(), Some(true));

    // detail-summary's photos[] decoration reads via odo-asset's
    // /files/get — round-trip verifies that path too.
    let photos = list_patron_photos(&c, &token, patron_id).await;
    assert_eq!(photos.len(), 1);
    assert_eq!(photos[0]["is_primary"].as_bool(), Some(true));
    assert_eq!(
        photos[0]["file_upload_data"]["id"].as_str().map(String::from),
        Some(upload_id.clone()),
        "file metadata should flow through odo-asset client"
    );
    assert_eq!(
        photos[0]["file_upload_data"]["file_name"].as_str(),
        Some("create-rt.png")
    );
}

#[tokio::test]
async fn create_second_primary_demotes_first() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let patron_id = make_test_patron(&c, &token, "Photo-second-primary").await;
    let first = upload_patron_photo_file(&c, &token, "second-primary-a").await;
    let second = upload_patron_photo_file(&c, &token, "second-primary-b").await;

    for upload in [first.clone(), second.clone()] {
        let resp = c
            .post(format!("{}/api/v1/current/patron/photo/create", current_base()))
            .headers(auth_header(&token))
            .json(&json!({
                "patron_id": patron_id,
                "file_upload_id": upload,
                "is_primary": true,
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);
    }

    // Schema enforces "one primary per patron" via partial unique
    // index; without the demote-then-insert dance the second create
    // would 23505. Verify exactly one row ends up primary.
    let photos = list_patron_photos(&c, &token, patron_id).await;
    assert_eq!(photos.len(), 2);
    let primary_count = photos.iter().filter(|p| p["is_primary"].as_bool() == Some(true)).count();
    assert_eq!(primary_count, 1, "exactly one photo should be primary; got {photos:?}");
    let primary = photos.iter().find(|p| p["is_primary"].as_bool() == Some(true)).unwrap();
    assert_eq!(
        primary["file_upload"].as_str().map(String::from),
        Some(second.clone()),
        "the second-created photo should be primary"
    );
}

#[tokio::test]
async fn set_primary_promotes_and_demotes() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let patron_id = make_test_patron(&c, &token, "Photo-set-primary").await;
    let primary_upload = upload_patron_photo_file(&c, &token, "set-primary-a").await;
    let other_upload = upload_patron_photo_file(&c, &token, "set-primary-b").await;

    let primary_id = c
        .post(format!("{}/api/v1/current/patron/photo/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": patron_id, "file_upload_id": primary_upload, "is_primary": true}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let other_id = c
        .post(format!("{}/api/v1/current/patron/photo/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": patron_id, "file_upload_id": other_upload}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    // Promote the non-primary.
    let resp = c
        .post(format!("{}/api/v1/current/patron/photo/set-primary", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": patron_id, "photo_id": other_id}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["id"].as_i64(), Some(other_id));
    assert_eq!(data["is_primary"].as_bool(), Some(true));

    let photos = list_patron_photos(&c, &token, patron_id).await;
    let primary = photos.iter().find(|p| p["is_primary"].as_bool() == Some(true)).unwrap();
    assert_eq!(primary["id"].as_i64(), Some(other_id));
    let demoted = photos.iter().find(|p| p["id"].as_i64() == Some(primary_id)).unwrap();
    assert_eq!(demoted["is_primary"].as_bool(), Some(false));
}

#[tokio::test]
async fn set_primary_rejects_cross_patron_photo() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let owner_patron = make_test_patron(&c, &token, "Photo-owner").await;
    let other_patron = make_test_patron(&c, &token, "Photo-other").await;
    let upload = upload_patron_photo_file(&c, &token, "cross-patron").await;

    let photo_id = c
        .post(format!("{}/api/v1/current/patron/photo/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": owner_patron, "file_upload_id": upload}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    // Trying to claim owner's photo on the other patron must 404
    // (not leak "photo exists, just not yours").
    let resp = c
        .post(format!("{}/api/v1/current/patron/photo/set-primary", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": other_patron, "photo_id": photo_id}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn delete_photo_removes_join_row_and_underlying_file() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let patron_id = make_test_patron(&c, &token, "Photo-delete").await;
    let upload = upload_patron_photo_file(&c, &token, "delete").await;

    let create_resp = c
        .post(format!("{}/api/v1/current/patron/photo/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": patron_id, "file_upload_id": upload, "is_primary": true}))
        .send()
        .await
        .unwrap();
    let photo_id = create_resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/patron/photo/delete", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"photo_id": photo_id}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["success"].as_bool(), Some(true));
    assert_eq!(data["photo_id"].as_i64(), Some(photo_id));
    assert_eq!(data["file_upload_id"].as_str().map(String::from), Some(upload.clone()));
    // Fresh upload → file present on disk → odo-asset removed it.
    assert_eq!(data["file_removed"].as_bool(), Some(true));

    // Patron should now have no photos.
    let photos = list_patron_photos(&c, &token, patron_id).await;
    assert!(photos.is_empty(), "all photos should be gone; got {photos:?}");

    // Underlying file_upload is soft-deleted in odo-asset; files/get
    // returns nothing for it.
    let resp = c
        .post(format!("{}/api/v1/odo/asset/files/get", asset_base()))
        .headers(auth_header(&token))
        .json(&json!({"uuids": [upload]}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["files"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn delete_photo_unknown_id_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/patron/photo/delete", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"photo_id": 2_000_000_000_i64}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

// ============================================================================
// patron.search
// ============================================================================

async fn search_patrons(
    c: &reqwest::Client,
    token: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    let resp = c
        .post(format!("{}/api/v1/current/patron/search", current_base()))
        .headers(auth_header(token))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "patron/search: body {:?}", resp.text().await);
    resp.json().await.unwrap()
}

#[tokio::test]
async fn search_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/patron/search", current_base()))
        .json(&json!({"limit": 1}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn search_returns_envelope_with_aggregates() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let data = search_patrons(&c, &token, json!({"limit": 3})).await;
    assert!(data["total_count"].as_i64().unwrap() >= 0);
    let patrons = data["patrons"].as_array().unwrap();
    for p in patrons {
        // Every row must carry the aggregate fields (zero when no
        // activity).
        assert!(p["incident_count"].is_number(), "row missing incident_count: {p:?}");
        assert!(p["active_ban_count"].is_number());
        assert!(p["active_trespass_count"].is_number());
    }
}

#[tokio::test]
async fn search_zero_activity_patron_appears_with_zero_aggregates() {
    // Regression: a freshly-created patron with no incidents and no
    // bans must still appear in name search. Aggregates default to 0
    // via the base-table fallback path in assemble_response_rows.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/patron/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "first_name": "search-zeroact-target",
            "last_name": format!("Zzz{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let patron = resp.json::<serde_json::Value>().await.unwrap();
    let patron_id = patron["id"].as_i64().unwrap();
    let last_name = patron["last_name"].as_str().unwrap().to_string();

    let data = search_patrons(&c, &token, json!({"limit": 10, "query": last_name})).await;
    let rows: Vec<serde_json::Value> = data["patrons"].as_array().unwrap().clone();
    let hit = rows.iter().find(|p| p["id"].as_i64() == Some(patron_id))
        .expect("zero-activity patron should appear in name search");
    assert_eq!(hit["incident_count"].as_i64(), Some(0));
    assert_eq!(hit["active_ban_count"].as_i64(), Some(0));
    assert_eq!(hit["active_trespass_count"].as_i64(), Some(0));
    // No activity → no ban_max_lifts_at / last_incident_date / etc.
    assert!(hit.get("ban_max_lifts_at").is_none() || hit["ban_max_lifts_at"].is_null());
    assert!(hit.get("last_incident_date").is_none() || hit["last_incident_date"].is_null());
}

#[tokio::test]
async fn search_query_matches_name_terms() {
    // Multi-term ILIKE: every term must hit at least one field.
    // A patron with first_name = "MatchA" + last_name = "MatchB"
    // should be found by query "MatchA MatchB" but not by
    // "MatchA NoSuchToken".
    let c = client();
    let token = login_token(&c, &COORD).await;

    let unique = format!(
        "qtest{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let first = format!("FirstA{unique}");
    let last = format!("LastB{unique}");
    let create = c
        .post(format!("{}/api/v1/current/patron/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"first_name": first, "last_name": last}))
        .send()
        .await
        .unwrap();
    assert_eq!(create.status(), 200);
    let id = create.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    // Two-term query that matches first + last → finds the patron.
    let data = search_patrons(
        &c,
        &token,
        json!({"limit": 10, "query": format!("{first} {last}")}),
    )
    .await;
    let ids: Vec<i64> = data["patrons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_i64().unwrap())
        .collect();
    assert!(
        ids.contains(&id),
        "two-term query should match the seeded patron; got {ids:?}"
    );

    // Adding a bogus second term that doesn't appear anywhere kills
    // the hit — terms are AND-combined.
    let data = search_patrons(
        &c,
        &token,
        json!({"limit": 10, "query": format!("{first} no_such_token_xyzzyz")}),
    )
    .await;
    let ids: Vec<i64> = data["patrons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_i64().unwrap())
        .collect();
    assert!(
        !ids.contains(&id),
        "unmatched second term should exclude the patron; got {ids:?}"
    );
}

#[tokio::test]
async fn search_is_unknown_filter() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Unknown=true → all returned rows should be is_unknown=true.
    let data = search_patrons(
        &c,
        &token,
        json!({"limit": 10, "is_unknown": true}),
    )
    .await;
    for p in data["patrons"].as_array().unwrap() {
        assert_eq!(
            p["is_unknown"].as_bool(),
            Some(true),
            "is_unknown=true filter leaked a known patron: {p:?}"
        );
    }

    // Unknown=false → all returned rows should be is_unknown=false.
    let data = search_patrons(
        &c,
        &token,
        json!({"limit": 10, "is_unknown": false}),
    )
    .await;
    for p in data["patrons"].as_array().unwrap() {
        assert_eq!(
            p["is_unknown"].as_bool(),
            Some(false),
            "is_unknown=false filter leaked an unknown patron: {p:?}"
        );
    }
}

#[tokio::test]
async fn search_has_active_bans_filter() {
    // Every returned patron must have active_ban_count > 0 when this
    // gate is set. Test data has bans in place from the bans-write
    // round trips earlier in the suite.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let data = search_patrons(
        &c,
        &token,
        json!({"limit": 25, "has_active_bans": true}),
    )
    .await;
    let rows = data["patrons"].as_array().unwrap();
    assert!(
        !rows.is_empty(),
        "has_active_bans filter returned zero rows; expected at least one from prior test runs"
    );
    for p in rows {
        assert!(
            p["active_ban_count"].as_i64().unwrap() > 0,
            "row leaked through has_active_bans gate: {p:?}"
        );
    }
}

#[tokio::test]
async fn search_pagination_respects_limit_and_offset() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let page_a = search_patrons(&c, &token, json!({"limit": 2, "offset": 0})).await;
    let page_b = search_patrons(&c, &token, json!({"limit": 2, "offset": 2})).await;
    let ids_a: Vec<i64> = page_a["patrons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_i64().unwrap())
        .collect();
    let ids_b: Vec<i64> = page_b["patrons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids_a.len(), 2);
    assert_eq!(ids_b.len(), 2);
    let overlap: Vec<&i64> = ids_a.iter().filter(|i| ids_b.contains(i)).collect();
    assert!(
        overlap.is_empty(),
        "pages should not overlap; got a={ids_a:?} b={ids_b:?}"
    );
    // Same total_count across pages of the same filter.
    assert_eq!(
        page_a["total_count"], page_b["total_count"],
        "total_count should be stable across paged calls"
    );
}

#[tokio::test]
async fn search_sort_incident_date_descending_orders_by_recency() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let data = search_patrons(
        &c,
        &token,
        json!({"limit": 10, "sort_incident_date": true, "sort_dir": "desc"}),
    )
    .await;
    let rows = data["patrons"].as_array().unwrap();
    // Need at least two rows to compare ordering. The sort_incident_date
    // field is what the sort key produces.
    let dates: Vec<&str> = rows
        .iter()
        .filter_map(|p| p.get("sort_incident_date").and_then(|v| v.as_str()))
        .collect();
    if dates.len() >= 2 {
        for pair in dates.windows(2) {
            assert!(
                pair[0] >= pair[1],
                "sort_incident_date desc broke at {} > {}",
                pair[0],
                pair[1]
            );
        }
    }
}

#[tokio::test]
async fn search_org_unit_scope_excludes_other_orgs() {
    // Patrons whose only activity is at org_unit X should not appear
    // when searching with org_unit = Y for some sibling Y. Easiest
    // construction: create an incident + ban at the test org, then
    // search at an unrelated org and assert the patron is absent.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let unique = format!(
        "ScopeTest{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );

    // Seed: create a patron + a ban at TEST_ORG_UNIT.
    let patron_resp = c
        .post(format!("{}/api/v1/current/patron/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"first_name": unique, "last_name": "Scope"}))
        .send()
        .await
        .unwrap();
    assert_eq!(patron_resp.status(), 200);
    let patron_id = patron_resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();
    let incident_resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": format!("{unique} fixture"),
            "description": "scope-test fixture",
            "involved_parties": [
                {"party_type": "patron", "patron_id": patron_id}
            ],
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(incident_resp.status(), 200);

    // Search at TEST_ORG_UNIT with has_active_bans=false but
    // unfiltered: patron should show up.
    let data = search_patrons(
        &c,
        &token,
        json!({"limit": 25, "query": unique, "org_unit": test_org_unit().await, "has_active_bans": false}),
    )
    .await;
    let in_scope: Vec<i64> = data["patrons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_i64().unwrap())
        .collect();
    assert!(
        in_scope.contains(&patron_id),
        "patron should appear in their own org's search; got {in_scope:?}"
    );
}

// ============================================================================
// patron.merge.preview / patron.merge
// ============================================================================

async fn create_named_patron(
    c: &reqwest::Client,
    token: &str,
    first: &str,
    last: &str,
) -> i64 {
    let resp = c
        .post(format!("{}/api/v1/current/patron/create", current_base()))
        .headers(auth_header(token))
        .json(&json!({"first_name": first, "last_name": last}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "create_named_patron: {:?}", resp.text().await);
    resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap()
}

async fn merge_preview(
    c: &reqwest::Client,
    token: &str,
    primary: i64,
    secondary: i64,
) -> reqwest::Response {
    c.post(format!("{}/api/v1/current/patron/merge/preview", current_base()))
        .headers(auth_header(token))
        .json(&json!({"primary_patron_id": primary, "secondary_patron_id": secondary}))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn merge_preview_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/patron/merge/preview", current_base()))
        .json(&json!({"primary_patron_id": 1, "secondary_patron_id": 2}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn merge_preview_rejects_self_merge() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = merge_preview(&c, &token, 1, 1).await;
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn merge_preview_unknown_patron_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = merge_preview(&c, &token, 2_000_000_000, 2_000_000_001).await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn merge_preview_detects_field_conflicts() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    // Distinct first_name and last_name → two field_conflict entries.
    let a = create_named_patron(&c, &token, "MergeFieldA", "OrigA").await;
    let b = create_named_patron(&c, &token, "MergeFieldB", "OrigB").await;
    let resp = merge_preview(&c, &token, a, b).await;
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let conflicts = data["conflicts"].as_array().unwrap();
    let fields: Vec<&str> = conflicts
        .iter()
        .map(|c| c["field"].as_str().unwrap())
        .collect();
    assert!(
        fields.contains(&"first_name"),
        "expected first_name conflict; got {fields:?}"
    );
    assert!(
        fields.contains(&"last_name"),
        "expected last_name conflict; got {fields:?}"
    );
    // No activity → all zero summaries.
    let summary = &data["merged_data_summary"];
    assert_eq!(summary["incidents"].as_i64(), Some(0));
    assert_eq!(summary["bans"].as_i64(), Some(0));
}

#[tokio::test]
async fn merge_preview_omits_field_conflicts_when_values_match() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    // Same first/last → no field_conflict rows for those fields.
    let a = create_named_patron(&c, &token, "MergeSameFirst", "MergeSameLast").await;
    let b = create_named_patron(&c, &token, "MergeSameFirst", "MergeSameLast").await;
    let resp = merge_preview(&c, &token, a, b).await;
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let conflicts = data["conflicts"].as_array().unwrap();
    for c in conflicts {
        let f = c["field"].as_str().unwrap_or("");
        assert!(
            f != "first_name" && f != "last_name",
            "no conflict expected for matching first/last; got {c:?}"
        );
    }
}

#[tokio::test]
async fn merge_preview_same_incident_conflict() {
    // Both patrons involved in the same incident → one
    // same_incident_conflicts entry.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let a = create_named_patron(&c, &token, "MergeSameIncA", "Aa").await;
    let b = create_named_patron(&c, &token, "MergeSameIncB", "Bb").await;
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "merge-same-incident fixture",
            "description": "both patrons involved",
            "involved_parties": [
                {"party_type": "patron", "patron_id": a},
                {"party_type": "patron", "patron_id": b},
            ],
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let incident_id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = merge_preview(&c, &token, a, b).await;
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let same = data["same_incident_conflicts"].as_array().unwrap();
    assert_eq!(same.len(), 1, "expected exactly one same-incident conflict");
    assert_eq!(same[0]["incident_id"].as_i64(), Some(incident_id));
}

#[tokio::test]
async fn merge_execute_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .json(&json!({"primary_patron_id": 1, "secondary_patron_id": 2}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn merge_execute_rejects_self_merge() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"primary_patron_id": 1, "secondary_patron_id": 1}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn merge_execute_unknown_patron_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"primary_patron_id": 2_000_000_000_i64, "secondary_patron_id": 2_000_000_001_i64}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn merge_execute_soft_deletes_secondary_and_keeps_primary() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let a = create_named_patron(&c, &token, "MergeExecA", "Keep").await;
    let b = create_named_patron(&c, &token, "MergeExecB", "Drop").await;

    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "primary_patron_id": a,
            "secondary_patron_id": b,
            // Default to "primary" for the field conflicts → no
            // changes; we just want the merge itself to land.
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["success"].as_bool(), Some(true));
    assert_eq!(data["merged_patron_id"].as_i64(), Some(a));
    assert_eq!(data["deleted_patron_id"].as_i64(), Some(b));

    // Primary still reachable; secondary 404s (filtered by deleted_at).
    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": a}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": b}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn merge_execute_applies_secondary_field_resolution() {
    // Resolve last_name = "secondary": primary should end up with
    // secondary's last_name.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let a = create_named_patron(&c, &token, "MergeFieldRes", "OrigLast").await;
    let b = create_named_patron(&c, &token, "MergeFieldRes", "NewLast").await;

    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "primary_patron_id": a,
            "secondary_patron_id": b,
            "conflict_resolutions": [
                {"type": "field_conflict", "field": "last_name", "resolution": "secondary"}
            ]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);

    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": a}))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["patron"]["last_name"].as_str(), Some("NewLast"));
    assert_eq!(data["patron"]["first_name"].as_str(), Some("MergeFieldRes"));
}

#[tokio::test]
async fn merge_execute_applies_custom_field_resolution() {
    // resolution = "custom" with a custom_value string lands on the
    // primary patron's field.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let a = create_named_patron(&c, &token, "MergeCustomA", "OldLast").await;
    let b = create_named_patron(&c, &token, "MergeCustomB", "OtherLast").await;

    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "primary_patron_id": a,
            "secondary_patron_id": b,
            "conflict_resolutions": [
                {"type": "field_conflict", "field": "last_name", "resolution": "custom", "custom_value": "ChosenByHuman"}
            ]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": a}))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(data["patron"]["last_name"].as_str(), Some("ChosenByHuman"));
}

#[tokio::test]
async fn merge_execute_secondary_resolution_lands_on_non_name_fields() {
    // Regression guard: an earlier implementation of merge_execute
    // only forced `first_name` and `last_name` through
    // `ActiveValue::Set`, which meant secondary-side resolutions for
    // every other field in ALLOWED_MERGE_FIELDS silently no-op'd.
    // This exercises three of those (alias, city, postal_code) in one
    // merge to catch any future regression.
    //
    // `library_card` is intentionally omitted: it has an unconditional
    // UNIQUE constraint, so copying secondary's value to primary
    // before secondary is soft-deleted trips the constraint. That's a
    // separate, pre-existing merge-ordering issue (legacy hits it
    // too); fixing it requires reordering merge_execute to soft-delete
    // secondary before writing the merged values to primary.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let primary = create_named_patron(&c, &token, "MergeNonName", "Primary").await;
    let secondary = create_named_patron(&c, &token, "MergeNonName", "Secondary").await;

    // Seed differing values via patron.update — create() only takes a
    // narrow shape, so we use update to populate the optional fields.
    for (patron, alias, city, postal) in [
        (primary, "PriAlias", "Bellevue", "98005"),
        (secondary, "SecAlias", "Seattle", "98101"),
    ] {
        let resp = c
            .post(format!("{}/api/v1/current/patron/update", current_base()))
            .headers(auth_header(&token))
            .json(&json!({
                "patron_id": patron,
                "alias": alias,
                "city": city,
                "postal_code": postal,
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200, "seed update failed: {:?}", resp.text().await);
    }

    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "primary_patron_id": primary,
            "secondary_patron_id": secondary,
            "conflict_resolutions": [
                {"type": "field_conflict", "field": "alias", "resolution": "secondary"},
                {"type": "field_conflict", "field": "city", "resolution": "secondary"},
                {"type": "field_conflict", "field": "postal_code", "resolution": "secondary"},
            ]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);

    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": primary}))
        .send()
        .await
        .unwrap();
    let merged = resp.json::<serde_json::Value>().await.unwrap()["patron"].clone();
    assert_eq!(merged["alias"].as_str(), Some("SecAlias"));
    assert_eq!(merged["city"].as_str(), Some("Seattle"));
    assert_eq!(merged["postal_code"].as_str(), Some("98101"));
}

#[tokio::test]
async fn merge_execute_custom_resolution_lands_on_non_name_fields() {
    // Same regression class as the secondary-resolution test above:
    // custom-value resolutions on non-name fields must reach the DB.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let primary = create_named_patron(&c, &token, "MergeCustomNonName", "P").await;
    let secondary = create_named_patron(&c, &token, "MergeCustomNonName", "S").await;

    let resp = c
        .post(format!("{}/api/v1/current/patron/update", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "patron_id": primary,
            "alias": "OldAlias",
            "city": "OldCity",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "primary_patron_id": primary,
            "secondary_patron_id": secondary,
            "conflict_resolutions": [
                {"type": "field_conflict", "field": "alias", "resolution": "custom", "custom_value": "CustomAlias"},
                {"type": "field_conflict", "field": "city", "resolution": "custom", "custom_value": "CustomCity"},
            ]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);

    let resp = c
        .post(format!("{}/api/v1/current/patron/details", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"patron_id": primary}))
        .send()
        .await
        .unwrap();
    let merged = resp.json::<serde_json::Value>().await.unwrap()["patron"].clone();
    assert_eq!(merged["alias"].as_str(), Some("CustomAlias"));
    assert_eq!(merged["city"].as_str(), Some("CustomCity"));
}

#[tokio::test]
async fn merge_execute_transfers_incident_involvement() {
    // Create an incident with the secondary patron involved; after
    // merge, the primary patron should be involved instead.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let primary = create_named_patron(&c, &token, "MergeXferA", "Aaa").await;
    let secondary = create_named_patron(&c, &token, "MergeXferB", "Bbb").await;

    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": "merge-incident-xfer fixture",
            "description": "secondary patron involved",
            "involved_parties": [
                {"party_type": "patron", "patron_id": secondary},
            ],
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let incident_id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"primary_patron_id": primary, "secondary_patron_id": secondary}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        data["data_transferred"]["incidents"].as_i64(),
        Some(1),
        "one incident involvement should have transferred"
    );

    // Verify by reading the incident: involved_parties should now
    // reference the primary patron.
    let resp = c
        .post(format!("{}/api/v1/current/incident/get", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"id": incident_id, "options": {"with_involved_parties": true}}))
        .send()
        .await
        .unwrap();
    let data: serde_json::Value = resp.json().await.unwrap();
    let parties = data["involved_parties"].as_array().unwrap();
    let patron_ids: Vec<i64> = parties
        .iter()
        .filter_map(|p| p["patron_id"].as_i64())
        .collect();
    assert!(
        patron_ids.contains(&primary),
        "primary patron should now be on the incident; got {patron_ids:?}"
    );
    assert!(
        !patron_ids.contains(&secondary),
        "secondary patron should no longer be on the incident; got {patron_ids:?}"
    );
}

#[tokio::test]
async fn merge_execute_lifts_chosen_secondary_ban() {
    // Two patrons each with a ban at the same org → ban conflict.
    // Resolve by keeping primary's; merge_execute should lift the
    // secondary's ban (lifts_at <= now) and the merge_patrons
    // function transfers what's left.
    let c = client();
    let token = login_token(&c, &COORD).await;
    let primary = create_named_patron(&c, &token, "MergeBanA", "L").await;
    let secondary = create_named_patron(&c, &token, "MergeBanB", "L").await;

    // Each patron needs an incident first (ban.create FKs to incident).
    let make_ban_for = |patron_id: i64| {
        let c = c.clone();
        let token = token.clone();
        async move {
            let incident_resp = c
                .post(format!("{}/api/v1/current/incident/create", current_base()))
                .headers(auth_header(&token))
                .json(&json!({
                    "org_unit": test_org_unit().await,
                    "title": format!("merge-ban fixture for {patron_id}"),
                    "description": "merge ban fixture",
                    "involved_parties": [
                        {"party_type": "patron", "patron_id": patron_id}
                    ],
                }))
                .send()
                .await
                .unwrap();
            let incident_id = incident_resp.json::<serde_json::Value>().await.unwrap()["id"]
                .as_i64()
                .unwrap();
            let ban_resp = c
                .post(format!("{}/api/v1/current/ban/create", current_base()))
                .headers(auth_header(&token))
                .json(&json!({
                    "patron": patron_id,
                    "incident": incident_id,
                    "org_unit": test_org_unit().await,
                }))
                .send()
                .await
                .unwrap();
            assert_eq!(ban_resp.status(), 200);
            ban_resp.json::<serde_json::Value>().await.unwrap()["patron_ban"]["id"]
                .as_i64()
                .unwrap()
        }
    };
    let primary_ban_id = make_ban_for(primary).await;
    let secondary_ban_id = make_ban_for(secondary).await;

    let resp = c
        .post(format!("{}/api/v1/current/patron/merge", current_base()))
        .headers(auth_header(&token))
        .json(&json!({
            "primary_patron_id": primary,
            "secondary_patron_id": secondary,
            "ban_resolutions": [
                {
                    "primary_ban_id": primary_ban_id,
                    "secondary_ban_id": secondary_ban_id,
                    "resolution": "primary"
                }
            ]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "body: {:?}", resp.text().await);

    // After merge, the primary ban is still active; the secondary ban
    // is lifted (lifts_at <= now). They both transferred to the primary
    // patron in the process, so we look up both via ban/details.
    let kept = c
        .post(format!("{}/api/v1/current/ban/details", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"ban_id": primary_ban_id}))
        .send()
        .await
        .unwrap();
    assert_eq!(kept.status(), 200);
    let kept_data: serde_json::Value = kept.json().await.unwrap();
    assert_eq!(kept_data["ban"]["patron"].as_i64(), Some(primary));

    let lifted = c
        .post(format!("{}/api/v1/current/ban/details", current_base()))
        .headers(auth_header(&token))
        .json(&json!({"ban_id": secondary_ban_id}))
        .send()
        .await
        .unwrap();
    assert_eq!(lifted.status(), 200);
    let lifted_data: serde_json::Value = lifted.json().await.unwrap();
    assert_eq!(lifted_data["ban"]["patron"].as_i64(), Some(primary));
    // lifts_at should be a present-ish year (not the default
    // 30-days-out future). ISO timestamps lexicographically sort, so
    // comparing the year prefix is enough to distinguish "lifted now"
    // from "30 days out".
    let lifts_at = lifted_data["ban"]["lifts_at"].as_str().unwrap();
    let year_prefix = &lifts_at[..4];
    // Current year. Whatever year the test runs in, lifted_at should
    // match it (or be in the past if a test runs across a year
    // boundary — extremely unlikely). The default ban-create lift
    // date is now+30d, so if the lift didn't fire we'd see a date in
    // the same year, OR rarely the next. Stronger check: compare
    // against the original ban's lifts_at, which was 30d in the
    // future.
    let kept_lifts_at = kept_data["ban"]["lifts_at"].as_str().unwrap();
    assert!(
        lifts_at < kept_lifts_at,
        "secondary ban's lifts_at should be earlier than the still-active primary ban's; got lifted={lifts_at} kept={kept_lifts_at}"
    );
    let _ = year_prefix; // touched above for future use
    // Comments should include the merge reason.
    let comments = lifted_data["ban"]["comments"].as_str().unwrap_or("");
    assert!(
        comments.contains("Lifted via patron merge"),
        "lifted ban's comments should mention the merge reason; got {comments:?}"
    );
}
