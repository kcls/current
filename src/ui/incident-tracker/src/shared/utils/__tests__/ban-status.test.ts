import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { getBanStatus } from '../ban-status';
import { setLibraryTimezone } from '../date-utils';

// All tests use a fixed "now" so results are deterministic.
// 2026-03-15T19:00:00Z = Mar 15 12:00 PM PDT
const NOW = '2026-03-15T19:00:00Z';

beforeAll(() => {
  setLibraryTimezone('America/Los_Angeles');
});

afterEach(() => vi.useRealTimers());

function freeze() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
}

describe('getBanStatus', () => {
  it('returns Archived when archived_by is set', () => {
    freeze();
    const result = getBanStatus({ archived_by: 'user-uuid-1' });
    expect(result).toEqual({ label: 'Archived', color: 'default' });
  });

  it('returns Lifted for a non-trespass ban past lifts_at', () => {
    freeze();
    const result = getBanStatus({
      starts_at: '2026-03-01T08:00:00+00:00',
      lifts_at: '2026-03-10T07:00:00+00:00', // Mar 10 PDT — in the past
    });
    expect(result).toEqual({ label: 'Lifted', color: 'success' });
  });

  it('returns Waiting for archive for a trespass past lifts_at', () => {
    freeze();
    const result = getBanStatus({
      is_trespass: true,
      starts_at: '2026-03-01T08:00:00+00:00',
      lifts_at: '2026-03-10T07:00:00+00:00',
    });
    expect(result).toEqual({ label: 'Waiting for archive', color: 'warning' });
  });

  it('returns Scheduled for a ban with future starts_at', () => {
    freeze();
    // starts_at = Mar 20 PDT midnight = 07:00 UTC → 5 days from "now" (Mar 15)
    const result = getBanStatus({
      starts_at: '2026-03-20T07:00:00+00:00',
      lifts_at: '2026-04-19T07:00:00+00:00',
    });
    expect(result.color).toBe('warning');
    expect(result.label).toBe('Scheduled (starts in 5d)');
  });

  it('returns Active with remaining days for a started ban with lifts_at', () => {
    freeze();
    // starts_at = Mar 10 (past), lifts_at = Mar 25 PDT midnight → 10 days remaining
    const result = getBanStatus({
      starts_at: '2026-03-10T07:00:00+00:00',
      lifts_at: '2026-03-25T07:00:00+00:00',
    });
    expect(result.color).toBe('error');
    expect(result.label).toBe('Active (10d remaining)');
  });

  it('returns Active (no remaining) for a started ban without lifts_at', () => {
    freeze();
    const result = getBanStatus({
      starts_at: '2026-03-10T07:00:00+00:00',
    });
    expect(result).toEqual({ label: 'Active', color: 'error' });
  });

  it('archived takes precedence over scheduled', () => {
    freeze();
    const result = getBanStatus({
      archived_by: 'user-uuid-1',
      starts_at: '2026-03-20T07:00:00+00:00',
      lifts_at: '2026-04-19T07:00:00+00:00',
    });
    expect(result).toEqual({ label: 'Archived', color: 'default' });
  });

  it('lifted takes precedence over scheduled start check', () => {
    freeze();
    // Edge case: starts_at in the future but lifts_at in the past (shouldn't happen in practice)
    const result = getBanStatus({
      starts_at: '2026-03-20T07:00:00+00:00',
      lifts_at: '2026-03-10T07:00:00+00:00',
    });
    expect(result).toEqual({ label: 'Lifted', color: 'success' });
  });

  it('handles starts_at = today as active, not scheduled', () => {
    freeze();
    // Mar 15 PDT midnight = 07:00 UTC Mar 15; "now" is 19:00 UTC Mar 15
    // isTimestampPast('2026-03-15T07:00:00+00:00') should be true
    const result = getBanStatus({
      starts_at: '2026-03-15T07:00:00+00:00',
      lifts_at: '2026-04-14T07:00:00+00:00',
    });
    expect(result.color).toBe('error');
    expect(result.label).toMatch(/^Active/);
  });
});
