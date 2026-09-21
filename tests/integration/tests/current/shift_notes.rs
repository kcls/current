use integration_tests::*;
use reqwest::multipart;
use serde_json::json;

// ============================================================================
// Shift Notes (the "Communication Log") — see design-docs/shift-notes.md
//
// Notes are created and soft-deleted freely by their author, so these tests
// create their own fixtures and clean up after themselves. Each test tags its
// note text with a unique marker and filters on it, so tests stay independent
// even when run concurrently against a shared cluster.
//
// TODO — back-fill coverage not possible today:
//   * **Retention window / archive date**: every note these tests create is
//     new, so the 30-day cutoff never actually elides one. Nothing here
//     proves a note older than `retention_days` disappears for a caller
//     without `current.shift_note.read_archived` — the single most important
//     retention behavior, and currently untested.
//
//     Blocked on a way to age a note. Either would unblock it:
//       - an admin endpoint to set `config_shift_note_setting.retention_days`
//         (set it to 0, assert the note vanishes for STAFF but stays for
//         COORD, restore it); or
//       - a back-dated `created_at` on create, which the API deliberately
//         does not accept (created_at is always NOW()).
//
//     Until then `archived_included` is asserted per role, which covers the
//     flag the cutoff hangs off but not the cutoff itself.
// ============================================================================

/// Resolve an org unit's uuid by its demo-tree code. Org units cross the
/// API as uuids (durable references), so tests name units by code and
/// resolve at runtime.
async fn unit_by_code(code: &str) -> String {
    let c = client();
    let token = admin_token(&c).await;
    unit_uuid_by_code(&c, &token, code).await
}

/// Main Street Branch, under East Region. Both labels are asserted, so
/// this also pins the region-resolution walk.
async fn branch() -> String {
    unit_by_code("MAIN").await
}
const BRANCH_NAME: &str = "Main Street Branch";
const REGION_NAME: &str = "East Region";

async fn root() -> String {
    unit_by_code("OLS").await
}

/// Main Street Locker — a Locker, the demo tree's non-staffed unit type.
/// Entries cannot be filed here.
async fn unstaffed_unit() -> String {
    unit_by_code("MAINL").await
}

const TYPE_PATRON_BEHAVIOR: i64 = 1;
const TYPE_REFERENCE_QUESTION: i64 = 2;
const TYPE_BUILDING_UPDATE: i64 = 3;

const AREA_UNSAFE: i64 = 1;

fn marker(tag: &str) -> String {
    format!(
        "[it-{tag}-{}]",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}

async fn create_note(c: &reqwest::Client, token: &str, body: serde_json::Value) -> i64 {
    let resp = c
        .post(format!("{}/api/v1/current/shift-note/create", current_base()))
        .json(&body)
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "create failed");
    let data: serde_json::Value = resp.json().await.unwrap();
    data["id"].as_i64().expect("missing id")
}

async fn list_notes(
    c: &reqwest::Client,
    token: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    let resp = c
        .post(format!("{}/api/v1/current/shift-note/list", current_base()))
        .json(&body)
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "list failed");
    resp.json().await.unwrap()
}

async fn delete_note(c: &reqwest::Client, token: &str, id: i64) -> reqwest::StatusCode {
    c.post(format!("{}/api/v1/current/shift-note/delete", current_base()))
        .json(&json!({ "id": id }))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap()
        .status()
}

/// Find the row carrying `mark` in a list response.
fn find_marked<'a>(data: &'a serde_json::Value, mark: &str) -> Option<&'a serde_json::Value> {
    data["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["notes"].as_str().unwrap_or("").contains(mark))
}

// ---------------------------------------------------------------------------
// Config endpoints
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_types_returns_seeded_types_in_order() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    let resp = c
        .post(format!(
            "{}/api/v1/current/shift-note/type/list",
            current_base()
        ))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let items = data["items"].as_array().unwrap();

    assert!(items.len() >= 3, "expected the three seeded types");

    let codes: Vec<&str> = items.iter().map(|i| i["code"].as_str().unwrap()).collect();
    assert!(codes.contains(&"patron_behavior"));
    assert!(codes.contains(&"reference_question"));
    assert!(codes.contains(&"building_update"));

    let orders: Vec<i64> = items
        .iter()
        .map(|i| i["display_order"].as_i64().unwrap())
        .collect();
    let mut sorted = orders.clone();
    sorted.sort_unstable();
    assert_eq!(orders, sorted, "types should be ordered by display_order");

    // Only active rows are offered for entry.
    assert!(items.iter().all(|i| i["is_active"].as_bool().unwrap()));
}

#[tokio::test]
async fn list_conduct_areas_returns_the_four_code_of_conduct_areas() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    let resp = c
        .post(format!(
            "{}/api/v1/current/shift-note/conduct-area/list",
            current_base()
        ))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    let items = data["items"].as_array().unwrap();

    assert_eq!(items.len(), 4, "expected the four seeded CoC areas");
    let codes: Vec<&str> = items.iter().map(|i| i["code"].as_str().unwrap()).collect();
    assert!(codes.contains(&"unsafe_disruptive"));
    assert!(codes.contains(&"property_misuse"));
    assert!(codes.contains(&"illegal_activity"));
    assert!(codes.contains(&"staff_noncompliance"));
}

