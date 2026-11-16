use integration_tests::*;
use serde_json::{Value, json};

// incident/move: relocating an incident to another org unit. MAIN has the
// e2e review chain (MANAGER level 1, COORD final); HILL has none.

/// incident-data @ root: read-only, holds no write permission anywhere.
const DATA: TestUser = TestUser {
    username: "e2e.current.data",
    password: "test123!",
    email: "e2e.current.data@current.example.org",
    uuid: "e2e00000-0000-4000-a000-000000000205",
};

async fn unit_by_code(code: &str) -> String {
    let c = client();
    let token = admin_token(&c).await;
    unit_uuid_by_code(&c, &token, code).await
}

async fn post(c: &reqwest::Client, token: &str, path: &str, body: Value) -> reqwest::Response {
    c.post(format!("{}/api/v1/current/{path}", current_base()))
        .json(&body)
        .headers(auth_header(token))
        .send()
        .await
        .unwrap()
}

async fn post_ok(c: &reqwest::Client, token: &str, path: &str, body: Value) -> Value {
    let resp = post(c, token, path, body).await;
    let status = resp.status();
    let text = resp.text().await.unwrap();
    assert_eq!(status, 200, "{path}: {text}");
    serde_json::from_str(&text).unwrap()
}

/// Create an incident at MAIN with one unknown-patron party; returns
/// (incident_id, patron_id).
async fn create_incident(c: &reqwest::Client, token: &str, title: &str) -> (i64, i64) {
    let created = post_ok(
        c,
        token,
        "incident/create",
        json!({
            "org_unit": unit_by_code("MAIN").await,
            "title": title,
            "description": "incident-move fixture",
            "involved_parties": [{"party_type": "patron", "is_unknown_patron": true}],
        }),
    )
    .await;
    let id = created["id"].as_i64().unwrap();
    let got = post_ok(
        c,
        token,
        "incident/get",
        json!({"id": id, "options": {"with_involved_parties": true}}),
    )
    .await;
    let patron = got["involved_parties"][0]["patron_id"].as_i64().unwrap();
    (id, patron)
}

async fn get_incident(c: &reqwest::Client, token: &str, id: i64) -> Value {
    post_ok(c, token, "incident/get", json!({"id": id})).await
}

async fn move_incident(c: &reqwest::Client, token: &str, body: Value) -> reqwest::Response {
    post(c, token, "incident/move", body).await
}

async fn review(c: &reqwest::Client, token: &str, id: i64, result: &str) {
    post_ok(
        c,
        token,
        "incident/review/create",
        json!({"incident": id, "result": result}),
    )
    .await;
}

