use integration_tests::*;
use serde_json::json;

// ============================================================================
// TODO — back-fill behavioral coverage
// ============================================================================
//
// Sub-locations are read-only via the `current` API and have stable seed
// data. The existing tests cover the surface (label ordering, org-unit
// filter, ancestor walk, subset relation, auth).
//
// One *nice-to-have* enabled by incident creation: cross-test verifying
// that `incident/create` with `sub_location: <id>` (pulled from this
// endpoint) round-trips through `incident/get`. Lives better in
// `incidents.rs` than here — would expand the "roundtrip" test there.

// ============================================================================

/// The root org unit, resolved to its uuid at runtime.
async fn org_unit() -> String {
    let c = client();
    let token = admin_token(&c).await;
    unit_uuid_by_code(&c, &token, "OLS").await
}

#[tokio::test]
async fn list_sub_locations_no_filter_returns_results() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    let resp = c
        .post(format!("{}/api/v1/current/sub-location/list", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();
    let locs = data.as_array().unwrap();

    assert!(!locs.is_empty(), "expected at least one sub-location");

    let loc = &locs[0];
    assert!(loc["id"].as_i64().is_some());
    assert!(loc["org_unit"].as_str().is_some());
    assert!(loc["label"].as_str().is_some());
}

#[tokio::test]
async fn list_sub_locations_ordered_by_label() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    let resp = c
        .post(format!("{}/api/v1/current/sub-location/list", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();
    let locs = data.as_array().unwrap();

    let labels: Vec<&str> = locs.iter().map(|l| l["label"].as_str().unwrap()).collect();
    let mut sorted = labels.clone();
    sorted.sort_by_key(|s| s.to_lowercase());

    assert_eq!(labels, sorted, "sub-locations should be sorted by label ascending");
}

#[tokio::test]
async fn list_sub_locations_filtered_by_org_unit() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    let resp = c
        .post(format!("{}/api/v1/current/sub-location/list", current_base()))
        .json(&json!({"org_unit": org_unit().await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);

    let data: serde_json::Value = resp.json().await.unwrap();
    let locs = data.as_array().unwrap();

    assert!(!locs.is_empty(), "expected sub-locations for the root org unit or its ancestors");
}

#[tokio::test]
async fn list_sub_locations_org_unit_subset_of_unfiltered() {
    let c = client();
    let token = login_token(&c, &STAFF).await;

    let all: serde_json::Value = c
        .post(format!("{}/api/v1/current/sub-location/list", current_base()))
        .json(&json!({}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let filtered: serde_json::Value = c
        .post(format!("{}/api/v1/current/sub-location/list", current_base()))
        .json(&json!({"org_unit": org_unit().await}))
        .headers(auth_header(&token))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let all_ids: Vec<i64> = all
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["id"].as_i64().unwrap())
        .collect();

    for loc in filtered.as_array().unwrap() {
        let id = loc["id"].as_i64().unwrap();
        assert!(
            all_ids.contains(&id),
            "filtered result id={id} not present in unfiltered list"
        );
    }
}

#[tokio::test]
async fn list_sub_locations_requires_auth() {
    let c = client();

    let resp = c
        .post(format!("{}/api/v1/current/sub-location/list", current_base()))
        .json(&json!({}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);
}
