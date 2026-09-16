import { describe, it, expect } from 'vitest';
import { newestCreatedAt } from '../use-shift-notes';

/**
 * The poll's `since` watermark must be the newest created_at on the page,
 * not the first row.
 *
 * Regression: it used to be `rows[0].created_at`, which is only the newest
 * under the default date-descending sort. Sorted ascending — or by type,
 * staff, or library — rows[0] can be the oldest entry shown, so the poll
 * counted entries already on screen as new on every tick.
 */
const OLD = '2026-09-10T17:25:20.000Z';
const MID = '2026-09-10T19:56:39.000Z';
const NEW = '2026-09-10T21:32:14.000Z';

const rows = (...dates: string[]) => dates.map(d => ({ created_at: d }));

describe('newestCreatedAt', () => {
  it('takes the newest row when sorted newest-first', () => {
    expect(newestCreatedAt(rows(NEW, MID, OLD))).toBe(NEW);
  });

  it('takes the newest row when sorted oldest-first', () => {
    // rows[0] is OLD here — the old code used it and produced phantom counts.
    expect(newestCreatedAt(rows(OLD, MID, NEW))).toBe(NEW);
  });

  it('takes the newest row when ordered by something other than date', () => {
    // Sorting by type/staff/library leaves dates in arbitrary order.
    expect(newestCreatedAt(rows(MID, NEW, OLD))).toBe(NEW);
  });

  it('is null for an empty page, so the poll stays idle', () => {
    expect(newestCreatedAt([])).toBeNull();
  });

  it('handles a single row', () => {
    expect(newestCreatedAt(rows(MID))).toBe(MID);
  });
});
