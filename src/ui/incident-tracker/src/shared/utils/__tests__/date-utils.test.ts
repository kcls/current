import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { parseISO, isValid } from 'date-fns';
import {
  formatLocalDate,
  parseTimestamp,
  formatTimestamp,
  startOfDayLocal,
  endOfDayLocal,
  startOfDayUtc,
  endOfDayUtc,
  isTimestampPast,
  getToday,
  getDaysAgo,
  getDefaultDateRange,
  formatRelativeTime,
  PRESET_DAYS,
  getDurationLabel,
  calculateLiftDate,
  calculateArchivesAt,
  getDefaultDuration,
  localDateToUtc,
  localDateTimeToUtc,
  utcToLocalDate,
  utcToLocalDateTime,
  getDefaultBanDates,
  formatBanDate,
  setLibraryTimezone,
  getLibraryToday,
  getLibraryNowTime,
} from '../date-utils';

// All tests assume library timezone = America/Los_Angeles.
// 2026 DST: Spring forward Mar 8, Fall back Nov 1.
// PST = UTC-8, PDT = UTC-7.
beforeAll(() => {
  setLibraryTimezone('America/Los_Angeles');
});

// ---------------------------------------------------------------------------
// Pure formatting / parsing (timezone-independent)
// ---------------------------------------------------------------------------

describe('formatLocalDate', () => {
  it('should format date as YYYY-MM-DD', () => {
    expect(formatLocalDate(new Date(2024, 0, 15))).toBe('2024-01-15');
  });

  it('should pad single digit months and days', () => {
    expect(formatLocalDate(new Date(2024, 4, 5))).toBe('2024-05-05');
  });
});