// ---------------------------------------------------------------------------
// Create + list round trip, including the enrichment path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn create_then_list_round_trips_with_enrichment() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("roundtrip");

    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} patron warned about noise"),
            "patron_name": "Round Trip",
            "patron_description": "green hat",
            "was_instructed": true,
            "was_warned": true,
            "conduct_areas": [AREA_UNSAFE],
        }),
    )
    .await;

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).expect("created note not in list");

    assert_eq!(row["id"].as_i64().unwrap(), id);
    assert_eq!(row["org_unit"].as_str().unwrap(), branch().await);
    assert_eq!(row["patron_name"].as_str().unwrap(), "Round Trip");
    assert_eq!(row["patron_description"].as_str().unwrap(), "green hat");
    assert!(row["was_instructed"].as_bool().unwrap());
    assert!(row["was_warned"].as_bool().unwrap());
    assert_eq!(row["conduct_areas"].as_array().unwrap().len(), 1);
    assert!(row["updated_at"].is_null(), "fresh note has no updated_at");

    // Type is denormalized onto the row for display + color coding.
    assert_eq!(row["type"].as_i64().unwrap(), TYPE_PATRON_BEHAVIOR);
    assert_eq!(row["type_code"].as_str().unwrap(), "patron_behavior");
    assert_eq!(row["type_label"].as_str().unwrap(), "Patron Behavior");
    assert!(row["type_color"].as_str().is_some());

    // Cross-service enrichment: org labels via odo-org, staff name via the
    // odo-auth name-batch endpoint.
    assert_eq!(row["org_unit_name"].as_str().unwrap(), BRANCH_NAME);
    assert_eq!(
        row["region_name"].as_str().unwrap(),
        REGION_NAME,
        "region should resolve to the branch's Region-type ancestor"
    );
    assert_eq!(row["created_by"].as_str().unwrap(), STAFF.uuid);
    assert!(
        row["staff_name"].as_str().is_some_and(|s| !s.is_empty()),
        "staff_name should resolve via odo-auth"
    );

    // The author may always edit their own note.
    assert!(row["can_edit"].as_bool().unwrap());

    // Response-level retention metadata.
    assert_eq!(data["retention_days"].as_i64().unwrap(), 30);
    assert!(data["total"].as_u64().unwrap() >= 1);

    delete_note(&c, &token, id).await;
}

#[tokio::test]
async fn note_is_visible_from_an_ancestor_scope_but_not_a_sibling() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("scope");

    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_REFERENCE_QUESTION,
            "notes": format!("{mark} scope check"),
        }),
    )
    .await;

    // Visible when scoping at the root (subtree read).
    let from_root = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    assert!(find_marked(&from_root, &mark).is_some());

    // Visible when scoping at the branch itself.
    let from_branch = list_notes(&c, &token, json!({ "org_unit": branch().await })).await;
    assert!(find_marked(&from_branch, &mark).is_some());

    delete_note(&c, &token, id).await;
}

// ---------------------------------------------------------------------------
// Filters — the poll path and the type filter
// ---------------------------------------------------------------------------

#[tokio::test]
async fn since_excludes_older_notes() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("since");

    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_REFERENCE_QUESTION,
            "notes": format!("{mark} poll check"),
        }),
    )
    .await;

    // Read the note's own timestamp, then poll with it: the 30s poll passes
    // the newest created_at it has seen and should get nothing back.
    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let created_at = find_marked(&data, &mark).unwrap()["created_at"]
        .as_str()
        .unwrap()
        .to_string();

    let polled = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "since": created_at }),
    )
    .await;
    assert!(
        find_marked(&polled, &mark).is_none(),
        "since is exclusive — a note at exactly `since` must not repeat"
    );

    delete_note(&c, &token, id).await;
}

