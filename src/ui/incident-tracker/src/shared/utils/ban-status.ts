import { differenceInCalendarDays, parseISO } from 'date-fns';
import { isTimestampPast, utcToLocalDate, getLibraryToday } from './date-utils';

export type BanStatusColor = 'error' | 'warning' | 'success' | 'default';

export interface BanStatusInfo {
  label: string;
  color: BanStatusColor;
}

interface BanStatusInput {
  is_trespass?: boolean;
  starts_at?: string | null;
  lifts_at?: string | null;
  archived_by?: string | null;
}

/**
 * Derive display status for a ban/trespass.
 * Used by patron-ban-detail, patron-ban-summary-card, and incident-detail.
 */
export function getBanStatus(ban: BanStatusInput): BanStatusInfo {
  if (ban.archived_by) {
    return { label: 'Archived', color: 'default' };
  }

  const isLifted = ban.lifts_at && isTimestampPast(ban.lifts_at);

  if (isLifted) {
    return ban.is_trespass
      ? { label: 'Waiting for archive', color: 'warning' }
      : { label: 'Lifted', color: 'success' };
  }

  // Ban with a future start date is scheduled, not yet active
  if (ban.starts_at && !isTimestampPast(ban.starts_at)) {
    const startsLocal = parseISO(utcToLocalDate(ban.starts_at));
    const todayLocal = parseISO(getLibraryToday());
    const daysUntilStart = differenceInCalendarDays(startsLocal, todayLocal);
    return {
      label: `Scheduled (starts in ${daysUntilStart}d)`,
      color: 'warning',
    };
  }

  if (ban.lifts_at) {
    const liftsLocal = parseISO(utcToLocalDate(ban.lifts_at));
    const todayLocal = parseISO(getLibraryToday());
    const daysRemaining = differenceInCalendarDays(liftsLocal, todayLocal);
    return {
      label: `Active (${daysRemaining}d remaining)`,
      color: 'error',
    };
  }

  return { label: 'Active', color: 'error' };
}
