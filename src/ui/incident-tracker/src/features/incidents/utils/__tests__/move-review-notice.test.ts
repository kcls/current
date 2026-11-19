import { describe, expect, it } from 'vitest';
import { isInReview, moveReviewNotice, type ReviewRow } from '../move-review-notice';

const row = (result: string, min_review_level: number, reviewed_at: string): ReviewRow => ({
  result,
  min_review_level,
  reviewed_at,
});

describe('isInReview', () => {
  it('is false with no reviews (a draft)', () => {
    expect(isInReview([], null)).toBe(false);
  });

  it('is true when the newest review left it at a level', () => {
    expect(isInReview([row('submitted', 1, '2026-01-01T00:00:00Z')], null)).toBe(true);
  });

  it('uses the newest review regardless of order', () => {
    const reviews = [
      row('returned', 0, '2026-01-02T00:00:00Z'),
      row('submitted', 1, '2026-01-01T00:00:00Z'),
    ];
    expect(isInReview(reviews, null)).toBe(false);
    expect(isInReview([...reviews].reverse(), null)).toBe(false);
  });

  it('is false once resolved', () => {
    expect(isInReview([row('approved', 2, '2026-01-01T00:00:00Z')], '2026-01-03T00:00:00Z')).toBe(false);
  });
});

describe('moveReviewNotice', () => {
  it('warns when moving an in-review incident', () => {
    expect(moveReviewNotice(true, true)).toBe(
      'This incident is in review. Moving it to another location may change its review level or return it to draft.',
    );
  });

  it('says nothing when not moving or not in review', () => {
    expect(moveReviewNotice(false, true)).toBeNull();
    expect(moveReviewNotice(true, false)).toBeNull();
  });
});