describe('parseTimestamp', () => {
  it('should parse full ISO timestamp with timezone', () => {
    const result = parseTimestamp('2024-01-15T10:30:00+00:00');
    expect(result).toBeInstanceOf(Date);
    expect(result.toString()).not.toBe('Invalid Date');
  });

  it('should parse ISO timestamp with Z suffix', () => {
    const result = parseTimestamp('2024-01-15T10:30:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.toString()).not.toBe('Invalid Date');
  });

  it('should parse legacy YYYY-MM-DD format as local time', () => {
    const result = parseTimestamp('2024-01-15');
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(15);
  });
});

describe('formatTimestamp', () => {
  it('should format timestamp with default format', () => {
    expect(formatTimestamp('2024-01-15T10:30:00Z')).toMatch(/Jan 1[45], 2024/);
  });

  it('should return "N/A" for null/undefined/empty', () => {
    expect(formatTimestamp(null)).toBe('N/A');
    expect(formatTimestamp(undefined)).toBe('N/A');
    expect(formatTimestamp('')).toBe('N/A');
  });

  it('should return "Invalid date" for unparseable input', () => {
    expect(formatTimestamp('not-a-date')).toBe('Invalid date');
  });
});

describe('startOfDayLocal / endOfDayLocal', () => {
  it('startOfDayLocal returns 00:00:00', () => {
    const r = startOfDayLocal('2024-01-15');
    expect(r.getHours()).toBe(0);
    expect(r.getMinutes()).toBe(0);
  });

  it('endOfDayLocal returns 23:59:59.999', () => {
    const r = endOfDayLocal('2024-01-15');
    expect(r.getHours()).toBe(23);
    expect(r.getMinutes()).toBe(59);
    expect(r.getSeconds()).toBe(59);
    expect(r.getMilliseconds()).toBe(999);
  });
});

describe('isTimestampPast', () => {
  it('should return true for past dates', () => {
    expect(isTimestampPast('2020-01-01T00:00:00Z')).toBe(true);
  });

  it('should return false for future dates', () => {
    expect(isTimestampPast('2099-01-01T00:00:00Z')).toBe(false);
  });
});

describe('PRESET_DAYS', () => {
  it('should contain expected values', () => {
    expect(PRESET_DAYS).toEqual([1, 7, 14, 30, 180, 365]);
  });
});

describe('getDurationLabel', () => {
  it.each([
    [1, '1 day'],
    [7, '1 week'],
    [14, '2 weeks'],
    [30, '1 month'],
    [180, '6 months'],
    [365, '1 year'],
  ])('returns %s → "%s"', (days, expected) => {
    expect(getDurationLabel(days)).toBe(expected);
  });

  it('falls back to "N days" for unknown values', () => {
    expect(getDurationLabel(45)).toBe('45 days');
  });
});

describe('getDefaultDuration', () => {
  it('should return 30 for both ban and trespass', () => {
    expect(getDefaultDuration(false)).toBe(30);
    expect(getDefaultDuration(true)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Library timezone conversions
// ---------------------------------------------------------------------------

describe('localDateToUtc', () => {
  it('PST (Jan): midnight Pacific = 08:00 UTC', () => {
    const result = localDateToUtc('2026-01-15');
    expect(result).toBe('2026-01-15T08:00:00.000+00:00');
  });

  it('PDT (Jun): midnight Pacific = 07:00 UTC', () => {
    const result = localDateToUtc('2026-06-15');
    expect(result).toBe('2026-06-15T07:00:00.000+00:00');
  });

  it('should return fallback for invalid input', () => {
    expect(localDateToUtc('bad')).toBe('badT00:00:00+00:00');
  });
});

describe('utcToLocalDate', () => {
  it('should extract Pacific date from UTC (PST)', () => {
    // 08:00 UTC = midnight PST Jan 15
    expect(utcToLocalDate('2026-01-15T08:00:00.000Z')).toBe('2026-01-15');
  });

  it('should extract Pacific date from UTC (PDT)', () => {
    // 07:00 UTC = midnight PDT Jun 15
    expect(utcToLocalDate('2026-06-15T07:00:00.000Z')).toBe('2026-06-15');
  });

  it('UTC midnight rolls back to previous Pacific date (PST)', () => {
    // 00:00 UTC = 4pm PST previous day
    expect(utcToLocalDate('2026-01-15T00:00:00+00:00')).toBe('2026-01-14');
  });

  it('UTC midnight rolls back to previous Pacific date (PDT)', () => {
    // 00:00 UTC = 5pm PDT previous day
    expect(utcToLocalDate('2026-06-15T00:00:00+00:00')).toBe('2026-06-14');
  });

  it('should handle invalid input gracefully', () => {
    expect(utcToLocalDate('not-a-date')).toBe('not-a-date');
  });
});

describe('localDateTimeToUtc', () => {
  it('PST: 15:30 Pacific = 23:30 UTC', () => {
    expect(localDateTimeToUtc('2026-01-15', '15:30')).toBe('2026-01-15T23:30:00.000Z');
  });

  it('PDT: 15:30 Pacific = 22:30 UTC', () => {
    expect(localDateTimeToUtc('2026-06-15', '15:30')).toBe('2026-06-15T22:30:00.000Z');
  });

  it('PST late night crosses UTC day boundary', () => {
    // 23:54 PST Jan 15 = 07:54 UTC Jan 16
    expect(localDateTimeToUtc('2026-01-15', '23:54')).toBe('2026-01-16T07:54:00.000Z');
  });

  it('handles malformed input gracefully', () => {
    expect(localDateTimeToUtc('bad', '15:30')).toBe('badT15:30:00+00:00');
  });
});

describe('utcToLocalDateTime', () => {
  it('PST: 23:54 UTC = 15:54 Pacific (matches the reported bug example)', () => {
    expect(utcToLocalDateTime('2026-01-15T23:54:00Z')).toEqual({
      date: '2026-01-15',
      time: '15:54',
    });
  });

  it('PDT: 22:30 UTC = 15:30 Pacific', () => {
    expect(utcToLocalDateTime('2026-06-15T22:30:00Z')).toEqual({
      date: '2026-06-15',
      time: '15:30',
    });
  });

  it('UTC after midnight rolls back to previous Pacific day (PST)', () => {
    // 02:00 UTC Jan 16 = 18:00 PST Jan 15
    expect(utcToLocalDateTime('2026-01-16T02:00:00Z')).toEqual({
      date: '2026-01-15',
      time: '18:00',
    });
  });

  it('returns empty strings for null/undefined input', () => {
    expect(utcToLocalDateTime(null)).toEqual({ date: '', time: '' });
    expect(utcToLocalDateTime(undefined)).toEqual({ date: '', time: '' });
    expect(utcToLocalDateTime('')).toEqual({ date: '', time: '' });
  });

  it('returns empty strings for invalid input', () => {
    expect(utcToLocalDateTime('not-a-date')).toEqual({ date: '', time: '' });
  });
});

describe('localDateTimeToUtc / utcToLocalDateTime round-trip', () => {
  it.each([
    ['2026-01-15', '15:30'],
    ['2026-06-15', '15:30'],
    ['2026-01-15', '23:54'],
    ['2026-06-15', '00:00'],
    ['2026-11-02', '08:00'],
  ])('%s %s round-trips correctly', (date, time) => {
    expect(utcToLocalDateTime(localDateTimeToUtc(date, time))).toEqual({ date, time });
  });
});

describe('localDateToUtc / utcToLocalDate round-trip', () => {
  it.each(['2026-01-10', '2026-03-15', '2026-06-20', '2026-11-05', '2026-12-31'])(
    '%s round-trips correctly',
    (date) => {
      expect(utcToLocalDate(localDateToUtc(date))).toBe(date);
    },
  );
});

// ---------------------------------------------------------------------------
// DST transition edge cases (2026: spring Mar 8, fall Nov 1)
// ---------------------------------------------------------------------------

describe('DST transitions', () => {
  it('spring forward (Mar 8 2026): round-trips correctly', () => {
    const result = localDateToUtc('2026-03-08');
    // Exact UTC offset depends on Intl implementation at the transition boundary
    expect(utcToLocalDate(result)).toBe('2026-03-08');
  });

  it('day after spring forward (Mar 9 2026): PDT offset', () => {
    const result = localDateToUtc('2026-03-09');
    expect(result).toBe('2026-03-09T07:00:00.000+00:00');
    expect(utcToLocalDate(result)).toBe('2026-03-09');
  });

  it('fall back (Nov 1 2026): round-trips correctly', () => {
    const result = localDateToUtc('2026-11-01');
    // Exact UTC offset depends on Intl implementation at the transition boundary
    expect(utcToLocalDate(result)).toBe('2026-11-01');
  });

  it('day after fall back (Nov 2 2026): PST offset', () => {
    const result = localDateToUtc('2026-11-02');
    expect(result).toBe('2026-11-02T08:00:00.000+00:00');
    expect(utcToLocalDate(result)).toBe('2026-11-02');
  });
});

// ---------------------------------------------------------------------------
// startOfDayUtc / endOfDayUtc — Pacific day boundaries in UTC
// ---------------------------------------------------------------------------

describe('startOfDayUtc', () => {
  it('PST: delegates to localDateToUtc (midnight Pacific)', () => {
    expect(startOfDayUtc('2026-01-15')).toBe('2026-01-15T08:00:00.000+00:00');
  });

  it('PDT: delegates to localDateToUtc (midnight Pacific)', () => {
    expect(startOfDayUtc('2026-06-15')).toBe('2026-06-15T07:00:00.000+00:00');
  });
});

describe('endOfDayUtc', () => {
  it('PST: 23:59:59.999 Pacific = next day 07:59:59.999 UTC', () => {
    const result = endOfDayUtc('2026-01-15');
    const d = new Date(result);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(0); // Jan
    expect(d.getUTCDate()).toBe(16);
    expect(d.getUTCHours()).toBe(7);
    expect(d.getUTCMinutes()).toBe(59);
    expect(d.getUTCSeconds()).toBe(59);
    expect(d.getUTCMilliseconds()).toBe(999);
  });

  it('PDT: 23:59:59.999 Pacific = next day 06:59:59.999 UTC', () => {
    const result = endOfDayUtc('2026-06-15');
    const d = new Date(result);
    expect(d.getUTCDate()).toBe(16);
    expect(d.getUTCHours()).toBe(6);
    expect(d.getUTCMinutes()).toBe(59);
  });

  it('startOfDayUtc < endOfDayUtc for same date', () => {
    const start = new Date(startOfDayUtc('2026-03-15'));
    const end = new Date(endOfDayUtc('2026-03-15'));
    expect(start.getTime()).toBeLessThan(end.getTime());
  });
});

// ---------------------------------------------------------------------------
// Ban date calculations
// ---------------------------------------------------------------------------

describe('calculateLiftDate', () => {
  it('should add days to Pacific date and return UTC', () => {
    // Jan 15 PST midnight = 08:00 UTC; +30 days = Feb 14 PST midnight = 08:00 UTC
    const result = calculateLiftDate('2026-01-15T08:00:00.000+00:00', 30);
    expect(utcToLocalDate(result)).toBe('2026-02-14');
  });

  it('should handle PDT period', () => {
    // Jun 1 PDT midnight = 07:00 UTC; +7 days = Jun 8
    const result = calculateLiftDate('2026-06-01T07:00:00.000+00:00', 7);
    expect(utcToLocalDate(result)).toBe('2026-06-08');
  });

  it('should handle DST transition within duration', () => {
    // Mar 1 PST midnight = 08:00 UTC; +14 days = Mar 15 (now PDT)
    const result = calculateLiftDate('2026-03-01T08:00:00.000+00:00', 14);
    expect(utcToLocalDate(result)).toBe('2026-03-15');
    // After DST: Mar 15 PDT midnight = 07:00 UTC
    expect(result).toBe('2026-03-15T07:00:00.000+00:00');
  });

  it('should return empty string for invalid input', () => {
    expect(calculateLiftDate('not-a-date', 30)).toBe('');
    expect(calculateLiftDate('', 30)).toBe('');
  });
});

describe('calculateArchivesAt', () => {
  it('should add archive days to lift date', () => {
    // Feb 14 PST midnight + 30 days = Mar 16
    const result = calculateArchivesAt('2026-02-14T08:00:00.000+00:00');
    expect(utcToLocalDate(result)).toBe('2026-03-16');
  });

  it('should support custom archive days', () => {
    const result = calculateArchivesAt('2026-06-01T07:00:00.000+00:00', 60);
    expect(utcToLocalDate(result)).toBe('2026-07-31');
  });

  it('should return empty string for invalid input', () => {
    expect(calculateArchivesAt('invalid')).toBe('');
    expect(calculateArchivesAt('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// formatBanDate — Pacific date display from UTC timestamps
// ---------------------------------------------------------------------------

describe('formatBanDate', () => {
  it('should display Pacific date from UTC timestamp (PST)', () => {
    // 08:00 UTC = midnight Jan 15 PST
    expect(formatBanDate('2026-01-15T08:00:00.000Z')).toBe('Jan 15, 2026');
  });

  it('should display Pacific date from UTC timestamp (PDT)', () => {
    // 07:00 UTC = midnight Jun 15 PDT
    expect(formatBanDate('2026-06-15T07:00:00.000Z')).toBe('Jun 15, 2026');
  });

  it('UTC midnight displays as previous Pacific date', () => {
    // 00:00 UTC Jan 15 = 4pm Jan 14 PST
    expect(formatBanDate('2026-01-15T00:00:00+00:00')).toBe('Jan 14, 2026');
  });

  it('should support custom format', () => {
    expect(formatBanDate('2026-01-15T08:00:00.000Z', 'yyyy/MM/dd')).toBe('2026/01/15');
  });

  it('should return N/A for null/undefined/empty', () => {
    expect(formatBanDate(null)).toBe('N/A');
    expect(formatBanDate(undefined)).toBe('N/A');
    expect(formatBanDate('')).toBe('N/A');
  });

  it('should return Invalid date for unparseable input', () => {
    expect(formatBanDate('not-a-date')).toBe('Invalid date');
  });
});

// ---------------------------------------------------------------------------
// getToday / getDaysAgo / getDefaultDateRange (with mocked system time)
// ---------------------------------------------------------------------------

describe('getToday (mocked)', () => {
  afterEach(() => vi.useRealTimers());

  it('should return Pacific date even when UTC is the next day', () => {
    // 2026-03-14T03:00:00Z = Mar 13 at 8pm PDT
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T03:00:00Z'));
    expect(getToday()).toBe('2026-03-13');
  });

  it('should return Pacific date at UTC noon', () => {
    // 2026-03-14T20:00:00Z = Mar 14 at 1pm PDT
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T20:00:00Z'));
    expect(getToday()).toBe('2026-03-14');
  });
});

describe('getDaysAgo', () => {
  afterEach(() => vi.useRealTimers());

  it('should return YYYY-MM-DD format', () => {
    expect(getDaysAgo(7)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getDaysAgo(0) === getToday()', () => {
    expect(getDaysAgo(0)).toBe(getToday());
  });

  it('should subtract days from Pacific today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T03:00:00Z')); // Mar 13 PDT
    expect(getDaysAgo(7)).toBe('2026-03-06');
  });
});

describe('getDefaultDateRange', () => {
  it('should return from/to as YYYY-MM-DD', () => {
    const { from, to } = getDefaultDateRange();
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toBe(getToday());
  });

  it('should span 14 calendar days', () => {
    const { from, to } = getDefaultDateRange();
    const fromDate = parseISO(from);
    const toDate = parseISO(to);
    const diff = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
    expect(diff).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// getDefaultBanDates
// ---------------------------------------------------------------------------

describe('getDefaultBanDates', () => {
  it('should return YYYY-MM-DD strings', () => {
    const { startsAt, liftsAt, archivesAt } = getDefaultBanDates();
    expect(startsAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(liftsAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(archivesAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('startsAt should be Pacific today', () => {
    expect(getDefaultBanDates().startsAt).toBe(getToday());
  });

  it('should respect custom duration parameters', () => {
    const { startsAt, liftsAt, archivesAt } = getDefaultBanDates(7, 14);
    const start = parseISO(startsAt);
    const lift = parseISO(liftsAt);
    const archive = parseISO(archivesAt);

    const liftDiff = Math.round((lift.getTime() - start.getTime()) / 86400000);
    const archiveDiff = Math.round((archive.getTime() - lift.getTime()) / 86400000);
    expect(liftDiff).toBe(7);
    expect(archiveDiff).toBe(14);
  });

  it('uses an explicit start date when provided', () => {
    const { startsAt, liftsAt, archivesAt } = getDefaultBanDates(30, 30, '2026-05-10');
    expect(startsAt).toBe('2026-05-10');
    expect(liftsAt).toBe('2026-06-09');
    expect(archivesAt).toBe('2026-07-09');
  });

  it('falls back to today when start date is empty', () => {
    expect(getDefaultBanDates(undefined, undefined, '').startsAt).toBe(getToday());
    expect(getDefaultBanDates(undefined, undefined, undefined).startsAt).toBe(getToday());
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime (absolute instant comparison — timezone-independent)
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  afterEach(() => vi.useRealTimers());

  it('returns "just now" for < 1 minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:30Z'));
    expect(formatRelativeTime('2024-01-15T12:00:00Z')).toBe('just now');
  });

  it('returns "X min ago"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:30:00Z'));
    expect(formatRelativeTime('2024-01-15T12:25:00Z')).toBe('5 min ago');
  });

  it('returns "X hours ago"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T15:00:00Z'));
    expect(formatRelativeTime('2024-01-15T13:00:00Z')).toBe('2 hours ago');
  });

  it('returns "yesterday"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    expect(formatRelativeTime('2024-01-14T12:00:00Z')).toBe('yesterday');
  });

  it('returns formatted date for older', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    expect(formatRelativeTime('2024-01-13T12:00:00Z')).toBe('Jan 13');
  });
});

// ---------------------------------------------------------------------------
// getLibraryToday / getLibraryNowTime
// ---------------------------------------------------------------------------

describe('getLibraryToday / getLibraryNowTime', () => {
  afterEach(() => vi.useRealTimers());

  it('getLibraryToday returns YYYY-MM-DD', () => {
    expect(getLibraryToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getLibraryNowTime returns HH:MM', () => {
    expect(getLibraryNowTime()).toMatch(/^\d{2}:\d{2}$/);
  });

  it('getLibraryToday reflects Pacific calendar date', () => {
    vi.useFakeTimers();
    // 2026-01-15 05:00 UTC = Jan 14 at 9pm PST
    vi.setSystemTime(new Date('2026-01-15T05:00:00Z'));
    expect(getLibraryToday()).toBe('2026-01-14');
  });
});

// ---------------------------------------------------------------------------
// setLibraryTimezone — configurable timezone
// ---------------------------------------------------------------------------

describe('setLibraryTimezone', () => {
  afterEach(() => {
    // Restore to default for other tests
    setLibraryTimezone('America/Los_Angeles');
  });

  it('should change the timezone used by localDateToUtc', () => {
    // Eastern = UTC-5 (EST) or UTC-4 (EDT)
    setLibraryTimezone('America/New_York');
    // Jan 15 EST midnight = 05:00 UTC
    expect(localDateToUtc('2026-01-15')).toBe('2026-01-15T05:00:00.000+00:00');
  });

  it('should change the timezone used by utcToLocalDate', () => {
    setLibraryTimezone('America/New_York');
    // 05:00 UTC = midnight EST Jan 15
    expect(utcToLocalDate('2026-01-15T05:00:00.000Z')).toBe('2026-01-15');
    // 00:00 UTC = 7pm EST Jan 14
    expect(utcToLocalDate('2026-01-15T00:00:00+00:00')).toBe('2026-01-14');
  });
});
