//! Dashboard report endpoints.
//!
//! Each report is a small aggregate the UI renders as one chart. All
//! reports share the same filter semantics:
//!
//!   * `org_unit`: limit to that unit *and all of its descendants*
//!     (expanded via odo-org — never by querying org.unit directly, so
//!     these queries survive the planned incidents-DB split).
//!   * `start`: only count rows on/after this instant; omitted = all time.
//!
//! Queries fetch minimal columns through the SeaORM entities and do the
//! bucketing/grouping in Rust: report inputs are already narrowed (open
//! incidents, or a couple of timestamp columns per row), so volumes stay
//! small and we avoid raw SQL entirely.

use axum::Json;
use axum::extract::State;
use chrono::{Datelike, Duration, Months, NaiveDate};
use odo_client::error::ApiResult;
use sea_orm::prelude::*;
use sea_orm::sea_query::JoinType;
use sea_orm::{PaginatorTrait, QueryOrder, QuerySelect, QueryTrait};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;
use utoipa::ToSchema;

use crate::AppState;
use crate::entity::{
    categories, incident_review, incident_template_map, incidents, involved_parties, patron_ban,
    patrons, templates,
};

type UtcInstant = chrono::DateTime<chrono::FixedOffset>;

/// Time-bucket size for the over-time reports. The UI picks day for short
/// ranges and month for long ones. Buckets are UTC calendar units.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ReportBucket {
    Day,
    Week,
    Month,
}

impl ReportBucket {
    /// Truncate a date to the start of its bucket (weeks start Monday,
    /// mirroring Postgres date_trunc).
    fn truncate(self, date: NaiveDate) -> NaiveDate {
        match self {
            Self::Day => date,
            Self::Week => date - Duration::days(date.weekday().num_days_from_monday() as i64),
            Self::Month => date.with_day(1).expect("day 1 is valid for any month"),
        }
    }

    /// The start of the bucket after `bucket_start` (which must already be
    /// truncated).
    fn next(self, bucket_start: NaiveDate) -> NaiveDate {
        match self {
            Self::Day => bucket_start + Duration::days(1),
            Self::Week => bucket_start + Duration::days(7),
            Self::Month => bucket_start
                .checked_add_months(Months::new(1))
                .expect("report buckets stay far from NaiveDate::MAX"),
        }
    }
}

