use integration_tests::*;
use serde_json::json;

/// Resolve an org unit's uuid by code (fresh client + cached admin token).
async fn unit_by_code(code: &str) -> String {
    let c = client();
    let token = admin_token(&c).await;
    unit_uuid_by_code(&c, &token, code).await
}

/// Main Street Branch — branch org unit used by the other current
/// tests, resolved to its uuid at runtime.
async fn test_org_unit() -> String {
    unit_by_code("MAIN").await
}
/// East Region — the region Main Street Branch belongs to (its parent,
/// child of the root).
async fn parent_region() -> String {
    unit_by_code("ERG").await
}

async fn create_test_incident(c: &reqwest::Client, token: &str, title: &str) -> i64 {
    let resp = c
        .post(format!("{}/api/v1/current/incident/create", current_base()))
        .json(&json!({
            "org_unit": test_org_unit().await,
            "title": title,
            "description": "Created by reports integration test",
        }))
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let data: serde_json::Value = resp.json().await.unwrap();
    data["id"].as_i64().expect("incident id")
}

async fn report(
    c: &reqwest::Client,
    token: &str,
    endpoint: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    let resp = c
        .post(format!("{}/api/v1/current/reports/{endpoint}", current_base()))
        .json(&body)
        .headers(auth_header(token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "reports/{endpoint}: expected 200, got {}", resp.status());
    resp.json().await.unwrap()
}

fn sum(rows: &serde_json::Value, field: &str) -> i64 {
    rows.as_array()
        .expect("rows array")
        .iter()
        .map(|r| r[field].as_i64().unwrap_or(0))
        .sum()
}

#[tokio::test]
async fn reports_require_auth() {
    let c = client();
    for endpoint in [
        "incidents-over-time",
        "by-template",
        "by-category",
        "open-by-review-status",
        "incidents-by-location",
        "bans-over-time",
        "summary",
        "resolution-time",
        "occurrence-heatmap",
    ] {
        let resp = c
            .post(format!("{}/api/v1/current/reports/{endpoint}", current_base()))
            .json(&json!({"org_unit": test_org_unit().await}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 401, "reports/{endpoint} without token");
    }
}

#[tokio::test]
async fn incidents_over_time_counts_new_incident() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    create_test_incident(&c, &token, "over-time report incident").await;

    let data = report(
        &c,
        &token,
        "incidents-over-time",
        json!({"org_unit": test_org_unit().await, "bucket": "day"}),
    )
    .await;

    let rows = data["rows"].as_array().expect("rows");
    assert!(!rows.is_empty());
    assert!(sum(&data["rows"], "opened") >= 1);

    // Dense, ordered series: every bucket is a date and the last bucket is
    // today's (UTC) — the fill extends the series to now.
    let buckets: Vec<&str> = rows.iter().map(|r| r["bucket"].as_str().unwrap()).collect();
    let mut sorted = buckets.clone();
    sorted.sort();
    assert_eq!(buckets, sorted, "buckets are ordered");
    // Other suite tests create future-dated incidents (e.g. the
    // occurred_at sort tests), so the series may extend past today — but
    // never end before it.
    let today = chrono::Utc::now().date_naive().to_string();
    assert!(
        *buckets.last().unwrap() >= today.as_str(),
        "series extends at least to today"
    );
}

#[tokio::test]
async fn incidents_over_time_future_start_is_empty() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Not just tomorrow: other suite tests create future-dated incidents
    // within the current year, so go far enough out to clear them all.
    let far_future = (chrono::Utc::now() + chrono::Duration::days(3650)).to_rfc3339();
    let data = report(
        &c,
        &token,
        "incidents-over-time",
        json!({"org_unit": test_org_unit().await, "bucket": "day", "start": far_future}),
    )
    .await;
    assert_eq!(sum(&data["rows"], "opened"), 0);
    assert_eq!(sum(&data["rows"], "resolved"), 0);
}

#[tokio::test]
async fn org_unit_filter_includes_descendants() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    create_test_incident(&c, &token, "descendant expansion incident").await;

    // Scoped to the parent region, the branch incident must be counted...
    let region = report(
        &c,
        &token,
        "incidents-by-location",
        json!({"org_unit": parent_region().await}),
    )
    .await;
    let branch_uuid = test_org_unit().await;
    let branch_row = region["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["org_unit"].as_str() == Some(branch_uuid.as_str()))
        .expect("region-scoped report includes branch (descendant) counts");
    assert!(branch_row["count"].as_i64().unwrap() >= 1);
    assert_eq!(branch_row["label"].as_str().unwrap(), "Main Street Branch");

    // ...and the branch-scoped count can never exceed the region-scoped one.
    let branch = report(
        &c,
        &token,
        "incidents-by-location",
        json!({"org_unit": test_org_unit().await}),
    )
    .await;
    assert!(sum(&region["rows"], "count") >= sum(&branch["rows"], "count"));
}

