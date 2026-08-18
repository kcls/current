//! Background job that reminds report authors about incident reports they
//! saved but have not yet submitted for review.
//!
//! An incident is "unsubmitted" when it has **no** `incidents.incident_review`
//! row (and is neither deleted nor resolved) — the exact inverse of the
//! pending-reviews query in [`crate::review`], which deliberately excludes
//! these. The author is `incidents.created_by`.
//!
//! Behaviour:
//! - One email per unsubmitted report.
//! - Only reports that have been saved for at least `min_age_hours`.
//! - Sent once per day at a fixed local time (`DRAFT_REMINDER_SEND_TIME` in
//!   `DRAFT_REMINDER_TIMEZONE`, default 08:00 America/Los_Angeles).
//! - Repeats daily until submitted — the `dedup_key` carries the send
//!   timezone's calendar date, so odo-notify collapses repeat enqueues within
//!   a day but a new day produces a fresh reminder.
//! - Email only (`channels: ["email"]`) — no in-app notification.
//!
//! The daily-dated `dedup_key` also makes the job safe to run on multiple
//! `current` replicas: all replicas wake at the same instant and their
//! concurrent enqueues for the same incident+day collapse on the key, so no
//! cross-replica locking or leader election is needed.

use std::env;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use odo_client::context::RequestContext;
use odo_client::error::{LocalError, LocalResult};
use sea_orm::prelude::*;
use sea_orm::{FromQueryResult, QueryOrder, QuerySelect, QueryTrait};

use crate::AppState;
use crate::review::{fetch_incident_template_names, fetch_org_label_and_timezone};

#[derive(Debug, FromQueryResult)]
struct UnsubmittedReport {
    id: i32,
    created_by: Uuid,
    org_unit: Uuid,
    created_at: DateTimeWithTimeZone,
}

pub struct Config {
    pub send_time: NaiveTime,
    pub tz: Tz,
    pub min_age_hours: i64,
    pub service_username: String,
    pub service_password: String,
}

