import { parseISO, format, addDays, subDays, isValid } from 'date-fns';
import {
  DEFAULT_LIBRARY_TIMEZONE,
  DEFAULT_BAN_LIFT_DAYS,
  DEFAULT_TRESPASS_LIFT_DAYS,
  DEFAULT_BAN_ARCHIVE_DAYS,
} from '../../constants';

const DISPLAY_DATE_TIME_FORMAT = 'M/d/yyyy, h:mm a';
const DISPLAY_TIME_FORMAT = 'h:mm a';

export const PRESET_DAYS = [1, 7, 14, 30, 180, 365] as const;

const DURATION_LABELS: Record<number, string> = {
  1: '1 day',
  7: '1 week',
  14: '2 weeks',
  30: '1 month',
  180: '6 months',
  365: '1 year',
};

export const getDurationLabel = (days: number): string =>
  DURATION_LABELS[days] ?? `${days} days`;

let _libraryTz: string = DEFAULT_LIBRARY_TIMEZONE;

export function setLibraryTimezone(tz: string): void {
  _libraryTz = tz;
}

export function getLibraryTimezone(): string {
  return _libraryTz;
}

export function getLibraryToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: _libraryTz });
}

export function getLibraryNowTime(): string {
  return new Date()
    .toLocaleTimeString('en-GB', { timeZone: _libraryTz, hour12: false })
    .substring(0, 5);
}

function getLibraryOffsetMs(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: _libraryTz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => {
    const val = parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);
    return type === 'hour' && val === 24 ? 0 : val;
  };
  const libAsUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return libAsUtcMs - date.getTime();
}

/**
 * Convert a YYYY-MM-DD string (library-local date) to a UTC ISO timestamp
 * representing midnight in the library's timezone.
 *
 * Example: '2026-03-13' during PDT → '2026-03-13T07:00:00.000+00:00'
 * Example: '2026-01-15' during PST → '2026-01-15T08:00:00.000+00:00'
 */
export const localDateToUtc = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return `${dateStr}T00:00:00+00:00`;

  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const roughOffset = getLibraryOffsetMs(noon);
  const approxMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - roughOffset);
  const preciseOffset = getLibraryOffsetMs(approxMidnight);

  const midnightUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - preciseOffset);
  return midnightUtc.toISOString().replace(/\.\d{3}Z$/, '.000+00:00');
};

/**
 * Convert a YYYY-MM-DD and time (HH:MM) to a UTC ISO timestamp
 *
 * Example: ('2026-05-15', '15:30') under PDT → '2026-05-15T22:30:00.000Z'
 */
export const localDateTimeToUtc = (dateStr: string, timeStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  if (!y || !m || !d || isNaN(hh as number) || isNaN(mm as number)) {
    return `${dateStr}T${timeStr}:00+00:00`;
  }

  const rough = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const roughOffset = getLibraryOffsetMs(rough);
  const approx = new Date(Date.UTC(y, m - 1, d, hh, mm, 0) - roughOffset);
  const preciseOffset = getLibraryOffsetMs(approx);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0) - preciseOffset).toISOString();
};

/**
 * Extract the library-local date (YYYY-MM-DD) from a UTC ISO timestamp.
 * Uses Intl API with the configured library timezone.
 */
export const utcToLocalDate = (isoStr: string): string => {
  try {
    const date = new Date(isoStr);
    if (isNaN(date.getTime())) return isoStr.split('T')[0] || '';
    return date.toLocaleDateString('en-CA', { timeZone: _libraryTz });
  } catch {
    return isoStr.split('T')[0] || '';
  }
};

/**
 * Split a UTC ISO timestamp into library-local date (YYYY-MM-DD) and time (HH:MM)
 */
export const utcToLocalDateTime = (isoStr: string | null | undefined): { date: string; time: string } => {
  if (!isoStr) return { date: '', time: '' };
  try {
    const dt = new Date(isoStr);
    if (isNaN(dt.getTime())) return { date: '', time: '' };
    const date = dt.toLocaleDateString('en-CA', { timeZone: _libraryTz });
    const time = dt
      .toLocaleTimeString('en-GB', { timeZone: _libraryTz, hour12: false })
      .substring(0, 5);
    return { date, time };
  } catch {
    return { date: '', time: '' };
  }
};

export const formatLocalDate = (date: Date): string => {
  return format(date, 'yyyy-MM-dd');
};

export const getDefaultBanDates = (
  daysUntilLift: number = DEFAULT_BAN_LIFT_DAYS,
  daysUntilArchive: number = DEFAULT_BAN_ARCHIVE_DAYS,
  startDateYmd?: string,
): { startsAt: string; liftsAt: string; archivesAt: string } => {
  const startsAt = startDateYmd || getLibraryToday();
  const startDate = parseISO(startsAt);
  const liftsAt = addDays(startDate, daysUntilLift);
  const archivesAt = addDays(liftsAt, daysUntilArchive);
  return {
    startsAt,
    liftsAt: formatLocalDate(liftsAt),
    archivesAt: formatLocalDate(archivesAt),
  };
};