#[tokio::test]
async fn open_by_review_status_counts_unsubmitted() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    create_test_incident(&c, &token, "review status report incident").await;

    let data = report(
        &c,
        &token,
        "open-by-review-status",
        json!({"org_unit": test_org_unit().await}),
    )
    .await;
    let unsubmitted = data["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["label"].as_str() == Some("unsubmitted"))
        .expect("a fresh incident shows up as unsubmitted");
    assert!(unsubmitted["count"].as_i64().unwrap() >= 1);
}

#[tokio::test]
async fn open_by_template_buckets_untemplated_incidents() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    create_test_incident(&c, &token, "template report incident").await;

    let data = report(&c, &token, "by-template", json!({"org_unit": test_org_unit().await, "status": "open"})).await;
    let untemplated = data["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["label"].as_str() == Some("No template"))
        .expect("incident created without templates lands in 'No template'");
    assert!(untemplated["count"].as_i64().unwrap() >= 1);

    let categories =
        report(&c, &token, "by-category", json!({"org_unit": test_org_unit().await, "status": "open"})).await;
    let uncategorized = categories["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["label"].as_str() == Some("Uncategorized"))
        .expect("untemplated incident lands in 'Uncategorized'");
    assert!(uncategorized["count"].as_i64().unwrap() >= 1);
}

#[tokio::test]
async fn bans_over_time_returns_series() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    let data = report(
        &c,
        &token,
        "bans-over-time",
        json!({"org_unit": test_org_unit().await, "bucket": "month"}),
    )
    .await;
    // Shape-only: rows is an array (possibly empty) of {bucket, bans, trespasses}.
    let rows = data["rows"].as_array().expect("rows array");
    if let Some(first) = rows.first() {
        assert!(first["bucket"].is_string());
        assert!(first["bans"].is_i64() || first["bans"].is_u64());
        assert!(first["trespasses"].is_i64() || first["trespasses"].is_u64());
    }
}

#[tokio::test]
async fn top_patrons_counts_distinct_incidents() {
    let c = client();
    let token = login_token(&c, &COORD).await;

    // Scope the report to this run: patrons accumulated by previous runs
    // of this very test would otherwise fill the top-5 with equal counts.
    let run_start = (chrono::Utc::now() - chrono::Duration::seconds(60)).to_rfc3339();

    // A fresh patron so this test doesn't depend on other tests' data.
    let resp = c
        .post(format!("{}/api/v1/current/patron/create", current_base()))
        .json(&json!({
            "first_name": "Reports",
            "last_name": "TopPatron",
        }))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let patron_id = resp.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .expect("patron id");

    // Six incidents involving them — enough that patrons created by the
    // rest of the suite (merge tests etc.) can't realistically outrank
    // them for a top-5 slot. The first incident lists the patron twice,
    // which must still count that incident once.
    const INCIDENTS: i64 = 6;
    for i in 0..INCIDENTS {
        let parties = if i == 0 { 2 } else { 1 };
        let involved: Vec<serde_json::Value> = (0..parties)
            .map(|_| json!({"party_type": "patron", "patron_id": patron_id, "role": "subject"}))
            .collect();
        let resp = c
            .post(format!("{}/api/v1/current/incident/create", current_base()))
            .json(&json!({
                "org_unit": test_org_unit().await,
                "title": "top patron incident",
                "description": "reports test",
                "involved_parties": involved,
            }))
            .headers(auth_header(&token))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
    }

    let data = report(
        &c,
        &token,
        "top-patrons",
        json!({"org_unit": test_org_unit().await, "start": run_start}),
    )
    .await;
    let rows = data["rows"].as_array().expect("rows");
    assert!(rows.len() <= 5, "top patrons is capped at 5");
    let row = rows
        .iter()
        .find(|r| r["patron"].as_i64() == Some(patron_id))
        .expect("new patron ranks in top 5 of the test dataset");
    assert_eq!(
        row["count"].as_i64().unwrap(),
        INCIDENTS,
        "duplicate party rows count once per incident"
    );
    assert_eq!(row["label"].as_str().unwrap(), "Reports TopPatron");

    // The incidents are unresolved, so the patron must vanish under the
    // "closed" status filter.
    let closed = report(
        &c,
        &token,
        "top-patrons",
        json!({"org_unit": test_org_unit().await, "start": run_start, "status": "closed"}),
    )
    .await;
    assert!(
        !closed["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["patron"].as_i64() == Some(patron_id)),
        "closed filter excludes patrons with only open incidents"
    );
}

#[tokio::test]
async fn status_filter_partitions_counts() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    create_test_incident(&c, &token, "status filter incident").await;

    // open + closed must exactly partition all, and the fresh (unresolved)
    // incident guarantees the open side is non-empty.
    let mut totals = std::collections::HashMap::new();
    for status in ["all", "open", "closed"] {
        let data = report(
            &c,
            &token,
            "by-template",
            json!({"org_unit": test_org_unit().await, "status": status}),
        )
        .await;
        totals.insert(status, sum(&data["rows"], "count"));
    }
    assert!(totals["open"] >= 1);
    assert_eq!(totals["open"] + totals["closed"], totals["all"]);

    // Omitting status behaves as "all".
    let default = report(&c, &token, "by-template", json!({"org_unit": test_org_unit().await})).await;
    assert_eq!(sum(&default["rows"], "count"), totals["all"]);
}