/// Incident-status filter for the count-by reports. The over-time series
/// are exempt (their series already encode status), and the review-status
/// report is pinned to open incidents (every closed incident's latest
/// result is "resolved", so the breakdown degenerates).
#[derive(Debug, Clone, Copy, PartialEq, Default, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum StatusFilter {
    #[default]
    All,
    Open,
    Closed,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReportFilter {
    pub org_unit: Option<Uuid>,
    pub start: Option<chrono::DateTime<chrono::FixedOffset>>,
    #[serde(default)]
    pub status: StatusFilter,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TimeSeriesRequest {
    pub org_unit: Option<Uuid>,
    pub start: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub bucket: ReportBucket,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IncidentsOverTimeRow {
    /// Bucket start date (YYYY-MM-DD).
    pub bucket: String,
    pub opened: i64,
    pub resolved: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IncidentsOverTimeResponse {
    pub rows: Vec<IncidentsOverTimeRow>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LabelCountRow {
    pub label: String,
    pub count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LabelCountsResponse {
    pub rows: Vec<LabelCountRow>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LocationCountRow {
    pub org_unit: Uuid,
    pub label: String,
    pub count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LocationCountsResponse {
    pub rows: Vec<LocationCountRow>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BansOverTimeRow {
    /// Bucket start date (YYYY-MM-DD).
    pub bucket: String,
    pub bans: i64,
    pub trespasses: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BansOverTimeResponse {
    pub rows: Vec<BansOverTimeRow>,
}

/// Expand the requested org unit to itself + all descendants via odo-org.
/// `None` means no org filtering.
async fn org_unit_ids(state: &AppState, org_unit: Option<Uuid>) -> ApiResult<Option<Vec<Uuid>>> {
    match org_unit {
        Some(id) => Ok(Some(state.org_client.descendant_uuids(&id).await?)),
        None => Ok(None),
    }
}

/// Base query for non-deleted incidents with the shared report filters
/// applied (org subtree + occurred_at >= start + open/closed status).
fn incidents_filtered(
    org_ids: &Option<Vec<Uuid>>,
    start: Option<UtcInstant>,
    status: StatusFilter,
) -> Select<incidents::Entity> {
    let mut query = incidents::Entity::find().filter(incidents::Column::DeletedAt.is_null());
    if let Some(ids) = org_ids {
        query = query.filter(incidents::Column::OrgUnit.is_in(ids.iter().copied()));
    }
    if let Some(start) = start {
        query = query.filter(incidents::Column::OccurredAt.gte(start));
    }
    match status {
        StatusFilter::All => query,
        StatusFilter::Open => query.filter(incidents::Column::ResolvedAt.is_null()),
        StatusFilter::Closed => query.filter(incidents::Column::ResolvedAt.is_not_null()),
    }
}

fn bucket_date(instant: UtcInstant) -> NaiveDate {
    instant.to_utc().date_naive()
}

/// Walk a sparse bucket->values map into a dense, zero-filled series from
/// the first bucket through max(last bucket, today) so charts don't
/// visually end at the last data point.
fn fill_series<V: Copy + Default>(
    data: &BTreeMap<NaiveDate, V>,
    bucket: ReportBucket,
) -> Vec<(NaiveDate, V)> {
    let Some((&first, _)) = data.first_key_value() else {
        return Vec::new();
    };
    let today = bucket.truncate(chrono::Utc::now().date_naive());
    let last = (*data.last_key_value().expect("non-empty").0).max(today);
    let mut rows = Vec::new();
    let mut cursor = first;
    while cursor <= last {
        rows.push((cursor, data.get(&cursor).copied().unwrap_or_default()));
        cursor = bucket.next(cursor);
    }
    rows
}

fn label_counts_response(counts: BTreeMap<String, i64>) -> Json<LabelCountsResponse> {
    let mut rows: Vec<LabelCountRow> = counts
        .into_iter()
        .map(|(label, count)| LabelCountRow { label, count })
        .collect();
    // Largest first; BTreeMap already gave a stable alphabetical tiebreak.
    rows.sort_by_key(|a| std::cmp::Reverse(a.count));
    Json(LabelCountsResponse { rows })
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/incidents-over-time",
    request_body = TimeSeriesRequest,
    responses((
        status = 200,
        body = IncidentsOverTimeResponse,
        description = "Incidents opened (by occurred_at) and resolved (by resolved_at) per time bucket, zero-filled through the current bucket"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn incidents_over_time(
    State(state): State<Arc<AppState>>,
    Json(params): Json<TimeSeriesRequest>,
) -> ApiResult<Json<IncidentsOverTimeResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let stamps: Vec<(UtcInstant, Option<UtcInstant>)> =
        incidents_filtered(&org_ids, params.start, StatusFilter::All)
            .select_only()
            .column(incidents::Column::OccurredAt)
            .column(incidents::Column::ResolvedAt)
            .into_tuple()
            .all(&state.db)
            .await?;

    let mut buckets: BTreeMap<NaiveDate, (i64, i64)> = BTreeMap::new();
    for (occurred_at, resolved_at) in stamps {
        buckets
            .entry(params.bucket.truncate(bucket_date(occurred_at)))
            .or_default()
            .0 += 1;
        // Note: an incident resolved after `start` but occurred before it is
        // not fetched, so both series consistently cover incidents that
        // *occurred* in the window.
        if let Some(resolved_at) = resolved_at {
            buckets
                .entry(params.bucket.truncate(bucket_date(resolved_at)))
                .or_default()
                .1 += 1;
        }
    }

    let rows = fill_series(&buckets, params.bucket)
        .into_iter()
        .map(|(bucket, (opened, resolved))| IncidentsOverTimeRow {
            bucket: bucket.to_string(),
            opened,
            resolved,
        })
        .collect();

    Ok(Json(IncidentsOverTimeResponse { rows }))
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/by-template",
    request_body = ReportFilter,
    responses((
        status = 200,
        body = LabelCountsResponse,
        description = "Incidents per template, honoring the status filter; incidents with several templates count once per template"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn incidents_by_template(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ReportFilter>,
) -> ApiResult<Json<LabelCountsResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let rows: Vec<(i32, Option<String>)> =
        incidents_filtered(&org_ids, params.start, params.status)
            .join(
                JoinType::LeftJoin,
                incidents::Relation::IncidentTemplateMap.def(),
            )
            .join(
                JoinType::LeftJoin,
                incident_template_map::Relation::Templates.def(),
            )
            .select_only()
            .column(incidents::Column::Id)
            .column(templates::Column::Name)
            .into_tuple()
            .all(&state.db)
            .await?;

    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for (_, name) in rows {
        *counts
            .entry(name.unwrap_or_else(|| "No template".to_string()))
            .or_default() += 1;
    }
    Ok(label_counts_response(counts))
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/by-category",
    request_body = ReportFilter,
    responses((
        status = 200,
        body = LabelCountsResponse,
        description = "Incidents per template category, honoring the status filter (distinct incidents; 'Uncategorized' when no template)"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn incidents_by_category(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ReportFilter>,
) -> ApiResult<Json<LabelCountsResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let rows: Vec<(i32, Option<String>)> =
        incidents_filtered(&org_ids, params.start, params.status)
            .join(
                JoinType::LeftJoin,
                incidents::Relation::IncidentTemplateMap.def(),
            )
            .join(
                JoinType::LeftJoin,
                incident_template_map::Relation::Templates.def(),
            )
            .join(JoinType::LeftJoin, templates::Relation::Categories.def())
            .select_only()
            .column(incidents::Column::Id)
            .column(categories::Column::Label)
            .into_tuple()
            .all(&state.db)
            .await?;

    // An incident with several templates in the same category should count
    // once for it, so dedupe on (incident, category) before counting.
    let mut seen: std::collections::HashSet<(i32, String)> = std::collections::HashSet::new();
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for (id, label) in rows {
        let label = label.unwrap_or_else(|| "Uncategorized".to_string());
        if seen.insert((id, label.clone())) {
            *counts.entry(label).or_default() += 1;
        }
    }
    Ok(label_counts_response(counts))
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/open-by-review-status",
    request_body = ReportFilter,
    responses((
        status = 200,
        body = LabelCountsResponse,
        description = "Open incidents grouped by latest review result ('unsubmitted' when none yet); always open-only regardless of the status filter"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn open_by_review_status(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ReportFilter>,
) -> ApiResult<Json<LabelCountsResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let total_open = incidents_filtered(&org_ids, params.start, StatusFilter::Open)
        .count(&state.db)
        .await? as i64;

    // Reviews for the open incidents, ordered so the fold below keeps the
    // latest (highest-id) result per incident.
    let reviews: Vec<(i32, String)> = incident_review::Entity::find()
        .join(
            JoinType::InnerJoin,
            incident_review::Relation::Incidents.def(),
        )
        .filter(incidents::Column::DeletedAt.is_null())
        .filter(incidents::Column::ResolvedAt.is_null())
        .apply_if(org_ids.as_ref(), |q, ids| {
            q.filter(incidents::Column::OrgUnit.is_in(ids.iter().copied()))
        })
        .apply_if(params.start, |q, start| {
            q.filter(incidents::Column::OccurredAt.gte(start))
        })
        .order_by_asc(incident_review::Column::Id)
        .select_only()
        .column(incident_review::Column::Incident)
        .column(incident_review::Column::Result)
        .into_tuple()
        .all(&state.db)
        .await?;

    let mut latest: BTreeMap<i32, String> = BTreeMap::new();
    for (incident, result) in reviews {
        latest.insert(incident, result);
    }

    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    let reviewed = latest.len() as i64;
    for result in latest.into_values() {
        *counts.entry(result).or_default() += 1;
    }
    if total_open > reviewed {
        counts.insert("unsubmitted".to_string(), total_open - reviewed);
    }
    Ok(label_counts_response(counts))
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/incidents-by-location",
    request_body = ReportFilter,
    responses((
        status = 200,
        body = LocationCountsResponse,
        description = "Incidents per org unit, honoring the status filter, labeled via odo-org"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn incidents_by_location(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ReportFilter>,
) -> ApiResult<Json<LocationCountsResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let grouped: Vec<(Uuid, i64)> = incidents_filtered(&org_ids, params.start, params.status)
        .select_only()
        .column(incidents::Column::OrgUnit)
        .column_as(incidents::Column::Id.count(), "count")
        .group_by(incidents::Column::OrgUnit)
        .into_tuple()
        .all(&state.db)
        .await?;

    // Batch label lookup; best-effort — a failed odo-org call (or an id the
    // server dropped) degrades to the numeric id.
    let ids: Vec<Uuid> = grouped.iter().map(|(id, _)| *id).collect();
    let labels = state
        .org_client
        .fetch_labels_by_uuid(&ids)
        .await
        .unwrap_or_default();

    let mut rows = Vec::with_capacity(grouped.len());
    for (org_unit, count) in grouped {
        let label = labels
            .get(&org_unit)
            .cloned()
            .unwrap_or_else(|| format!("Unit {org_unit}"));
        rows.push(LocationCountRow {
            org_unit,
            label,
            count,
        });
    }
    rows.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));

    Ok(Json(LocationCountsResponse { rows }))
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/bans-over-time",
    request_body = TimeSeriesRequest,
    responses((
        status = 200,
        body = BansOverTimeResponse,
        description = "Bans and trespasses issued (by created_at) per time bucket"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn bans_over_time(
    State(state): State<Arc<AppState>>,
    Json(params): Json<TimeSeriesRequest>,
) -> ApiResult<Json<BansOverTimeResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.ban.read", params.org_unit.as_ref())
        .await?;

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let mut query = patron_ban::Entity::find();
    if let Some(ids) = &org_ids {
        query = query.filter(patron_ban::Column::OrgUnit.is_in(ids.iter().copied()));
    }
    if let Some(start) = params.start {
        query = query.filter(patron_ban::Column::CreatedAt.gte(start));
    }
    let stamps: Vec<(UtcInstant, bool)> = query
        .select_only()
        .column(patron_ban::Column::CreatedAt)
        .column(patron_ban::Column::IsTrespass)
        .into_tuple()
        .all(&state.db)
        .await?;

    let mut buckets: BTreeMap<NaiveDate, (i64, i64)> = BTreeMap::new();
    for (created_at, is_trespass) in stamps {
        let entry = buckets
            .entry(params.bucket.truncate(bucket_date(created_at)))
            .or_default();
        if is_trespass {
            entry.1 += 1;
        } else {
            entry.0 += 1;
        }
    }

    let rows = fill_series(&buckets, params.bucket)
        .into_iter()
        .map(|(bucket, (bans, trespasses))| BansOverTimeRow {
            bucket: bucket.to_string(),
            bans,
            trespasses,
        })
        .collect();

    Ok(Json(BansOverTimeResponse { rows }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HeatmapCell {
    /// Day of week, 0 = Sunday … 6 = Saturday, in the report timezone.
    pub day: u32,
    /// Hour of day, 0-23, in the report timezone.
    pub hour: u32,
    pub count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OccurrenceHeatmapResponse {
    /// IANA timezone the day/hour cells were computed in — the selected
    /// org unit's timezone (or the root's when unscoped).
    pub timezone: String,
    /// Sparse: only cells with a non-zero count.
    pub cells: Vec<HeatmapCell>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/occurrence-heatmap",
    request_body = ReportFilter,
    responses((
        status = 200,
        body = OccurrenceHeatmapResponse,
        description = "Incident counts by day-of-week and hour-of-day of occurrence, computed in the org unit's local timezone; honors the status filter"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn occurrence_heatmap(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ReportFilter>,
) -> ApiResult<Json<OccurrenceHeatmapResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    // Hour-of-day is meaningless in UTC (9pm Pacific is 4am UTC the next
    // day), so unlike the date-bucketed series this report converts to the
    // scoped org unit's timezone — the root's when no unit is selected.
    // Lookup failures fall back like the notification templates do.
    let tz_unit = match params.org_unit {
        Some(id) => Some(id),
        None => state.org_client.root_uuid().await.ok(),
    };
    let tz_name = match tz_unit {
        Some(id) => {
            crate::review::fetch_org_label_and_timezone(&state, id)
                .await
                .1
        }
        None => None,
    }
    .unwrap_or_else(|| "America/Los_Angeles".to_string());
    let tz: chrono_tz::Tz = tz_name.parse().unwrap_or(chrono_tz::America::Los_Angeles);

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let stamps: Vec<UtcInstant> = incidents_filtered(&org_ids, params.start, params.status)
        .select_only()
        .column(incidents::Column::OccurredAt)
        .into_tuple()
        .all(&state.db)
        .await?;

    let mut grid = [[0i64; 24]; 7];
    for occurred in stamps {
        let local = occurred.with_timezone(&tz);
        let day = local.weekday().num_days_from_sunday() as usize;
        let hour = chrono::Timelike::hour(&local) as usize;
        grid[day][hour] += 1;
    }

    let cells = grid
        .iter()
        .enumerate()
        .flat_map(|(day, hours)| {
            hours.iter().enumerate().filter_map(move |(hour, &count)| {
                (count > 0).then_some(HeatmapCell {
                    day: day as u32,
                    hour: hour as u32,
                    count,
                })
            })
        })
        .collect();

    Ok(Json(OccurrenceHeatmapResponse {
        timezone: tz.to_string(),
        cells,
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ResolutionTimeRow {
    /// Bucket start date (YYYY-MM-DD), bucketed by resolved_at.
    pub bucket: String,
    /// Incidents resolved in this bucket.
    pub resolved: i64,
    /// Median days from occurred_at to resolved_at across them; None for
    /// buckets where nothing was resolved.
    pub median_days: Option<f64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ResolutionTimeResponse {
    pub rows: Vec<ResolutionTimeRow>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/resolution-time",
    request_body = TimeSeriesRequest,
    responses((
        status = 200,
        body = ResolutionTimeResponse,
        description = "Median days from occurrence to resolution per time bucket (bucketed by resolved_at); resolved-only by definition, so the status filter does not apply"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn resolution_time(
    State(state): State<Arc<AppState>>,
    Json(params): Json<TimeSeriesRequest>,
) -> ApiResult<Json<ResolutionTimeResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let mut query = incidents::Entity::find()
        .filter(incidents::Column::DeletedAt.is_null())
        .filter(incidents::Column::ResolvedAt.is_not_null());
    if let Some(ids) = &org_ids {
        query = query.filter(incidents::Column::OrgUnit.is_in(ids.iter().copied()));
    }
    if let Some(start) = params.start {
        query = query.filter(incidents::Column::ResolvedAt.gte(start));
    }
    let stamps: Vec<(UtcInstant, Option<UtcInstant>)> = query
        .select_only()
        .column(incidents::Column::OccurredAt)
        .column(incidents::Column::ResolvedAt)
        .into_tuple()
        .all(&state.db)
        .await?;

    let mut durations: BTreeMap<NaiveDate, Vec<f64>> = BTreeMap::new();
    for (occurred, resolved) in stamps {
        let Some(resolved) = resolved else { continue };
        durations
            .entry(params.bucket.truncate(bucket_date(resolved)))
            .or_default()
            .push((resolved - occurred).num_seconds() as f64 / 86_400.0);
    }

    // Collapse to (median, count) per bucket, then zero-fill the timeline —
    // an empty bucket carries a None median, not a zero.
    let buckets: BTreeMap<NaiveDate, (Option<f64>, i64)> = durations
        .into_iter()
        .map(|(bucket, mut days)| {
            days.sort_by(f64::total_cmp);
            (bucket, (median(&days), days.len() as i64))
        })
        .collect();

    let rows = fill_series(&buckets, params.bucket)
        .into_iter()
        .map(|(bucket, (median_days, resolved))| ResolutionTimeRow {
            bucket: bucket.to_string(),
            resolved,
            median_days,
        })
        .collect();

    Ok(Json(ResolutionTimeResponse { rows }))
}

/// Filters for the KPI summary. Deliberately has no status field: the
/// tiles themselves break the counts down by status.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SummaryRequest {
    pub org_unit: Option<Uuid>,
    pub start: Option<chrono::DateTime<chrono::FixedOffset>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SummaryResponse {
    /// Incidents that occurred in the period.
    pub total_incidents: i64,
    /// Of those, still unresolved.
    pub open_incidents: i64,
    /// Incidents resolved during the period (by resolved_at, matching the
    /// over-time chart's resolved series).
    pub resolved_incidents: i64,
    /// Median days from occurred_at to resolved_at across the incidents
    /// resolved in the period; None when nothing was resolved.
    pub median_days_to_resolve: Option<f64>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/summary",
    request_body = SummaryRequest,
    responses((
        status = 200,
        body = SummaryResponse,
        description = "Headline KPI counts for the dashboard stat tiles"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn summary(
    State(state): State<Arc<AppState>>,
    Json(params): Json<SummaryRequest>,
) -> ApiResult<Json<SummaryResponse>> {
    state
        .auth_client
        .permission_required_uuid("current.incident.read", params.org_unit.as_ref())
        .await?;

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let total_incidents = incidents_filtered(&org_ids, params.start, StatusFilter::All)
        .count(&state.db)
        .await? as i64;
    let open_incidents = incidents_filtered(&org_ids, params.start, StatusFilter::Open)
        .count(&state.db)
        .await? as i64;

    // Resolved-in-period ranges on resolved_at, not occurred_at, so an old
    // incident closed this week still counts toward this week's resolutions.
    let mut resolved_query = incidents::Entity::find()
        .filter(incidents::Column::DeletedAt.is_null())
        .filter(incidents::Column::ResolvedAt.is_not_null());
    if let Some(ids) = &org_ids {
        resolved_query =
            resolved_query.filter(incidents::Column::OrgUnit.is_in(ids.iter().copied()));
    }
    if let Some(start) = params.start {
        resolved_query = resolved_query.filter(incidents::Column::ResolvedAt.gte(start));
    }
    let stamps: Vec<(UtcInstant, Option<UtcInstant>)> = resolved_query
        .select_only()
        .column(incidents::Column::OccurredAt)
        .column(incidents::Column::ResolvedAt)
        .into_tuple()
        .all(&state.db)
        .await?;

    let mut days: Vec<f64> = stamps
        .iter()
        .filter_map(|(occurred, resolved)| {
            resolved.map(|r| (r - *occurred).num_seconds() as f64 / 86_400.0)
        })
        .collect();
    days.sort_by(f64::total_cmp);

    Ok(Json(SummaryResponse {
        total_incidents,
        open_incidents,
        resolved_incidents: days.len() as i64,
        median_days_to_resolve: median(&days),
    }))
}

/// Median of a sorted slice; the even case averages the two middle values.
fn median(sorted: &[f64]) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let mid = sorted.len() / 2;
    Some(if sorted.len() % 2 == 1 {
        sorted[mid]
    } else {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    })
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PatronCountRow {
    pub patron: i32,
    pub label: String,
    pub count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TopPatronsResponse {
    pub rows: Vec<PatronCountRow>,
}

#[utoipa::path(
    post,
    path = "/api/v1/current/reports/top-patrons",
    request_body = ReportFilter,
    responses((
        status = 200,
        body = TopPatronsResponse,
        description = "The five patrons involved in the most incidents, honoring the status filter (distinct incidents per patron)"
    )),
    security(("bearer" = [])),
    tag = "reports"
)]
pub async fn top_patrons(
    State(state): State<Arc<AppState>>,
    Json(params): Json<ReportFilter>,
) -> ApiResult<Json<TopPatronsResponse>> {
    // Exposes patron names, so this report is gated on the patron perm
    // rather than incident.read like the anonymous aggregates.
    state
        .auth_client
        .permission_required_uuid("current.patron.read", params.org_unit.as_ref())
        .await?;

    const TOP_N: usize = 5;

    let org_ids = org_unit_ids(&state, params.org_unit).await?;
    let pairs: Vec<(Option<i32>, i32)> = involved_parties::Entity::find()
        .join(
            JoinType::InnerJoin,
            involved_parties::Relation::Incidents.def(),
        )
        .filter(involved_parties::Column::PatronId.is_not_null())
        .filter(incidents::Column::DeletedAt.is_null())
        .apply_if(
            (params.status != StatusFilter::All).then_some(params.status),
            |q, status| match status {
                StatusFilter::Open => q.filter(incidents::Column::ResolvedAt.is_null()),
                _ => q.filter(incidents::Column::ResolvedAt.is_not_null()),
            },
        )
        .apply_if(org_ids.as_ref(), |q, ids| {
            q.filter(incidents::Column::OrgUnit.is_in(ids.iter().copied()))
        })
        .apply_if(params.start, |q, start| {
            q.filter(incidents::Column::OccurredAt.gte(start))
        })
        .select_only()
        .column(involved_parties::Column::PatronId)
        .column(involved_parties::Column::IncidentId)
        .into_tuple()
        .all(&state.db)
        .await?;

    // Count distinct incidents per patron (a patron listed twice on one
    // incident still counts it once).
    let mut seen: std::collections::HashSet<(i32, i32)> = std::collections::HashSet::new();
    let mut counts: BTreeMap<i32, i64> = BTreeMap::new();
    for (patron, incident) in pairs {
        let Some(patron) = patron else { continue };
        if seen.insert((patron, incident)) {
            *counts.entry(patron).or_default() += 1;
        }
    }

    let mut top: Vec<(i32, i64)> = counts.into_iter().collect();
    // BTreeMap iteration gave ascending patron id, so ties break stably.
    top.sort_by_key(|a| std::cmp::Reverse(a.1));
    top.truncate(TOP_N);

    let names: std::collections::HashMap<i32, String> = patrons::Entity::find()
        .filter(patrons::Column::Id.is_in(top.iter().map(|(id, _)| *id)))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|p| {
            let name = match &p.preferred_name {
                Some(pref) if !pref.is_empty() => {
                    format!("{pref} ({} {})", p.first_name, p.last_name)
                }
                _ => format!("{} {}", p.first_name, p.last_name),
            };
            (p.id, name)
        })
        .collect();

    let rows = top
        .into_iter()
        .map(|(patron, count)| PatronCountRow {
            patron,
            label: names
                .get(&patron)
                .cloned()
                .unwrap_or_else(|| format!("Patron {patron}")),
            count,
        })
        .collect();

    Ok(Json(TopPatronsResponse { rows }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    #[test]
    fn week_truncates_to_monday() {
        // 2026-08-06 is a Thursday; its ISO week starts Monday 2026-08-03.
        assert_eq!(
            ReportBucket::Week.truncate(d("2026-08-06")),
            d("2026-08-03")
        );
        assert_eq!(
            ReportBucket::Week.truncate(d("2026-08-03")),
            d("2026-08-03")
        );
    }

    #[test]
    fn month_truncates_and_steps() {
        assert_eq!(
            ReportBucket::Month.truncate(d("2026-02-17")),
            d("2026-02-01")
        );
        assert_eq!(ReportBucket::Month.next(d("2026-12-01")), d("2027-01-01"));
    }

    #[test]
    fn fill_series_zero_fills_interior_gaps() {
        let mut data = BTreeMap::new();
        data.insert(d("2026-01-01"), (2i64, 0i64));
        data.insert(d("2026-01-04"), (1, 1));
        let rows = fill_series(&data, ReportBucket::Day);
        // Interior gap days are zero-filled...
        assert_eq!(rows[1], (d("2026-01-02"), (0, 0)));
        assert_eq!(rows[2], (d("2026-01-03"), (0, 0)));
        // ...and the series extends through today's bucket.
        let today = chrono::Utc::now().date_naive();
        assert_eq!(rows.last().unwrap().0, today);
    }

    #[test]
    fn median_handles_odd_even_empty() {
        assert_eq!(median(&[]), None);
        assert_eq!(median(&[3.0]), Some(3.0));
        assert_eq!(median(&[1.0, 2.0, 10.0]), Some(2.0));
        assert_eq!(median(&[1.0, 2.0, 3.0, 10.0]), Some(2.5));
    }

    #[test]
    fn fill_series_empty_input_is_empty() {
        let data: BTreeMap<NaiveDate, (i64, i64)> = BTreeMap::new();
        assert!(fill_series(&data, ReportBucket::Month).is_empty());
    }
}