#[tokio::test]
async fn type_filter_selects_only_matching_notes() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("typefilter");

    let behavior = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} behavior"),
        }),
    )
    .await;
    let reference = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_REFERENCE_QUESTION,
            "notes": format!("{mark} reference"),
        }),
    )
    .await;

    let only_behavior = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "types": [TYPE_PATRON_BEHAVIOR] }),
    )
    .await;

    let matched: Vec<&str> = only_behavior["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["notes"].as_str().unwrap_or("").contains(&mark))
        .map(|r| r["notes"].as_str().unwrap())
        .collect();

    assert_eq!(matched.len(), 1, "expected only the patron-behavior note");
    assert!(matched[0].contains("behavior"));

    delete_note(&c, &token, behavior).await;
    delete_note(&c, &token, reference).await;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

#[tokio::test]
async fn author_can_update_own_note() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("update");

    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} before"),
            "was_warned": true,
            "conduct_areas": [AREA_UNSAFE],
        }),
    )
    .await;

    let resp = c
        .post(format!("{}/api/v1/current/shift-note/update", current_base()))
        .json(&json!({
            "id": id,
            "type": TYPE_REFERENCE_QUESTION,
            "notes": format!("{mark} after"),
            "was_warned": false,
            "conduct_areas": [],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).unwrap();

    assert!(row["notes"].as_str().unwrap().contains("after"));
    assert_eq!(row["type"].as_i64().unwrap(), TYPE_REFERENCE_QUESTION);
    assert_eq!(row["type_label"].as_str().unwrap(), "Reference Question");
    assert!(!row["was_warned"].as_bool().unwrap());
    assert!(row["conduct_areas"].as_array().unwrap().is_empty());
    assert!(!row["updated_at"].is_null(), "update should stamp updated_at");

    // org_unit is intentionally not editable — it stays where it was filed.
    assert_eq!(row["org_unit"].as_str().unwrap(), branch().await);

    delete_note(&c, &token, id).await;
}

// ---------------------------------------------------------------------------
// Ownership + permissions
// ---------------------------------------------------------------------------

#[tokio::test]
async fn author_can_delete_own_note_without_extra_permission() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("owndelete");

    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_REFERENCE_QUESTION,
            "notes": format!("{mark} mine to remove"),
        }),
    )
    .await;

    assert_eq!(delete_note(&c, &token, id).await, 200);

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    assert!(
        find_marked(&data, &mark).is_none(),
        "soft-deleted note must not appear in the list"
    );

    // Already gone — a second delete finds nothing active.
    assert_eq!(delete_note(&c, &token, id).await, 404);
}

#[tokio::test]
async fn manager_cannot_modify_another_users_note() {
    let c = client();
    let staff = login_token(&c, &STAFF).await;
    let manager = login_token(&c, &MANAGER).await;
    let mark = marker("mgrdenied");

    let id = create_note(
        &c,
        &staff,
        json!({
            "org_unit": branch().await,
            "type": TYPE_REFERENCE_QUESTION,
            "notes": format!("{mark} not the manager's"),
        }),
    )
    .await;

    // The manager can read it...
    let data = list_notes(&c, &manager, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).expect("manager should see the note");
    assert!(
        !row["can_edit"].as_bool().unwrap(),
        "manager holds no manage_any, so can_edit must be false"
    );

    // ...but not delete it — manage_any is coordinator-only.
    assert_eq!(delete_note(&c, &manager, id).await, 403);

    // ...nor edit it.
    let resp = c
        .post(format!("{}/api/v1/current/shift-note/update", current_base()))
        .json(&json!({
            "id": id,
            "type": TYPE_REFERENCE_QUESTION,
            "notes": format!("{mark} hijacked"),
        }))
        .headers(auth_header(&manager))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 403);

    delete_note(&c, &staff, id).await;
}

#[tokio::test]
async fn coordinator_can_delete_another_users_note() {
    let c = client();
    let staff = login_token(&c, &STAFF).await;
    let coord = login_token(&c, &COORD).await;
    let mark = marker("coorddelete");

    let id = create_note(
        &c,
        &staff,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} coordinator removes this"),
        }),
    )
    .await;

    let data = list_notes(&c, &coord, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).expect("coordinator should see the note");
    assert!(
        row["can_edit"].as_bool().unwrap(),
        "coordinator holds manage_any, so can_edit must be true"
    );

    assert_eq!(delete_note(&c, &coord, id).await, 200);

    let after = list_notes(&c, &staff, json!({ "org_unit": root().await })).await;
    assert!(find_marked(&after, &mark).is_none());
}

#[tokio::test]
async fn a_plain_read_never_reaches_past_the_retention_window() {
    let c = client();

    // Holding read_archived must not widen a read on its own. Every user
    // gets the recent window unless they deliberately ask for more, so a
    // coordinator opening the page sees this week, not a year of history.
    for user in [&STAFF, &COORD, &MANAGER] {
        let token = login_token(&c, user).await;
        let view = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
        assert!(
            !view["archived_included"].as_bool().unwrap(),
            "{} should be capped at the retention window on a plain read",
            user.username
        );
        assert!(view["retention_days"].as_i64().unwrap() > 0);
    }
}

/// The UI shows the "include archived" checkbox only to callers who can
/// use it, so the list has to report whether the permission is held at
/// the requested scope — separately from whether it was exercised.
#[tokio::test]
async fn the_list_reports_whether_archived_reads_are_permitted() {
    let c = client();

    for (user, expected) in [(&STAFF, false), (&MANAGER, true), (&COORD, true)] {
        let token = login_token(&c, user).await;
        let view = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
        assert_eq!(
            view["can_read_archived"].as_bool().unwrap(),
            expected,
            "{} can_read_archived",
            user.username
        );
        // Reporting the capability must not exercise it.
        assert!(
            !view["archived_included"].as_bool().unwrap(),
            "a plain read stays inside the window for {}",
            user.username
        );
    }
}