#[tokio::test]
async fn summary_counts_are_consistent() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    create_test_incident(&c, &token, "summary kpi incident").await;

    let data = report(&c, &token, "summary", json!({"org_unit": test_org_unit().await})).await;
    let total = data["total_incidents"].as_i64().unwrap();
    let open = data["open_incidents"].as_i64().unwrap();
    let resolved = data["resolved_incidents"].as_i64().unwrap();

    assert!(total >= 1, "fresh incident counts toward the total");
    assert!(open >= 1, "fresh incident is open");
    assert!(open <= total, "open incidents are a subset of the total");
    assert!(resolved >= 0);

    // Median is null exactly when nothing has been resolved.
    let median = &data["median_days_to_resolve"];
    if resolved == 0 {
        assert!(median.is_null());
    } else {
        assert!(median.as_f64().is_some());
    }
}

#[tokio::test]
async fn resolution_time_reports_median_for_resolved_incident() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let run_start = (chrono::Utc::now() - chrono::Duration::seconds(60)).to_rfc3339();

    // Create and immediately resolve an incident (same flow as the review
    // tests), so today's bucket has at least one resolution with a small
    // occurred->resolved delta.
    let id = create_test_incident(&c, &token, "resolution time incident").await;
    let resp = c
        .post(format!("{}/api/v1/current/incident/review/create", current_base()))
        .json(&json!({"incident": id, "result": "resolved", "comments": "reports test"}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let data = report(
        &c,
        &token,
        "resolution-time",
        json!({"org_unit": test_org_unit().await, "bucket": "day", "start": run_start}),
    )
    .await;
    let rows = data["rows"].as_array().expect("rows");
    let today = chrono::Utc::now().date_naive().to_string();
    let today_row = rows
        .iter()
        .find(|r| r["bucket"].as_str() == Some(today.as_str()))
        .expect("today's bucket present");
    assert!(today_row["resolved"].as_i64().unwrap() >= 1);
    let median = today_row["median_days"].as_f64().expect("median for a bucket with resolutions");
    assert!((0.0..1.0).contains(&median), "created-then-resolved delta is under a day, got {median}");

    // Buckets without resolutions carry a null median, not zero.
    for row in rows {
        if row["resolved"].as_i64() == Some(0) {
            assert!(row["median_days"].is_null(), "empty bucket must have null median");
        }
    }
}

#[tokio::test]
async fn occurrence_heatmap_counts_incident_in_local_time() {
    let c = client();
    let token = login_token(&c, &COORD).await;
    let run_start = (chrono::Utc::now() - chrono::Duration::seconds(60)).to_rfc3339();
    create_test_incident(&c, &token, "heatmap incident").await;

    let data = report(
        &c,
        &token,
        "occurrence-heatmap",
        json!({"org_unit": test_org_unit().await, "start": run_start}),
    )
    .await;

    assert!(
        !data["timezone"].as_str().unwrap_or("").is_empty(),
        "response names the timezone used"
    );

    let cells = data["cells"].as_array().expect("cells");
    let mut total = 0;
    for cell in cells {
        let day = cell["day"].as_u64().unwrap();
        let hour = cell["hour"].as_u64().unwrap();
        let count = cell["count"].as_i64().unwrap();
        assert!(day < 7, "day in range, got {day}");
        assert!(hour < 24, "hour in range, got {hour}");
        assert!(count > 0, "sparse cells only carry non-zero counts");
        total += count;
    }
    assert!(total >= 1, "the fresh incident lands in some cell");
}
