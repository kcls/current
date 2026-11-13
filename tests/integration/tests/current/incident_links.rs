// Related and follow-up incidents (incident_links).
//
// A follow-up copies its source's org unit, title, templates and involved
// parties, and can never carry bans. A related incident is an ordinary
// create with `related_incident_id`.
//
// Not covered: `linked_incidents` omitting incidents at org units the
// caller cannot read. Every fixture user holds a role at the root, so
// none can be denied read at a single branch.

use integration_tests::*;
use serde_json::{Value, json};

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

async fn first_template_id(c: &reqwest::Client, token: &str) -> i64 {
    let data = post_ok(c, token, "template/list", json!({})).await;
    data[0]["id"].as_i64().expect("at least one template")
}

/// A source incident at MAIN with a template, an unknown patron and a
/// staff party. Returns its id.
async fn create_source(c: &reqwest::Client, token: &str, title: &str) -> i64 {
    let template_id = first_template_id(c, token).await;
    let data = post_ok(
        c,
        token,
        "incident/create",
        json!({
            "org_unit": unit_by_code("MAIN").await,
            "title": title,
            "description": "source incident",
            "template_ids": [template_id],
            "involved_parties": [
                {"party_type": "patron", "is_unknown_patron": true, "role": "subject"},
                {"party_type": "staff", "staff_id": COORD.uuid, "role": "witness"}
            ]
        }),
    )
    .await;
    data["id"].as_i64().unwrap()
}

async fn create_followup(c: &reqwest::Client, token: &str, source_id: i64) -> i64 {
    let data = post_ok(
        c,
        token,
        "incident/followup/create",
        json!({
            "source_incident_id": source_id,
            "description": "follow-up narrative",
            "occurred_at": "2026-10-01T15:30:00-07:00"
        }),
    )
    .await;
    data["id"].as_i64().unwrap()
}

async fn get_full(c: &reqwest::Client, token: &str, id: i64) -> Value {
    post_ok(
        c,
        token,
        "incident/get",
        json!({
            "id": id,
            "options": {"with_involved_parties": true, "with_linked_incidents": true}
        }),
    )
    .await
}

fn party_keys(incident: &Value) -> Vec<(String, Option<i64>, Option<String>, Option<String>)> {
    let mut keys: Vec<_> = incident["involved_parties"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["party_type"].as_str().unwrap().to_string(),
                p["patron_id"].as_i64(),
                p["staff_id"].as_str().map(str::to_string),
                p["role"].as_str().map(str::to_string),
            )
        })
        .collect();
    keys.sort();
    keys
}

// --- incident.followup.create ---

#[tokio::test]
async fn create_followup_requires_auth() {
    let c = client();
    let resp = c
        .post(format!("{}/api/v1/current/incident/followup/create", current_base()))
        .json(&json!({"source_incident_id": 1, "description": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn create_followup_copies_source() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-copy source").await;
    let followup_id = create_followup(&c, &token, source_id).await;

    let source = get_full(&c, &token, source_id).await;
    let followup = get_full(&c, &token, followup_id).await;

    assert_eq!(followup["org_unit"], source["org_unit"]);
    assert_eq!(followup["title"], source["title"]);
    assert_eq!(followup["template_ids"], source["template_ids"]);
    assert!(followup["sub_location"].is_null());
    assert_eq!(followup["description"], "follow-up narrative");
    assert_eq!(
        chrono::DateTime::parse_from_rfc3339(followup["occurred_at"].as_str().unwrap()).unwrap(),
        chrono::DateTime::parse_from_rfc3339("2026-10-01T15:30:00-07:00").unwrap()
    );
    // Same patron (the unknown patron is reused, not re-created) and staff.
    assert_eq!(party_keys(&followup), party_keys(&source));

    assert_eq!(followup["followup_of"], source_id);
    assert!(source["followup_of"].is_null());

    let links = followup["linked_incidents"].as_array().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["incident_id"], source_id);
    assert_eq!(links[0]["link_type"], "followup");
    assert_eq!(links[0]["direction"], "references");

    let links = source["linked_incidents"].as_array().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["incident_id"], followup_id);
    assert_eq!(links[0]["direction"], "referenced_by");
}

#[tokio::test]
async fn create_followup_logs_on_source() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-activity source").await;
    let followup_id = create_followup(&c, &token, source_id).await;

    let data = post_ok(&c, &token, "incident/activity", json!({"incident_id": source_id})).await;
    let entry = data["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["event_type"] == "incident.followup_created")
        .expect("incident.followup_created on the source");
    assert_eq!(entry["event_data"]["linked_incident_id"], followup_id);
}

#[tokio::test]
async fn create_followup_of_followup_links_immediate_source() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-chain source").await;
    let first = create_followup(&c, &token, source_id).await;
    let second = create_followup(&c, &token, first).await;

    let data = get_full(&c, &token, second).await;
    assert_eq!(data["followup_of"], first);
    // Parties carried down the chain.
    let source = get_full(&c, &token, source_id).await;
    assert_eq!(party_keys(&data), party_keys(&source));
}

