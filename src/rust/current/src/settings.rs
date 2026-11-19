//! Site-wide settings from `incidents.config_global_setting`.
//!
//! Each setting gets a typed accessor here. A missing row, or a value the
//! accessor does not recognize, falls back to the seeded default, so a
//! damaged config table degrades to stock behavior rather than failing
//! requests.

use odo_client::error::LocalResult;
use sea_orm::prelude::*;

use crate::entity::config_global_setting;

const MOVE_REVIEW_MODE: &str = "incident.move.review_mode";

/// What happens to an in-review incident when it moves to another location.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveReviewMode {
    /// Resubmit it at level 1 of the new location's chain, or return it to
    /// draft when that location has no chain.
    FirstLevel,
    /// Return it to the reporter, who resubmits it at the new location.
    ReturnToDraft,
}

impl MoveReviewMode {
    const DEFAULT: Self = Self::FirstLevel;

    fn parse(value: &str) -> Option<Self> {
        match value {
            "first_level" => Some(Self::FirstLevel),
            "return_to_draft" => Some(Self::ReturnToDraft),
            _ => None,
        }
    }
}

async fn value<C: ConnectionTrait>(db: &C, name: &str) -> LocalResult<Option<Json>> {
    Ok(config_global_setting::Entity::find_by_id(name)
        .one(db)
        .await?
        .map(|row| row.value))
}

pub async fn move_review_mode<C: ConnectionTrait>(db: &C) -> LocalResult<MoveReviewMode> {
    let Some(raw) = value(db, MOVE_REVIEW_MODE).await? else {
        return Ok(MoveReviewMode::DEFAULT);
    };
    match raw.as_str().and_then(MoveReviewMode::parse) {
        Some(mode) => Ok(mode),
        None => {
            tracing::warn!(setting = MOVE_REVIEW_MODE, value = %raw, "unrecognized setting value; using default");
            Ok(MoveReviewMode::DEFAULT)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_modes() {
        assert_eq!(
            MoveReviewMode::parse("first_level"),
            Some(MoveReviewMode::FirstLevel)
        );
        assert_eq!(
            MoveReviewMode::parse("return_to_draft"),
            Some(MoveReviewMode::ReturnToDraft)
        );
    }

    #[test]
    fn rejects_unknown_modes() {
        assert_eq!(MoveReviewMode::parse("level_one"), None);
        assert_eq!(MoveReviewMode::parse(""), None);
    }
}