async fn incident_event_types(c: &reqwest::Client, token: &str, id: i64) -> Vec<String> {
    let data = post_ok(c, token, "incident/activity", json!({"incident_id": id})).await;
    data["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["event_type"].as_str().unwrap().to_string())
        .collect()
}

async fn ban_event_types(c: &reqwest::Client, token: &str, ban_id: i64) -> Vec<String> {
    let data = post_ok(c, token, "ban/activity", json!({"ban_id": ban_id})).await;
    data["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["event_type"].as_str().unwrap().to_string())
        .collect()
}

/// Every incident the caller can act on at `org_unit`, all pages (the
/// queue is oldest-first, so a fresh incident is on the last page).
async fn pending_at(c: &reqwest::Client, token: &str, org_unit: &str) -> Vec<i64> {
    let mut ids = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let mut body = json!({"org_unit": org_unit, "limit": 100});
        if !cursor.is_null() {
            body["cursor"] = cursor;
        }
        let page = post_ok(c, token, "incident/pending-reviews", body).await;
        ids.extend(
            page["rows"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|r| r["can_review"].as_bool() == Some(true))
                .map(|r| r["id"].as_i64().unwrap()),
        );
        cursor = page["next_cursor"].clone();
        if cursor.is_null() {
            return ids;
        }
    }
}

// --- auth and validation ---

#[tokio::test]
async fn move_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/incident/move", current_base()))
        .json(&json!({"id": 1, "org_unit": unit_by_code("HILL").await}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn move_unknown_incident_returns_404() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let resp = move_incident(
        &c,
        &token,
        json!({"id": 2_000_000_000_i64, "org_unit": unit_by_code("HILL").await}),
    )
    .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn move_to_same_location_is_rejected() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let (id, _) = create_incident(&c, &token, "move-same-org").await;
    let resp = move_incident(
        &c,
        &token,
        json!({"id": id, "org_unit": unit_by_code("MAIN").await}),
    )
    .await;
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn move_requires_write_permission() {
    let c = client();
    let staff = login_token(&c, &STAFF).await;
    let (id, _) = create_incident(&c, &staff, "move-no-write").await;

    let data = login_token(&c, &DATA).await;
    let resp = move_incident(
        &c,
        &data,
        json!({"id": id, "org_unit": unit_by_code("HILL").await}),
    )
    .await;
    assert_eq!(resp.status(), 403);
    assert_eq!(
        get_incident(&c, &staff, id).await["org_unit"]
            .as_str()
            .unwrap(),
        unit_by_code("MAIN").await,
        "a refused move leaves the incident where it was"
    );
}

#[tokio::test]
async fn move_rejects_sub_location_not_visible_at_destination() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let (id, _) = create_incident(&c, &token, "move-bad-sub-location").await;
    let resp = move_incident(
        &c,
        &token,
        json!({"id": id, "org_unit": unit_by_code("HILL").await, "sub_location": MISSING_SUB_LOCATION}),
    )
    .await;
    assert_eq!(resp.status(), 400);
}

const MISSING_SUB_LOCATION: i64 = 2_000_000_000;

// --- draft incidents ---

#[tokio::test]
async fn move_draft_relocates_and_logs() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let (id, _) = create_incident(&c, &token, "move-draft").await;
    let hill = unit_by_code("HILL").await;

    // Any sub-location visible at the destination (inherited from an
    // ancestor counts) is accepted.
    let subs = post_ok(&c, &token, "sub-location/list", json!({"org_unit": hill})).await;
    let sub_location = subs
        .as_array()
        .unwrap()
        .first()
        .map(|s| s["id"].as_i64().unwrap());

    let mut body = json!({"id": id, "org_unit": hill});
    if let Some(sl) = sub_location {
        body["sub_location"] = json!(sl);
    }
    let resp = move_incident(&c, &token, body).await;
    assert_eq!(resp.status(), 200);
    let data: Value = resp.json().await.unwrap();
    assert_eq!(data["incident"]["org_unit"].as_str().unwrap(), hill);
    assert_eq!(
        data["previous_org_unit"].as_str().unwrap(),
        unit_by_code("MAIN").await
    );
    assert_eq!(data["returned_to_draft"].as_bool(), Some(false));
    assert!(data["moved_bans"].as_array().unwrap().is_empty());
    assert_eq!(data["incident"]["sub_location"].as_i64(), sub_location);

    assert_eq!(
        get_incident(&c, &token, id).await["org_unit"]
            .as_str()
            .unwrap(),
        hill
    );
    let kinds = incident_event_types(&c, &token, id).await;
    assert!(kinds.iter().any(|k| k == "incident.moved"), "got {kinds:?}");

    // Draft: no review row was written.
    let reviews = post_ok(&c, &token, "incident/review/list", json!({"incident": id})).await;
    assert!(reviews.as_array().unwrap().is_empty());
}

// --- review interaction ---

#[tokio::test]
async fn move_in_review_returns_to_draft() {
    let c = client();
    let staff = login_token(&c, &STAFF).await;
    let (id, _) = create_incident(&c, &staff, "move-in-review").await;
    review(&c, &staff, id, "submitted").await;
    let manager = login_token(&c, &MANAGER).await;
    assert!(
        pending_at(&c, &manager, &unit_by_code("MAIN").await)
            .await
            .contains(&id)
    );

    let resp = move_incident(
        &c,
        &staff,
        json!({"id": id, "org_unit": unit_by_code("HILL").await}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let data: Value = resp.json().await.unwrap();
    assert_eq!(data["returned_to_draft"].as_bool(), Some(true));

    let reviews = post_ok(&c, &staff, "incident/review/list", json!({"incident": id})).await;
    let rows = reviews.as_array().unwrap();
    let results: Vec<&str> = rows.iter().map(|r| r["result"].as_str().unwrap()).collect();
    assert_eq!(results, vec!["submitted", "returned"]);
    let last = rows.last().unwrap();
    assert_eq!(last["min_review_level"].as_i64(), Some(0));
    assert!(
        last["comments"].as_str().unwrap().starts_with("Moved from"),
        "returned row explains the move: {last}"
    );

    // Gone from the old chain's queue: MAIN's level-1 reviewer no longer
    // has it pending.
    assert!(
        !pending_at(&c, &manager, &unit_by_code("MAIN").await)
            .await
            .contains(&id)
    );
}

#[tokio::test]
async fn move_resolved_requires_final_reviewer_at_destination() {
    let c = client();
    // COORD is MAIN's final reviewer, so submitting auto-resolves.
    let coord = login_token(&c, &COORD).await;
    let (id, _) = create_incident(&c, &coord, "move-resolved").await;
    review(&c, &coord, id, "submitted").await;
    assert!(get_incident(&c, &coord, id).await["resolved_at"].is_string());

    let hill = unit_by_code("HILL").await;

    // Final at MAIN means nothing at HILL.
    let resp = move_incident(&c, &coord, json!({"id": id, "org_unit": hill})).await;
    assert_eq!(resp.status(), 403);
    let staff = login_token(&c, &STAFF).await;
    let resp = move_incident(&c, &staff, json!({"id": id, "org_unit": hill})).await;
    assert_eq!(resp.status(), 403);

    // incident-admin counts as a final reviewer everywhere.
    let admin = login_token(&c, &ADMIN).await;
    let resp = move_incident(&c, &admin, json!({"id": id, "org_unit": hill})).await;
    assert_eq!(resp.status(), 200);
    let data: Value = resp.json().await.unwrap();
    assert_eq!(data["returned_to_draft"].as_bool(), Some(false));
    let after = get_incident(&c, &admin, id).await;
    assert_eq!(after["org_unit"].as_str().unwrap(), hill);
    assert!(
        after["resolved_at"].is_string(),
        "stays resolved after a move"
    );
}

// --- bans and trespasses ---

#[tokio::test]
async fn move_carries_bans_and_keeps_letters() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let (id, patron) = create_incident(&c, &token, "move-with-ban").await;
    let main = unit_by_code("MAIN").await;
    let hill = unit_by_code("HILL").await;

    let created = post_ok(
        &c,
        &token,
        "ban/create",
        json!({
            "patron": patron,
            "incident": id,
            "org_unit": main,
            "is_trespass": true,
            "ban_letter_content": "Letter naming Main Street",
        }),
    )
    .await;
    let ban_id = created["patron_ban"]["id"].as_i64().unwrap();
    let letter_id = created["ban_letter_id"].as_i64().unwrap();

    let resp = move_incident(&c, &token, json!({"id": id, "org_unit": hill})).await;
    assert_eq!(resp.status(), 200);
    let data: Value = resp.json().await.unwrap();
    let moved = data["moved_bans"].as_array().unwrap();
    assert_eq!(moved.len(), 1);
    assert_eq!(moved[0]["id"].as_i64(), Some(ban_id));
    assert_eq!(moved[0]["is_trespass"].as_bool(), Some(true));
    assert_eq!(moved[0]["is_archived"].as_bool(), Some(false));

    let details = post_ok(&c, &token, "ban/details", json!({"ban_id": ban_id})).await;
    assert_eq!(details["ban"]["org_unit"].as_str().unwrap(), hill);
    let letters = details["letters"].as_array().unwrap();
    assert_eq!(letters.len(), 1, "existing letter is left in place");
    assert_eq!(letters[0]["id"].as_i64(), Some(letter_id));
    let letter = post_ok(
        &c,
        &token,
        "ban/letter/get",
        json!({"letter_id": letter_id}),
    )
    .await;
    assert_eq!(
        letter["letter"]["content"].as_str(),
        Some("Letter naming Main Street")
    );

    let kinds = ban_event_types(&c, &token, ban_id).await;
    assert!(kinds.iter().any(|k| k == "ban.moved"), "got {kinds:?}");
}

#[tokio::test]
async fn move_leaves_bans_the_incident_only_extended() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let main = unit_by_code("MAIN").await;

    // Ban created on incident A...
    let (a, patron) = create_incident(&c, &token, "move-extend-source").await;
    let created = post_ok(
        &c,
        &token,
        "ban/create",
        json!({"patron": patron, "incident": a, "org_unit": main}),
    )
    .await;
    let ban_id = created["patron_ban"]["id"].as_i64().unwrap();

    // ...extended from incident B.
    let (b, _) = create_incident(&c, &token, "move-extend-other").await;
    let lifts_at = (chrono::Utc::now() + chrono::Duration::days(90)).to_rfc3339();
    post_ok(
        &c,
        &token,
        "ban/extend",
        json!({"ban_id": ban_id, "lifts_at": lifts_at, "incident": b}),
    )
    .await;

    // Moving B does not move A's ban.
    let resp = move_incident(
        &c,
        &token,
        json!({"id": b, "org_unit": unit_by_code("HILL").await}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let data: Value = resp.json().await.unwrap();
    assert!(data["moved_bans"].as_array().unwrap().is_empty());
    let details = post_ok(&c, &token, "ban/details", json!({"ban_id": ban_id})).await;
    assert_eq!(details["ban"]["org_unit"].as_str().unwrap(), main);
}

// --- follow-ups ---

#[tokio::test]
async fn move_source_leaves_followups_in_place() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let (source, _) = create_incident(&c, &token, "move-followup-source").await;
    let followup = post_ok(
        &c,
        &token,
        "incident/followup/create",
        json!({"source_incident_id": source, "description": "follow-up"}),
    )
    .await["id"]
        .as_i64()
        .unwrap();

    let hill = unit_by_code("HILL").await;
    let resp = move_incident(&c, &token, json!({"id": source, "org_unit": hill})).await;
    assert_eq!(resp.status(), 200);
    assert_eq!(
        get_incident(&c, &token, followup).await["org_unit"]
            .as_str()
            .unwrap(),
        unit_by_code("MAIN").await
    );

    // A follow-up can be moved on its own, but never gains a sub-location.
    let resp = move_incident(
        &c,
        &token,
        json!({"id": followup, "org_unit": hill, "sub_location": 1}),
    )
    .await;
    assert_eq!(resp.status(), 400);
    let resp = move_incident(&c, &token, json!({"id": followup, "org_unit": hill})).await;
    assert_eq!(resp.status(), 200);
}
