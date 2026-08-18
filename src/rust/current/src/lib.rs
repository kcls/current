pub mod bans;
pub mod draft_reminder;
pub mod entity;
pub mod incidents;
pub mod patrons;
pub mod reports;
pub mod review;
pub mod sub_locations;
pub mod templates;

use odo_client::auth::TokenManager;
use odo_client::client::{AssetServiceClient, AuthServiceClient, OrgServiceClient, ServiceClient};
use odo_service::health::HasDatabase;
use odo_service::middleware::HasTokenManager;
use sea_orm::DatabaseConnection;

pub struct AppState {
    pub db: DatabaseConnection,
    pub tokens: TokenManager,
    pub auth_client: AuthServiceClient,
    pub org_client: OrgServiceClient,
    pub notify_client: ServiceClient,
    pub asset_client: AssetServiceClient,
    /// Public-facing base URL of the application — used when building
    /// links in notification template variables (e.g. the "View
    /// Incident" link in a review email). Read from the
    /// `CURRENT_PUBLIC_URL` env var at startup.
    pub public_url: String,
}

impl HasTokenManager for AppState {
    fn token_manager(&self) -> &TokenManager {
        &self.tokens
    }
}

impl HasDatabase for AppState {
    fn db(&self) -> &DatabaseConnection {
        &self.db
    }
}
