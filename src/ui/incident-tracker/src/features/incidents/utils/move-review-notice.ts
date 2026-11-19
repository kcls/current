/** The fields of an incident review row this module reads. */
export interface ReviewRow {
  result: string;
  min_review_level: number;
  reviewed_at: string;
}

/**
 * Whether the incident is waiting in a review chain, by the same test the
 * backend's move applies: the newest review is neither a return to the
 * reporter nor at level 0, and the incident is not resolved.
 */
export function isInReview(reviews: ReviewRow[], resolvedAt: string | null | undefined): boolean {
  if (resolvedAt) return false;
  const latest = reviews.reduce<ReviewRow | null>(
    (newest, r) => (newest === null || Date.parse(r.reviewed_at) > Date.parse(newest.reviewed_at) ? r : newest),
    null,
  );
  return latest !== null && latest.result !== 'returned' && latest.min_review_level > 0;
}

/**
 * The warning for saving a location change on an in-review incident, or
 * null when there is nothing to warn about. Deliberately general: where the
 * incident lands depends on the new location's chain and on the site's
 * incident.move.review_mode setting, which the UI cannot see.
 */
export function moveReviewNotice(isMoving: boolean, inReview: boolean): string | null {
  return isMoving && inReview
    ? 'This incident is in review. Moving it to another location may change its review level or return it to draft.'
    : null;
}