#[tokio::test]
async fn create_followup_rejects_blank_description() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-blank source").await;
    let resp = post(
        &c,
        &token,
        "incident/followup/create",
        json!({"source_incident_id": source_id, "description": "   "}),
    )
    .await;
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn create_followup_unknown_source_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = post(
        &c,
        &token,
        "incident/followup/create",
        json!({"source_incident_id": i32::MAX, "description": "x"}),
    )
    .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn create_followup_of_deleted_source_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-deleted source").await;
    post_ok(&c, &token, "incident/update", json!({"id": source_id, "is_deleted": true})).await;

    let resp = post(
        &c,
        &token,
        "incident/followup/create",
        json!({"source_incident_id": source_id, "description": "x"}),
    )
    .await;
    assert_eq!(resp.status(), 404);
}

// --- bans never attach to a follow-up ---

#[tokio::test]
async fn ban_create_on_followup_is_rejected() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-ban source").await;
    let followup_id = create_followup(&c, &token, source_id).await;
    let followup = get_full(&c, &token, followup_id).await;
    let patron_id = followup["involved_parties"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|p| p["patron_id"].as_i64())
        .unwrap();

    let resp = post(
        &c,
        &token,
        "ban/create",
        json!({
            "patron": patron_id,
            "incident": followup_id,
            "org_unit": followup["org_unit"],
        }),
    )
    .await;
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn ban_extend_and_letter_citing_followup_are_rejected() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-extend source").await;
    let source = get_full(&c, &token, source_id).await;
    let patron_id = source["involved_parties"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|p| p["patron_id"].as_i64())
        .unwrap();

    // The ban belongs to the source, which is allowed.
    let ban = post_ok(
        &c,
        &token,
        "ban/create",
        json!({"patron": patron_id, "incident": source_id, "org_unit": source["org_unit"]}),
    )
    .await;
    let ban_id = ban["patron_ban"]["id"].as_i64().unwrap();
    let followup_id = create_followup(&c, &token, source_id).await;

    let resp = post(
        &c,
        &token,
        "ban/extend",
        json!({
            "ban_id": ban_id,
            "lifts_at": "2030-01-01T00:00:00Z",
            "incident": followup_id,
        }),
    )
    .await;
    assert_eq!(resp.status(), 400, "extend citing a follow-up");

    let resp = post(
        &c,
        &token,
        "ban/letter/create",
        json!({"ban_id": ban_id, "content": "letter", "incident": followup_id}),
    )
    .await;
    assert_eq!(resp.status(), 400, "letter citing a follow-up");
}

// --- incident.create with related_incident_id ---

#[tokio::test]
async fn create_related_incident_links_both_ways() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "related source").await;

    // A related incident is independent: any org unit, its own parties.
    let data = post_ok(
        &c,
        &token,
        "incident/create",
        json!({
            "org_unit": unit_by_code("HILL").await,
            "title": "related incident",
            "description": "independent but related",
            "related_incident_id": source_id,
        }),
    )
    .await;
    let related_id = data["id"].as_i64().unwrap();

    let related = get_full(&c, &token, related_id).await;
    assert!(related["followup_of"].is_null());
    assert_eq!(related["involved_parties"].as_array().unwrap().len(), 0);
    let links = related["linked_incidents"].as_array().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["incident_id"], source_id);
    assert_eq!(links[0]["link_type"], "related");
    assert_eq!(links[0]["direction"], "references");

    let source = get_full(&c, &token, source_id).await;
    let back = source["linked_incidents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["incident_id"] == related_id)
        .expect("source lists the related incident");
    assert_eq!(back["link_type"], "related");
    assert_eq!(back["direction"], "referenced_by");
}

#[tokio::test]
async fn create_related_unknown_incident_returns_404() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let resp = post(
        &c,
        &token,
        "incident/create",
        json!({
            "org_unit": unit_by_code("MAIN").await,
            "title": "related to nothing",
            "description": "x",
            "related_incident_id": i32::MAX,
        }),
    )
    .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn linked_incidents_omitted_unless_requested() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "linked-omitted source").await;
    create_followup(&c, &token, source_id).await;

    let data = post_ok(&c, &token, "incident/get", json!({"id": source_id})).await;
    assert!(data.get("linked_incidents").is_none());
}