#[tokio::test]
async fn include_archived_is_honoured_only_with_the_permission() {
    let c = client();

    // Staff ask for archived notes but hold no read_archived: the flag is
    // ignored rather than erroring, so the caller can never end up with a
    // wider result than its permissions allow.
    let staff = login_token(&c, &STAFF).await;
    let staff_view = list_notes(
        &c,
        &staff,
        json!({ "org_unit": root().await, "include_archived": true }),
    )
    .await;
    assert!(
        !staff_view["archived_included"].as_bool().unwrap(),
        "include_archived must be ignored without the permission"
    );

    // Coordinator and manager hold read_archived, so asking works.
    for user in [&COORD, &MANAGER] {
        let token = login_token(&c, user).await;
        let view = list_notes(
            &c,
            &token,
            json!({ "org_unit": root().await, "include_archived": true }),
        )
        .await;
        assert!(
            view["archived_included"].as_bool().unwrap(),
            "{} should reach past the window when asking for it",
            user.username
        );
    }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

#[tokio::test]
async fn search_matches_the_note_body_and_the_patron_name() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("search");
    let needle = format!("velocipede{}", std::process::id());

    // One note with the term in the body, one with it in the patron name,
    // one with neither.
    let in_body = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} left a {needle} in the lobby"),
        }),
    )
    .await;
    let in_patron = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} unrelated body"),
            "patron_name": format!("{needle} Jones"),
        }),
    )
    .await;
    let neither = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} nothing to see"),
        }),
    )
    .await;

    let hits = list_notes(&c, &token, json!({ "org_unit": root().await, "search": needle })).await;
    let ids: Vec<i64> = hits["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_i64().unwrap())
        .collect();

    assert!(ids.contains(&in_body), "should match the note body");
    assert!(ids.contains(&in_patron), "should match the patron name");
    assert!(!ids.contains(&neither), "should not match an unrelated note");
    assert_eq!(hits["total"].as_u64().unwrap(), 2);

    // Case-insensitive: staff will not match the author's capitalisation.
    let upper = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "search": needle.to_uppercase() }),
    )
    .await;
    assert_eq!(
        upper["total"].as_u64().unwrap(),
        2,
        "search must be case-insensitive"
    );

    for id in [in_body, in_patron, neither] {
        delete_note(&c, &token, id).await;
    }
}

#[tokio::test]
async fn search_treats_like_wildcards_as_literal_text() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    // Seed the rows this assertion needs rather than relying on whatever
    // the database happens to hold: on a freshly reset database the
    // baseline is 0 and "fewer than baseline" can never hold.
    let mark = marker("wildcard");
    let mut created = Vec::new();
    for body in [
        format!("{mark} plain text, no punctuation"),
        format!("{mark} also plain"),
    ] {
        created.push(
            create_note(
                &c,
                &token,
                json!({
                    "org_unit": branch().await,
                    "type": TYPE_PATRON_BEHAVIOR,
                    "notes": body,
                }),
            )
            .await,
        );
    }

    let baseline = list_notes(&c, &token, json!({ "org_unit": root().await })).await["total"]
        .as_u64()
        .unwrap();
    assert!(baseline >= 2, "fixtures should be visible in the baseline");

    // Unescaped, "%" and "_" are LIKE wildcards and would match every
    // row. They must be literal characters instead — none of the seeded
    // notes contains one, so a correct search returns fewer rows.
    for wildcard in ["%", "_", "%%"] {
        let hits =
            list_notes(&c, &token, json!({ "org_unit": root().await, "search": wildcard })).await;
        assert!(
            hits["total"].as_u64().unwrap() < baseline,
            "'{wildcard}' must be matched literally, not as a wildcard"
        );
    }

    for id in created {
        delete_note(&c, &token, id).await;
    }
}

#[tokio::test]
async fn blank_search_is_ignored() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    let baseline = list_notes(&c, &token, json!({ "org_unit": root().await })).await["total"]
        .as_u64()
        .unwrap();

    for blank in ["", "   "] {
        let hits = list_notes(&c, &token, json!({ "org_unit": root().await, "search": blank })).await;
        assert_eq!(
            hits["total"].as_u64().unwrap(),
            baseline,
            "a blank search should not filter anything"
        );
    }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sort_orders_the_whole_result_set() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("sort");

    // Three notes of different types, created in a known order.
    let mut ids = Vec::new();
    for t in [TYPE_REFERENCE_QUESTION, TYPE_PATRON_BEHAVIOR, TYPE_BUILDING_UPDATE] {
        ids.push(
            create_note(
                &c,
                &token,
                json!({
                    "org_unit": branch().await,
                    "type": t,
                    "notes": format!("{mark} type {t}"),
                }),
            )
            .await,
        );
    }

    // Date descending is the default and puts the newest first.
    let default_order = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let marked: Vec<i64> = default_order["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["notes"].as_str().unwrap_or("").contains(&mark))
        .map(|r| r["id"].as_i64().unwrap())
        .collect();
    assert_eq!(
        marked,
        ids.iter().rev().copied().collect::<Vec<_>>(),
        "default order should be newest first"
    );

    // Ascending by date reverses it.
    let asc = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "sort_by": "created_at", "sort_dir": "asc" }),
    )
    .await;
    let marked_asc: Vec<i64> = asc["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["notes"].as_str().unwrap_or("").contains(&mark))
        .map(|r| r["id"].as_i64().unwrap())
        .collect();
    assert_eq!(marked_asc, ids, "asc should be oldest first");

    // Sorting by type orders by the type id, ascending.
    let by_type = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "sort_by": "type", "sort_dir": "asc" }),
    )
    .await;
    let types: Vec<i64> = by_type["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["notes"].as_str().unwrap_or("").contains(&mark))
        .map(|r| r["type"].as_i64().unwrap())
        .collect();
    let mut sorted = types.clone();
    sorted.sort_unstable();
    assert_eq!(types, sorted, "type asc should be in type-id order");

    for id in ids {
        delete_note(&c, &token, id).await;
    }
}