impl Config {
    pub fn from_env() -> Option<Config> {
        let enabled = env::var("DRAFT_REMINDER_ENABLED")
            .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"))
            .unwrap_or(false);
        if !enabled {
            return None;
        }

        let default_time = NaiveTime::from_hms_opt(8, 0, 0).expect("08:00 is a valid time");
        let send_time = match env::var("DRAFT_REMINDER_SEND_TIME") {
            Ok(v) => NaiveTime::parse_from_str(&v, "%H:%M").unwrap_or_else(|_| {
                tracing::warn!(
                    value = %v,
                    "invalid DRAFT_REMINDER_SEND_TIME (expected HH:MM), using 08:00"
                );
                default_time
            }),
            Err(_) => default_time,
        };

        let default_tz = chrono_tz::America::Los_Angeles;
        let tz = match env::var("DRAFT_REMINDER_TIMEZONE") {
            Ok(v) => v.parse::<Tz>().unwrap_or_else(|_| {
                tracing::warn!(
                    value = %v,
                    "invalid DRAFT_REMINDER_TIMEZONE (expected IANA name), using America/Los_Angeles"
                );
                default_tz
            }),
            Err(_) => default_tz,
        };

        let min_age_hours = env::var("DRAFT_REMINDER_MIN_AGE_HOURS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(48);

        let service_username = env::var("NOTIFY_SERVICE_USERNAME").unwrap_or_default();
        let service_password = env::var("NOTIFY_SERVICE_PASSWORD").unwrap_or_default();
        if service_username.is_empty() || service_password.is_empty() {
            tracing::warn!(
                "draft reminder enabled but NOTIFY_SERVICE_USERNAME/PASSWORD not set; \
                 enqueue calls to odo-notify will fail authentication"
            );
        }

        Some(Config {
            send_time,
            tz,
            min_age_hours,
            service_username,
            service_password,
        })
    }
}

/// Scheduler loop. Sleeps until the next `send_time` in `tz`, runs one scan,
/// then sleeps until the following day's `send_time` — so reminders go out
/// once per day at a fixed local time.
pub async fn run(state: Arc<AppState>, cfg: Config) {
    loop {
        let now = Utc::now();
        let next = next_send_utc(now, cfg.send_time, cfg.tz);
        let wait = (next - now).to_std().unwrap_or(Duration::ZERO);
        tracing::info!(
            next_send = %next.with_timezone(&cfg.tz),
            "draft reminder sleeping until next send"
        );
        tokio::time::sleep(wait).await;

        let day = Utc::now()
            .with_timezone(&cfg.tz)
            .format("%Y-%m-%d")
            .to_string();
        match scan_and_notify(&state, &cfg, &day).await {
            Ok(count) => {
                if count > 0 {
                    tracing::info!(count, "draft reminder enqueued reminders");
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, "draft reminder scan failed");
            }
        }
    }
}

fn next_send_utc(now: DateTime<Utc>, time: NaiveTime, tz: Tz) -> DateTime<Utc> {
    let today = now.with_timezone(&tz).date_naive();
    if let Some(candidate) = resolve_local(today, time, tz)
        && candidate > now
    {
        return candidate;
    }
    let tomorrow = today.succ_opt().unwrap_or(today);
    resolve_local(tomorrow, time, tz).unwrap_or_else(|| now + chrono::Duration::days(1))
}

fn resolve_local(date: NaiveDate, time: NaiveTime, tz: Tz) -> Option<DateTime<Utc>> {
    let naive = date.and_time(time);
    tz.from_local_datetime(&naive)
        .earliest()
        .or_else(|| {
            tz.from_local_datetime(&(naive + chrono::Duration::hours(1)))
                .earliest()
        })
        .map(|dt| dt.with_timezone(&Utc))
}

async fn scan_and_notify(state: &AppState, cfg: &Config, day: &str) -> LocalResult<usize> {
    let token = service_login(state, cfg).await?;
    let claims = state
        .tokens
        .verify(&token)
        .map_err(|_| LocalError::internal("service login returned an invalid token"))?;
    let ctx = RequestContext::generate().with_auth(token, claims);

    ctx.scope(async move {
        let reports = fetch_unsubmitted_reports(&state.db, cfg.min_age_hours).await?;
        let now = Utc::now();

        for report in &reports {
            if let Err(e) = enqueue_reminder(state, report, now, day).await {
                tracing::warn!(
                    incident_id = report.id,
                    author = %report.created_by,
                    error = %e,
                    "draft reminder enqueue failed"
                );
            }
        }

        Ok(reports.len())
    })
    .await
}

async fn service_login(state: &AppState, cfg: &Config) -> LocalResult<String> {
    #[derive(serde::Deserialize)]
    struct LoginResponse {
        access_token: String,
    }

    let body = serde_json::json!({
        "username": cfg.service_username,
        "password": cfg.service_password,
    });

    let resp: LoginResponse = state
        .auth_client
        .post("/api/v1/odo/auth/login", &body)
        .await?;

    Ok(resp.access_token)
}

async fn fetch_unsubmitted_reports(
    db: &sea_orm::DatabaseConnection,
    min_age_hours: i64,
) -> LocalResult<Vec<UnsubmittedReport>> {
    use crate::entity::{incident_review, incidents};

    let cutoff: DateTimeWithTimeZone =
        (chrono::Utc::now() - chrono::Duration::hours(min_age_hours)).into();

    // Incidents that have never been reviewed (NOT EXISTS a review row).
    // Equivalent to id NOT IN (SELECT incident FROM incident_review).
    let reviewed_subquery = incident_review::Entity::find()
        .select_only()
        .column(incident_review::Column::Incident)
        .distinct()
        .into_query();

    let rows = incidents::Entity::find()
        .select_only()
        .column(incidents::Column::Id)
        .column(incidents::Column::CreatedBy)
        .column(incidents::Column::OrgUnit)
        .column(incidents::Column::CreatedAt)
        .filter(incidents::Column::DeletedAt.is_null())
        .filter(incidents::Column::ResolvedAt.is_null())
        .filter(incidents::Column::CreatedAt.lte(cutoff))
        .filter(incidents::Column::Id.not_in_subquery(reviewed_subquery))
        .order_by_asc(incidents::Column::CreatedAt)
        .into_model::<UnsubmittedReport>()
        .all(db)
        .await?;

    Ok(rows)
}

/// Build the template variables and POST one enqueue to odo-notify
async fn enqueue_reminder(
    state: &AppState,
    report: &UnsubmittedReport,
    now: chrono::DateTime<chrono::Utc>,
    day: &str,
) -> LocalResult<()> {
    let incident_id = report.id;

    let (org_label, org_timezone) = fetch_org_label_and_timezone(state, report.org_unit).await;
    let incident_type = fetch_incident_template_names(&state.db, incident_id).await;

    let days_pending = (now - report.created_at.with_timezone(&chrono::Utc))
        .num_days()
        .max(0);
    let incident_url = format!("{}/incidents/{incident_id}", state.public_url);
    let created_at = report.created_at.to_rfc3339();

    let template_variables = serde_json::json!({
        "incident_id": incident_id,
        "incident_type": incident_type,
        "incident_location": org_label,
        "incident_created_at": created_at,
        "incident_timezone": org_timezone.unwrap_or_else(|| "America/Los_Angeles".to_string()),
        "days_pending": days_pending,
        "incident_url": incident_url,
    });

    let payload = serde_json::json!({
        "recipients": [{
            "type": "user",
            "user_id": report.created_by,
            "channels": ["email"],
        }],
        "template_code": "incident-draft-reminder",
        "template_variables": template_variables,
        "source_service": "current",
        "source_entity_type": "incident",
        "source_entity_id": incident_id,
        "dedup_key": format!("incident-draft-reminder:{incident_id}:{day}"),
    });

    state
        .notify_client
        .post::<serde_json::Value, _>("/api/v1/odo/notify/enqueue", &payload)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Timelike;

    const PT: Tz = chrono_tz::America::Los_Angeles;

    fn at_eight() -> NaiveTime {
        NaiveTime::from_hms_opt(8, 0, 0).unwrap()
    }

    #[test]
    fn next_send_is_today_when_before_send_time() {
        // 06:00 PDT on 2026-07-24 == 13:00Z — 08:00 is still ahead today
        let now = Utc.with_ymd_and_hms(2026, 7, 24, 13, 0, 0).unwrap();
        let next = next_send_utc(now, at_eight(), PT);
        let local = next.with_timezone(&PT);

        assert!(next > now);
        assert_eq!((local.hour(), local.minute()), (8, 0));
        assert_eq!(local.date_naive(), now.with_timezone(&PT).date_naive());
    }

    #[test]
    fn next_send_is_tomorrow_when_after_send_time() {
        // 09:00 PDT on 2026-07-24 == 16:00Z — 08:00 already passed today
        let now = Utc.with_ymd_and_hms(2026, 7, 24, 16, 0, 0).unwrap();
        let next = next_send_utc(now, at_eight(), PT);
        let local = next.with_timezone(&PT);

        assert_eq!((local.hour(), local.minute()), (8, 0));
        let tomorrow = now.with_timezone(&PT).date_naive().succ_opt().unwrap();
        assert_eq!(local.date_naive(), tomorrow);
    }

    #[test]
    fn resolve_local_maps_to_correct_utc_offset() {
        // PDT (summer) is UTC-7, so 08:00 local == 15:00Z
        let d = NaiveDate::from_ymd_opt(2026, 7, 24).unwrap();
        let utc = resolve_local(d, at_eight(), PT).unwrap();
        assert_eq!(utc, Utc.with_ymd_and_hms(2026, 7, 24, 15, 0, 0).unwrap());
    }
}