/**
 * Parse a date/timestamp string to a Date object.
 * Handles ISO 8601 timestamps and legacy YYYY-MM-DD strings.
 */
export const parseTimestamp = (dateString: string): Date => {
  if (dateString.includes('T')) {
    return parseISO(dateString);
  }
  return parseISO(dateString + 'T00:00:00');
};

/** Format a date/timestamp string for display. Returns 'N/A' if null/invalid. */
export const formatTimestamp = (
  dateString: string | null | undefined,
  formatStr: string = 'MMM dd, yyyy'
): string => {
  if (!dateString) return 'N/A';
  try {
    return format(parseTimestamp(dateString), formatStr);
  } catch {
    return 'Invalid date';
  }
};

/** Format a UTC ISO string as "5/19/2026, 6:24 PM". */
export const formatDisplayDateTime = (isoStr: string | null | undefined): string =>
  formatTimestamp(isoStr, DISPLAY_DATE_TIME_FORMAT);

/** Format a UTC ISO string as "6:24 PM". */
export const formatDisplayTime = (isoStr: string | null | undefined): string =>
  formatTimestamp(isoStr, DISPLAY_TIME_FORMAT);

/** Parse YYYY-MM-DD to start of day (00:00:00.000) — for local UI logic only. */
export const startOfDayLocal = (dateStr: string): Date => {
  return parseISO(dateStr + 'T00:00:00');
};

/** Parse YYYY-MM-DD to end of day (23:59:59.999) — for local UI logic only. */
export const endOfDayLocal = (dateStr: string): Date => {
  const d = parseISO(dateStr + 'T23:59:59');
  d.setMilliseconds(999);
  return d;
};

/**
 * Convert YYYY-MM-DD (library-local date) to start of day as UTC ISO string.
 * Use for API "occurred_after" filters.
 */
export const startOfDayUtc = (dateStr: string): string => {
  return localDateToUtc(dateStr);
};

/**
 * Convert YYYY-MM-DD (library-local date) to end of day (23:59:59.999) as UTC ISO string.
 * Use for API "occurred_before" filters.
 */
export const endOfDayUtc = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return `${dateStr}T23:59:59.999+00:00`;

  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const roughOffset = getLibraryOffsetMs(noon);
  const approxEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59) - roughOffset);
  const preciseOffset = getLibraryOffsetMs(approxEnd);

  // 23:59:59.999 library-local in UTC
  const endOfDayMs = Date.UTC(y, m - 1, d, 23, 59, 59, 999) - preciseOffset;
  return new Date(endOfDayMs).toISOString();
};

/** Check if a date/timestamp is in the past. */
export const isTimestampPast = (dateString: string): boolean => {
  return parseTimestamp(dateString) < new Date();
};

/** Get today's date as YYYY-MM-DD string in the library's timezone. */
export const getToday = (): string => getLibraryToday();

/** Get date N days ago as YYYY-MM-DD string in the library's timezone. */
export const getDaysAgo = (days: number): string => {
  const today = parseISO(getLibraryToday());
  return formatLocalDate(subDays(today, days));
};

/** Get default date range for incident filters (last 14 days). */
export const getDefaultDateRange = (): { from: string; to: string } => ({
  from: getDaysAgo(14),
  to: getToday(),
});

/**
 * Format a date string as relative time.
 *
 * Examples: "just now", "5 min ago", "2 hours ago", "yesterday", "Dec 15"
 */
export const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export function calculateLiftDate(startsAt: string, durationDays: number): string {
  const pacificDate = utcToLocalDate(startsAt);
  const start = parseISO(pacificDate);
  if (!isValid(start)) return '';
  const liftDate = addDays(start, durationDays);
  return localDateToUtc(formatLocalDate(liftDate));
}

export function calculateArchivesAt(liftsAt: string, archiveDays = DEFAULT_BAN_ARCHIVE_DAYS): string {
  const pacificDate = utcToLocalDate(liftsAt);
  const lift = parseISO(pacificDate);
  if (!isValid(lift)) return '';
  const archiveDate = addDays(lift, archiveDays);
  return localDateToUtc(formatLocalDate(archiveDate));
}

export function getDefaultDuration(isTrespass: boolean): number {
  return isTrespass ? DEFAULT_TRESPASS_LIFT_DAYS : DEFAULT_BAN_LIFT_DAYS;
}

/**
 * Format a UTC timestamp for ban date display in the library's timezone.
 * Converts UTC to library-local date, then delegates to formatTimestamp.
 */
export function formatBanDate(
  dateString: string | null | undefined,
  formatStr: string = 'MMM dd, yyyy',
): string {
  if (!dateString) return 'N/A';
  const pacificDate = utcToLocalDate(dateString);
  return formatTimestamp(pacificDate, formatStr);
}