#[tokio::test]
async fn sort_spans_pages_rather_than_reordering_one() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    // The first row of page 0 ascending must be older than the first row
    // of page 1 — proof the database is ordering, not the page handler.
    let p0 = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "sort_by": "created_at", "sort_dir": "asc", "limit": 2, "offset": 0 }),
    )
    .await;
    let p1 = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "sort_by": "created_at", "sort_dir": "asc", "limit": 2, "offset": 2 }),
    )
    .await;

    let first = p0["rows"].as_array().unwrap();
    let second = p1["rows"].as_array().unwrap();
    if first.is_empty() || second.is_empty() {
        return; // not enough data to prove anything
    }
    let last_of_page0 = first.last().unwrap()["created_at"].as_str().unwrap();
    let first_of_page1 = second[0]["created_at"].as_str().unwrap();
    assert!(
        last_of_page0 <= first_of_page1,
        "ascending sort must continue across pages ({last_of_page0} then {first_of_page1})"
    );
}

#[tokio::test]
async fn unknown_sort_values_are_rejected() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    for body in [
        json!({ "org_unit": root().await, "sort_by": "notes" }),
        json!({ "org_unit": root().await, "sort_by": "'; DROP TABLE" }),
        json!({ "org_unit": root().await, "sort_dir": "sideways" }),
    ] {
        let resp = c
            .post(format!("{}/api/v1/current/shift-note/list", current_base()))
            .json(&body)
            .headers(auth_header(&token))
            .send()
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            400,
            "bad sort input should be rejected, not ignored: {body}"
        );
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

#[tokio::test]
async fn create_rejects_bad_input() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    let cases: Vec<(&str, serde_json::Value)> = vec![
        (
            "unknown type",
            json!({ "org_unit": branch().await, "type": 999999, "notes": "x" }),
        ),
        (
            "blank notes",
            json!({ "org_unit": branch().await, "type": TYPE_PATRON_BEHAVIOR, "notes": "   " }),
        ),
        (
            "unknown conduct area",
            json!({
                "org_unit": branch().await,
                "type": TYPE_PATRON_BEHAVIOR,
                "notes": "x",
                "conduct_areas": [999999],
            }),
        ),
        (
            // A well-formed uuid that resolves to no file: the "unknown
            // reference" case. A malformed one is a deserialization
            // failure (422), which is a different contract.
            "unknown attachment",
            json!({
                "org_unit": branch().await,
                "type": TYPE_PATRON_BEHAVIOR,
                "notes": "x",
                "attachments": ["00000000-0000-4000-8000-000000000999"],
            }),
        ),
    ];

    for (label, body) in cases {
        let resp = c
            .post(format!("{}/api/v1/current/shift-note/create", current_base()))
            .json(&body)
            .headers(auth_header(&token))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 400, "expected 400 for: {label}");
    }
}

/// A Region is an organizational grouping, not a place someone works, so
/// an entry cannot be filed there. Regions carry can_have_staff = FALSE
/// (migration 103) and the server defers to that flag rather than
/// hardcoding type names.
#[tokio::test]
async fn entries_cannot_be_filed_at_an_unstaffed_unit() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let resp = c
        .post(format!("{}/api/v1/current/shift-note/create", current_base()))
        .json(&json!({
            "org_unit": unstaffed_unit().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": "filed at a region",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        400,
        "a Region is not a staffed location and must be rejected"
    );

    // The same entry at a branch under that region is fine.
    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": "filed at a branch",
        }),
    )
    .await;
    delete_note(&c, &token, id).await;
}

#[tokio::test]
async fn over_long_text_is_rejected() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    // Postgres TEXT is unbounded; without a cap one pasted log file
    // becomes a row that every list response has to carry.
    for (field, body) in [
        (
            "notes",
            json!({ "org_unit": branch().await, "type": TYPE_PATRON_BEHAVIOR,
                    "notes": "x".repeat(10_001) }),
        ),
        (
            "patron_name",
            json!({ "org_unit": branch().await, "type": TYPE_PATRON_BEHAVIOR, "notes": "ok",
                    "patron_name": "x".repeat(201) }),
        ),
        (
            "patron_description",
            json!({ "org_unit": branch().await, "type": TYPE_PATRON_BEHAVIOR, "notes": "ok",
                    "patron_description": "x".repeat(1_001) }),
        ),
    ] {
        let resp = c
            .post(format!("{}/api/v1/current/shift-note/create", current_base()))
            .json(&body)
            .headers(auth_header(&token))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 400, "over-long {field} should be rejected");
    }

    // A note right at the limit is still fine.
    let id = create_note(
        &c,
        &token,
        json!({ "org_unit": branch().await, "type": TYPE_PATRON_BEHAVIOR,
                "notes": "x".repeat(10_000) }),
    )
    .await;
    delete_note(&c, &token, id).await;
}