// --- incident.update: a follow-up's templates and sub-location are fixed ---

#[tokio::test]
async fn update_followup_accepts_unchanged_templates() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-update-same source").await;
    let followup_id = create_followup(&c, &token, source_id).await;
    let template_ids = get_full(&c, &token, followup_id).await["template_ids"].clone();

    // What the edit form sends on every save.
    post_ok(
        &c,
        &token,
        "incident/update",
        json!({"id": followup_id, "description": "edited", "template_ids": template_ids}),
    )
    .await;
    let data = get_full(&c, &token, followup_id).await;
    assert_eq!(data["description"], "edited");
    assert_eq!(data["template_ids"], template_ids);
}

#[tokio::test]
async fn update_followup_rejects_template_change() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-update-tpl source").await;
    let followup_id = create_followup(&c, &token, source_id).await;
    let before = get_full(&c, &token, followup_id).await["template_ids"].clone();

    let templates = post_ok(&c, &token, "template/list", json!({})).await;
    let other = templates
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["id"].as_i64())
        .find(|id| !before.as_array().unwrap().contains(&json!(id)))
        .expect("a second template");

    for template_ids in [json!([other]), json!([])] {
        let resp = post(
            &c,
            &token,
            "incident/update",
            json!({"id": followup_id, "template_ids": template_ids}),
        )
        .await;
        assert_eq!(resp.status(), 400, "template_ids {template_ids}");
    }
    assert_eq!(get_full(&c, &token, followup_id).await["template_ids"], before);
}

#[tokio::test]
async fn update_followup_rejects_sub_location() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "followup-update-subloc source").await;
    let followup_id = create_followup(&c, &token, source_id).await;
    let sub_locations = post_ok(&c, &token, "sub-location/list", json!({})).await;
    let sub_location = sub_locations[0]["id"].as_i64().expect("a sub-location");

    let resp = post(
        &c,
        &token,
        "incident/update",
        json!({"id": followup_id, "sub_location": sub_location}),
    )
    .await;
    assert_eq!(resp.status(), 400);
    assert!(get_full(&c, &token, followup_id).await["sub_location"].is_null());
}

#[tokio::test]
async fn update_related_incident_may_change_templates() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let source_id = create_source(&c, &token, "related-update source").await;
    let data = post_ok(
        &c,
        &token,
        "incident/create",
        json!({
            "org_unit": unit_by_code("MAIN").await,
            "title": "related, editable",
            "description": "x",
            "related_incident_id": source_id,
        }),
    )
    .await;
    let related_id = data["id"].as_i64().unwrap();
    let template_id = first_template_id(&c, &token).await;

    post_ok(
        &c,
        &token,
        "incident/update",
        json!({"id": related_id, "template_ids": [template_id]}),
    )
    .await;
    assert_eq!(get_full(&c, &token, related_id).await["template_ids"], json!([template_id]));
}

// --- incident.search: per-row link summary ---

#[tokio::test]
async fn search_rows_summarize_links() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    // Follow-ups inherit the title, so one unique token finds the group.
    let needle = format!("LINKSUMMARY{}", chrono::Utc::now().timestamp_micros());
    let source_id = create_source(&c, &token, &format!("{needle} source")).await;
    let followup_a = create_followup(&c, &token, source_id).await;
    let followup_b = create_followup(&c, &token, source_id).await;
    let related = post_ok(
        &c,
        &token,
        "incident/create",
        json!({
            "org_unit": unit_by_code("MAIN").await,
            "title": format!("{needle} related"),
            "description": "x",
            "related_incident_id": source_id,
        }),
    )
    .await["id"]
        .as_i64()
        .unwrap();
    // A deleted follow-up no longer counts.
    let deleted = create_followup(&c, &token, source_id).await;
    post_ok(&c, &token, "incident/update", json!({"id": deleted, "is_deleted": true})).await;

    let data = post_ok(&c, &token, "incident/search", json!({"query": needle, "limit": 50})).await;
    let rows = data["incidents"].as_array().unwrap();
    let row = |id: i64| {
        rows.iter()
            .find(|r| r["id"] == id)
            .unwrap_or_else(|| panic!("incident {id} in search results"))
    };

    let s = row(source_id);
    assert!(s["followup_of"].is_null());
    assert_eq!(s["followup_count"], 2);
    assert_eq!(s["related_count"], 1);

    for id in [followup_a, followup_b] {
        let f = row(id);
        assert_eq!(f["followup_of"], source_id);
        assert_eq!(f["followup_count"], 0);
        assert_eq!(f["related_count"], 0);
    }

    let r = row(related);
    assert!(r["followup_of"].is_null());
    assert_eq!(r["related_count"], 1);
}
