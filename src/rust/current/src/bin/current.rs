use axum::Router;
use axum::middleware;
use axum::routing::{get, post};
use current::AppState;
use current::bans;
use current::draft_reminder;
use current::incidents;
use current::patrons;
use current::reports;
use current::review;
use current::sub_locations;
use current::templates;
use odo_client::auth::TokenManager;
use odo_service::health;
use odo_service::middleware::{log_access, request_tracing, require_auth};
use std::env;
use std::sync::Arc;
use tracing::info;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Current",
        version = "0.1.0",
        description = "Incident tracking and management service"
    ),
    paths(
        review::get_review_group,
        review::list_review_chains,
        review::has_review_chain,
        review::save_review_chain,
        review::list_reviews,
        review::get_pending_reviews,
        review::create_incident_review,
        templates::list_templates,
        sub_locations::list_sub_locations,
        incidents::get_incident,
        incidents::search_incidents,
        incidents::get_activity,
        incidents::create_incident,
        incidents::update_incident,
        bans::list_ban_letter_templates,
        bans::get_ban_details,
        bans::get_ban_activity,
        bans::get_ban_letter,
        bans::list_bans,
        bans::create_ban,
        bans::edit_ban,
        bans::archive_ban,
        bans::extend_ban,
        bans::add_to_ban,
        bans::create_ban_letter,
        patrons::get_patron_detail_summary,
        patrons::patron_search,
        patrons::patron_merge_preview,
        patrons::patron_merge_execute,
        patrons::create_patron,
        patrons::update_patron,
        patrons::delete_patron,
        patrons::create_patron_photo,
        patrons::set_primary_patron_photo,
        patrons::delete_patron_photo,
        reports::incidents_over_time,
        reports::incidents_by_template,
        reports::incidents_by_category,
        reports::open_by_review_status,
        reports::incidents_by_location,
        reports::bans_over_time,
        reports::top_patrons,
        reports::summary,
        reports::resolution_time,
        reports::occurrence_heatmap,
    ),
    components(schemas(
        review::ReviewGroupResponse,
        review::ReviewGroupMemberResponse,
        review::ReviewChainResponse,
        review::SaveReviewChainResponse,
        review::ListReviewsRequest,
        review::ReviewHistoryItem,
        review::GetPendingReviewsRequest,
        review::PendingReviewsCursor,
        review::PendingReviewRow,
        review::PendingReviewsResponse,
        review::CreateReviewRequest,
        review::CreateReviewResponse,
        templates::ListTemplatesRequest,
        templates::TemplateResponse,
        sub_locations::ListSubLocationsRequest,
        sub_locations::SubLocationResponse,
        incidents::GetIncidentRequest,
        incidents::IncidentGetOptions,
        incidents::IncidentResponse,
        incidents::InvolvedPartyResponse,
        incidents::ExternalLinkResponse,
        incidents::SearchIncidentsRequest,
        incidents::IncidentSearchOptions,
        incidents::IncidentSearchRow,
        incidents::SearchIncidentsResponse,
        incidents::GetActivityRequest,
        incidents::ActivityLogEntry,
        incidents::GetActivityResponse,
        incidents::CreateIncidentRequest,
        incidents::CreateIncidentResponse,
        incidents::CreateInvolvedParty,
        incidents::AttachmentResponse,
        incidents::CreateExternalLink,
        incidents::UpdateIncidentRequest,
        incidents::UpdateIncidentResponse,
        bans::BanLetterTemplateResponse,
        bans::ListBanLetterTemplatesResponse,
        bans::GetBanDetailsRequest,
        bans::BanDetailRow,
        bans::BanLetterDetailRow,
        bans::BanDetailsResponse,
        bans::GetBanActivityRequest,
        bans::ActivityAttachment,
        bans::ActivityExternalLink,
        bans::ActivityLetter,
        bans::BanActivityLogEntry,
        bans::GetBanActivityResponse,
        bans::GetBanLetterRequest,
        bans::BanLetterContent,
        bans::GetBanLetterResponse,
        bans::ListBansRequest,
        bans::BanListRow,
        bans::ListBansResponse,
        bans::CreateBanRequest,
        bans::PatronBanResponse,
        bans::CreateBanResponse,
        bans::EditBanRequest,
        bans::EditBanResponse,
        bans::ArchiveBanRequest,
        bans::ArchiveBanResponse,
        bans::ExtendBanRequest,
        bans::ExtendBanResponse,
        bans::AddToBanRequest,
        bans::AddToBanExternalLink,
        bans::AddToBanResponse,
        bans::CreateBanLetterRequest,
        bans::CreateBanLetterResponse,
        patrons::GetPatronDetailSummaryRequest,
        patrons::PatronDetailRow,
        patrons::PatronStatistics,
        patrons::PatronPhotoFileUpload,
        patrons::PatronPhotoEntry,
        patrons::PatronDetailSummaryResponse,
        patrons::PatronSearchRequest,
        patrons::PatronSearchRow,
        patrons::PatronSearchResponse,
        patrons::PatronMergePreviewRequest,
        patrons::PatronMergePreviewResponse,
        patrons::PatronMergeExecuteRequest,
        patrons::PatronMergeExecuteResponse,
        patrons::MergeFieldResolution,
        patrons::MergeBanResolution,
        patrons::MergeTrespassResolution,
        patrons::MergeDataSummary,
        patrons::MergeDataTransferred,
        patrons::MergePreviewItems,
        patrons::MergePreviewIncident,
        patrons::MergePreviewPhoto,
        patrons::MergePreviewBan,
        patrons::CreatePatronRequest,
        patrons::UpdatePatronRequest,
        patrons::DeletePatronRequest,
        patrons::DeletePatronResponse,
        patrons::CreatePatronPhotoRequest,
        patrons::PatronPhotoResponse,
        patrons::SetPrimaryPatronPhotoRequest,
        patrons::DeletePatronPhotoRequest,
        patrons::DeletePatronPhotoResponse,
        reports::ReportBucket,
        reports::ReportFilter,
        reports::TimeSeriesRequest,
        reports::IncidentsOverTimeRow,
        reports::IncidentsOverTimeResponse,
        reports::LabelCountRow,
        reports::LabelCountsResponse,
        reports::LocationCountRow,
        reports::LocationCountsResponse,
        reports::StatusFilter,
        reports::BansOverTimeRow,
        reports::BansOverTimeResponse,
        reports::HeatmapCell,
        reports::OccurrenceHeatmapResponse,
        reports::ResolutionTimeRow,
        reports::ResolutionTimeResponse,
        reports::SummaryRequest,
        reports::SummaryResponse,
        reports::PatronCountRow,
        reports::TopPatronsResponse,
    )),
    tags(
        (name = "incidents", description = "Incident management"),
        (name = "patrons", description = "Patron management"),
        (name = "bans", description = "Patron ban management"),
        (name = "reports", description = "Dashboard report aggregates"),
    ),
    security(("bearer" = []))
)]
struct ApiDoc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Spec dump: write the OpenAPI JSON and exit before any startup work.
    if let Some(code) = odo_service::openapi::maybe_dump(ApiDoc::openapi()) {
        std::process::exit(code);
    }

    odo_service::logging::init("info,sqlx::query=info");

    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let auth_url = env::var("ODO_AUTH_URL").unwrap_or_else(|_| "http://odo-auth:8080".to_string());
    let notify_url =
        env::var("ODO_NOTIFY_URL").unwrap_or_else(|_| "http://odo-notify:8080".to_string());
    let org_url = env::var("ODO_ORG_URL").unwrap_or_else(|_| "http://odo-org:8080".to_string());
    let asset_url =
        env::var("ODO_ASSET_URL").unwrap_or_else(|_| "http://odo-asset:8080".to_string());

    // Public-facing URL used when notification templates need to embed
    // links back into the UI (e.g. "View Incident" in a review email).
    // No fallback in production; default localhost is just for dev.
    let public_url =
        env::var("CURRENT_PUBLIC_URL").unwrap_or_else(|_| "http://localhost:30080".to_string());

    info!(
        svc = "current",
        version = env!("CARGO_PKG_VERSION"),
        "starting"
    );

    let db = odo_service::db::connect().await?;
    info!("database connected");

    // JWT verification keys come from odo-auth's JWKS endpoint (retried
    // until reachable, refreshed in the background so key rotations are
    // picked up). JWT_PUBLIC_KEY remains as an override for tests and
    // environments without a live odo-auth.
    let tokens = match env::var("JWT_PUBLIC_KEY") {
        Ok(pem) => TokenManager::rsa_verifier(&pem),
        Err(_) => {
            let jwks_url = format!("{auth_url}/.well-known/jwks.json");
            TokenManager::jwks_verifier(&jwks_url, 300).await
        }
    };

    let state = Arc::new(AppState {
        db,
        tokens,
        auth_client: odo_client::client::ServiceClient::new(auth_url).into(),
        notify_client: odo_client::client::ServiceClient::new(notify_url),
        org_client: odo_client::client::ServiceClient::new(org_url).into(),
        asset_client: odo_client::client::ServiceClient::new(asset_url).into(),
        public_url,
    });

    if let Some(cfg) = draft_reminder::Config::from_env() {
        let reminder_state = state.clone();
        info!(
            send_time = %cfg.send_time,
            timezone = %cfg.tz,
            min_age_hours = cfg.min_age_hours,
            "draft reminder job enabled"
        );
        tokio::spawn(async move {
            draft_reminder::run(reminder_state, cfg).await;
        });
    }

    let app = Router::new()
        .route(
            "/api/v1/current/review-group/{id}",
            get(review::get_review_group),
        )
        .route(
            "/api/v1/current/review-chain/list",
            post(review::list_review_chains),
        )
        .route(
            "/api/v1/current/review-chain/has",
            post(review::has_review_chain),
        )
        .route(
            "/api/v1/current/review-chain/save",
            post(review::save_review_chain),
        )
        .route(
            "/api/v1/current/incident/review/list",
            post(review::list_reviews),
        )
        .route(
            "/api/v1/current/incident/pending-reviews",
            post(review::get_pending_reviews),
        )
        .route(
            "/api/v1/current/incident/review/create",
            post(review::create_incident_review),
        )
        .route(
            "/api/v1/current/template/list",
            post(templates::list_templates),
        )
        .route(
            "/api/v1/current/sub-location/list",
            post(sub_locations::list_sub_locations),
        )
        .route(
            "/api/v1/current/incident/get",
            post(incidents::get_incident),
        )
        .route(
            "/api/v1/current/incident/search",
            post(incidents::search_incidents),
        )
        .route(
            "/api/v1/current/incident/activity",
            post(incidents::get_activity),
        )
        .route(
            "/api/v1/current/incident/create",
            post(incidents::create_incident),
        )
        .route(
            "/api/v1/current/incident/update",
            post(incidents::update_incident),
        )
        .route(
            "/api/v1/current/ban/letter/template/list",
            post(bans::list_ban_letter_templates),
        )
        .route("/api/v1/current/ban/details", post(bans::get_ban_details))
        .route("/api/v1/current/ban/activity", post(bans::get_ban_activity))
        .route("/api/v1/current/ban/letter/get", post(bans::get_ban_letter))
        .route("/api/v1/current/ban/list", post(bans::list_bans))
        .route("/api/v1/current/ban/create", post(bans::create_ban))
        .route("/api/v1/current/ban/edit", post(bans::edit_ban))
        .route("/api/v1/current/ban/archive", post(bans::archive_ban))
        .route("/api/v1/current/ban/extend", post(bans::extend_ban))
        .route("/api/v1/current/ban/add-to", post(bans::add_to_ban))
        .route(
            "/api/v1/current/ban/letter/create",
            post(bans::create_ban_letter),
        )
        .route(
            "/api/v1/current/patron/details",
            post(patrons::get_patron_detail_summary),
        )
        .route(
            "/api/v1/current/patron/search",
            post(patrons::patron_search),
        )
        .route(
            "/api/v1/current/patron/merge/preview",
            post(patrons::patron_merge_preview),
        )
        .route(
            "/api/v1/current/patron/merge",
            post(patrons::patron_merge_execute),
        )
        .route(
            "/api/v1/current/patron/create",
            post(patrons::create_patron),
        )
        .route(
            "/api/v1/current/patron/update",
            post(patrons::update_patron),
        )
        .route(
            "/api/v1/current/patron/delete",
            post(patrons::delete_patron),
        )
        .route(
            "/api/v1/current/patron/photo/create",
            post(patrons::create_patron_photo),
        )
        .route(
            "/api/v1/current/patron/photo/set-primary",
            post(patrons::set_primary_patron_photo),
        )
        .route(
            "/api/v1/current/patron/photo/delete",
            post(patrons::delete_patron_photo),
        )
        .route(
            "/api/v1/current/reports/incidents-over-time",
            post(reports::incidents_over_time),
        )
        .route(
            "/api/v1/current/reports/by-template",
            post(reports::incidents_by_template),
        )
        .route(
            "/api/v1/current/reports/by-category",
            post(reports::incidents_by_category),
        )
        .route(
            "/api/v1/current/reports/open-by-review-status",
            post(reports::open_by_review_status),
        )
        .route(
            "/api/v1/current/reports/incidents-by-location",
            post(reports::incidents_by_location),
        )
        .route(
            "/api/v1/current/reports/bans-over-time",
            post(reports::bans_over_time),
        )
        .route(
            "/api/v1/current/reports/top-patrons",
            post(reports::top_patrons),
        )
        .route("/api/v1/current/reports/summary", post(reports::summary))
        .route(
            "/api/v1/current/reports/resolution-time",
            post(reports::resolution_time),
        )
        .route(
            "/api/v1/current/reports/occurrence-heatmap",
            post(reports::occurrence_heatmap),
        )
        .layer(middleware::from_fn(log_access))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth))
        .layer(middleware::from_fn(request_tracing))
        .route(
            "/api/v1/current/api-doc/openapi.json",
            get(|| async { axum::Json(ApiDoc::openapi()) }),
        )
        .route("/health", get(health::check::<AppState>))
        .with_state(state);

    let addr = format!("[::]:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!(addr = %addr, "listening");

    odo_service::server::serve(listener, app).await?;

    info!("shutdown complete");
    Ok(())
}