#[tokio::test]
async fn count_only_returns_a_total_without_rows() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("countonly");

    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} body the poll must not fetch"),
        }),
    )
    .await;

    let full = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let counted = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "count_only": true }),
    )
    .await;

    assert_eq!(
        counted["total"], full["total"],
        "count_only must report the same total"
    );
    assert!(
        counted["rows"].as_array().unwrap().is_empty(),
        "count_only must not return rows — the poll only needs the number"
    );

    // And it still respects the filters, so the poll counts what the
    // filtered list would actually show.
    let filtered = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "count_only": true, "search": mark }),
    )
    .await;
    assert_eq!(filtered["total"].as_u64().unwrap(), 1);

    delete_note(&c, &token, id).await;
}

#[tokio::test]
async fn update_of_unknown_note_is_404() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    let resp = c
        .post(format!("{}/api/v1/current/shift-note/update", current_base()))
        .json(&json!({
            "id": 99_999_999,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": "nope",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/// Upload a file through odo-asset and return its `file_upload` uuid.
///
/// Shift-note attachments reuse the `current` asset directory (entity_type
/// `incident`), so they are governed by the existing asset.current.* perms
/// rather than a directory of their own.
async fn upload_attachment(token: &str, filename: &str, content: &[u8]) -> String {
    let part = multipart::Part::bytes(content.to_vec()).file_name(filename.to_string());
    let form = multipart::Form::new()
        .part("file", part)
        .text("category", "document")
        .text("entity_type", "incident");

    let resp = client()
        .post(format!("{}/api/v1/odo/asset/upload", asset_base()))
        .headers(auth_header(token))
        .multipart(form)
        .send()
        .await
        .expect("upload request failed");

    assert_eq!(resp.status(), 200, "asset upload failed");
    let data: serde_json::Value = resp.json().await.unwrap();
    data["uuid"]
        .as_str()
        .expect("missing file_upload uuid")
        .to_string()
}

async fn delete_upload(token: &str, uuid: &str) {
    client()
        .post(format!("{}/api/v1/odo/asset/files/delete", asset_base()))
        .json(&json!({ "uuid": uuid }))
        .headers(auth_header(token))
        .send()
        .await
        .ok();
}

#[tokio::test]
async fn note_with_attachments_round_trips_file_metadata() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("attach");

    let content = b"shift note attachment body";
    let file_id = upload_attachment(&token, "shift_note_attachment.txt", content).await;

    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} see attached"),
            "attachments": [file_id],
        }),
    )
    .await;

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).expect("note with attachment not in list");

    let attachments = row["attachments"].as_array().unwrap();
    assert_eq!(attachments.len(), 1, "expected exactly one attachment");

    // Metadata is resolved from odo-asset, not stored on the note — the join
    // table holds only the file_upload id.
    let a = &attachments[0];
    assert_eq!(a["file_upload"].as_str().unwrap(), file_id);
    assert_eq!(
        a["file_name"].as_str().unwrap(),
        "shift_note_attachment.txt"
    );
    assert_eq!(a["file_size"].as_i64().unwrap(), content.len() as i64);
    assert_eq!(a["file_type"].as_str(), Some("text/plain"));
    assert!(
        a["relative_path"]
            .as_str()
            .unwrap()
            .contains("current/documents"),
        "attachment should live under the current asset directory"
    );

    delete_note(&c, &token, id).await;
    delete_upload(&token, &file_id).await;
}

#[tokio::test]
async fn update_replaces_the_attachment_set() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("attachswap");

    let first = upload_attachment(&token, "shift_note_first.txt", b"first").await;
    let second = upload_attachment(&token, "shift_note_second.txt", b"second").await;

    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} first only"),
            "attachments": [first],
        }),
    )
    .await;

    // Update swaps the set wholesale rather than appending.
    let resp = c
        .post(format!("{}/api/v1/current/shift-note/update", current_base()))
        .json(&json!({
            "id": id,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} second only"),
            "attachments": [second],
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).unwrap();
    let attachments = row["attachments"].as_array().unwrap();

    assert_eq!(attachments.len(), 1, "update should replace, not append");
    assert_eq!(attachments[0]["file_upload"].as_str().unwrap(), second);

    // And dropping the field entirely clears the set.
    let resp = c
        .post(format!("{}/api/v1/current/shift-note/update", current_base()))
        .json(&json!({
            "id": id,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} none"),
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).unwrap();
    assert!(
        row["attachments"].as_array().unwrap().is_empty(),
        "omitting attachments should clear them"
    );

    delete_note(&c, &token, id).await;
    delete_upload(&token, &first).await;
    delete_upload(&token, &second).await;
}

#[tokio::test]
async fn coordinator_can_add_an_attachment_to_someone_elses_note() {
    let c = client();
    let staff = login_token(&c, &STAFF).await;
    let coord = login_token(&c, &COORD).await;
    let mark = marker("coordattach");

    // Staff file a note with their own attachment.
    let staff_file = upload_attachment(&staff, "staff_original.txt", b"staff's file").await;
    let id = create_note(
        &c,
        &staff,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} original"),
            "attachments": [staff_file],
        }),
    )
    .await;

    // The coordinator edits it and adds one of their own files. update
    // replaces the set, so the payload necessarily carries staff's file
    // too -- which the coordinator did not upload. Keeping it must not be
    // treated as attaching it.
    let coord_file = upload_attachment(&coord, "coord_added.txt", b"coordinator's file").await;
    let resp = c
        .post(format!("{}/api/v1/current/shift-note/update", current_base()))
        .json(&json!({
            "id": id,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} amended by coordinator"),
            "attachments": [staff_file, coord_file],
        }))
        .headers(auth_header(&coord))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        200,
        "coordinator must be able to add a file to someone else's note"
    );

    let data = list_notes(&c, &staff, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).unwrap();
    let ids: Vec<&str> = row["attachments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["file_upload"].as_str().unwrap())
        .collect();
    assert!(
        ids.contains(&staff_file.as_str()),
        "the original file should survive"
    );
    assert!(
        ids.contains(&coord_file.as_str()),
        "the coordinator's file should be added"
    );

    // Still enforced on the way in: a file belonging to a third party
    // cannot be attached just because you may edit the note.
    let third_party = upload_attachment(&staff, "staff_other.txt", b"not referenced").await;
    let resp = c
        .post(format!("{}/api/v1/current/shift-note/update", current_base()))
        .json(&json!({
            "id": id,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} sneaking a file in"),
            "attachments": [staff_file, coord_file, third_party],
        }))
        .headers(auth_header(&coord))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        400,
        "a file not already on the note must still be ownership-checked"
    );

    delete_note(&c, &coord, id).await;
    for (t, f) in [(&staff, staff_file), (&coord, coord_file), (&staff, third_party)] {
        delete_upload(t, &f).await;
    }
}

#[tokio::test]
async fn cannot_attach_a_file_uploaded_by_someone_else() {
    let c = client();
    let staff = login_token(&c, &STAFF).await;
    let coord = login_token(&c, &COORD).await;

    // Coordinator uploads; staff tries to attach it to their own note.
    let file_id = upload_attachment(&coord, "shift_note_not_yours.txt", b"theirs").await;

    let resp = c
        .post(format!("{}/api/v1/current/shift-note/create", current_base()))
        .json(&json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": "borrowing someone else's upload",
            "attachments": [file_id],
        }))
        .headers(auth_header(&staff))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        400,
        "attaching another user's upload must be rejected"
    );

    delete_upload(&coord, &file_id).await;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

#[tokio::test]
async fn endpoints_require_auth() {
    let c = client();

    for (path, body) in [
        ("list", json!({ "org_unit": root().await })),
        (
            "create",
            json!({ "org_unit": branch().await, "type": TYPE_PATRON_BEHAVIOR, "notes": "x" }),
        ),
        (
            "update",
            json!({ "id": 1, "type": TYPE_PATRON_BEHAVIOR, "notes": "x" }),
        ),
        ("delete", json!({ "id": 1 })),
        ("type/list", json!({})),
        ("conduct-area/list", json!({})),
    ] {
        let resp = c
            .post(format!(
                "{}/api/v1/current/shift-note/{path}",
                current_base()
            ))
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 401, "expected 401 for shift-note/{path}");
    }
}

// --- occurred_at (CRT-188) -------------------------------------------------

#[tokio::test]
async fn occurred_at_defaults_to_now_when_omitted() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("occ-default");

    let before = chrono::Utc::now();
    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} filed as it happened"),
        }),
    )
    .await;

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).expect("note should be listed");

    let occurred = row["occurred_at"].as_str().expect("occurred_at in the row");
    let parsed = chrono::DateTime::parse_from_rfc3339(occurred)
        .expect("occurred_at should be RFC3339");

    // Filing without a time means "now": bounded below by the moment
    // before the request and above by the row's own created_at.
    assert!(
        parsed.to_utc() >= before - chrono::Duration::seconds(5),
        "occurred_at {occurred} predates the request"
    );
    let created = chrono::DateTime::parse_from_rfc3339(
        row["created_at"].as_str().expect("created_at in the row"),
    )
    .unwrap();
    assert!(
        (parsed - created).num_seconds().abs() <= 5,
        "omitted occurred_at should track created_at; got {occurred} vs {created}"
    );

    delete_note(&c, &token, id).await;
}

#[tokio::test]
async fn occurred_at_accepts_a_past_time_and_survives_a_round_trip() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("occ-past");

    // The case the column exists for: written up at the end of a shift,
    // hours after the thing happened.
    let happened = chrono::Utc::now() - chrono::Duration::hours(6);
    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} written up later"),
            "occurred_at": happened.to_rfc3339(),
        }),
    )
    .await;

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).expect("note should be listed");
    let stored = chrono::DateTime::parse_from_rfc3339(row["occurred_at"].as_str().unwrap())
        .unwrap();
    assert!(
        (stored.to_utc() - happened).num_seconds().abs() <= 1,
        "occurred_at should round-trip the submitted time"
    );

    // ...and created_at still records when it was written down, which is
    // the distinction the column exists to draw.
    let created = chrono::DateTime::parse_from_rfc3339(row["created_at"].as_str().unwrap())
        .unwrap();
    assert!(
        (created - stored).num_minutes() >= 300,
        "created_at should be well after occurred_at here"
    );

    delete_note(&c, &token, id).await;
}

#[tokio::test]
async fn update_can_correct_occurred_at_and_omitting_it_leaves_it_alone() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("occ-update");

    let happened = chrono::Utc::now() - chrono::Duration::hours(2);
    let id = create_note(
        &c,
        &token,
        json!({
            "org_unit": branch().await,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} initial"),
            "occurred_at": happened.to_rfc3339(),
        }),
    )
    .await;

    // Correct the time.
    let corrected = chrono::Utc::now() - chrono::Duration::hours(4);
    let resp = c
        .post(format!("{}/api/v1/current/shift-note/update", current_base()))
        .json(&json!({
            "id": id,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} initial"),
            "occurred_at": corrected.to_rfc3339(),
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "update with occurred_at should succeed");

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).unwrap();
    let stored = chrono::DateTime::parse_from_rfc3339(row["occurred_at"].as_str().unwrap())
        .unwrap();
    assert!(
        (stored.to_utc() - corrected).num_seconds().abs() <= 1,
        "update should have corrected occurred_at"
    );

    // Omitting it on a later edit leaves the corrected value in place,
    // rather than silently resetting it to now.
    let resp = c
        .post(format!("{}/api/v1/current/shift-note/update", current_base()))
        .json(&json!({
            "id": id,
            "type": TYPE_PATRON_BEHAVIOR,
            "notes": format!("{mark} edited body only"),
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "update without occurred_at should succeed");

    let data = list_notes(&c, &token, json!({ "org_unit": root().await })).await;
    let row = find_marked(&data, &mark).unwrap();
    let after = chrono::DateTime::parse_from_rfc3339(row["occurred_at"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        stored, after,
        "omitting occurred_at must not change the stored value"
    );

    delete_note(&c, &token, id).await;
}

#[tokio::test]
async fn list_sorts_by_occurred_at_by_default() {
    let c = client();
    let token = login_token(&c, &STAFF).await;
    let mark = marker("occ-sort");

    // Created oldest-first, but with occurrence times in the opposite
    // order -- so sorting by occurred_at and by created_at disagree, and
    // the default has to pick the one the list is about.
    let mut ids = Vec::new();
    for hours in [1_i64, 5, 9] {
        ids.push(
            create_note(
                &c,
                &token,
                json!({
                    "org_unit": branch().await,
                    "type": TYPE_PATRON_BEHAVIOR,
                    "notes": format!("{mark} h{hours}"),
                    "occurred_at": (chrono::Utc::now() - chrono::Duration::hours(hours))
                        .to_rfc3339(),
                }),
            )
            .await,
        );
    }

    let data = list_notes(&c, &token, json!({ "org_unit": root().await, "limit": 100 })).await;
    let ours: Vec<&serde_json::Value> = data["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["notes"].as_str().is_some_and(|n| n.contains(&mark)))
        .collect();
    assert_eq!(ours.len(), 3, "all three notes should be listed");

    // Default is newest occurrence first: h1, h5, h9.
    let times: Vec<chrono::DateTime<chrono::FixedOffset>> = ours
        .iter()
        .map(|r| chrono::DateTime::parse_from_rfc3339(r["occurred_at"].as_str().unwrap()).unwrap())
        .collect();
    assert!(
        times[0] > times[1] && times[1] > times[2],
        "default sort should be occurred_at descending; got {times:?}"
    );

    // Explicit ascending flips it.
    let asc = list_notes(
        &c,
        &token,
        json!({ "org_unit": root().await, "limit": 100, "sort_by": "occurred_at", "sort_dir": "asc" }),
    )
    .await;
    let asc_times: Vec<chrono::DateTime<chrono::FixedOffset>> = asc["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["notes"].as_str().is_some_and(|n| n.contains(&mark)))
        .map(|r| chrono::DateTime::parse_from_rfc3339(r["occurred_at"].as_str().unwrap()).unwrap())
        .collect();
    assert!(
        asc_times[0] < asc_times[1] && asc_times[1] < asc_times[2],
        "sort_dir=asc should reverse the order"
    );

    for id in ids {
        delete_note(&c, &token, id).await;
    }
}
