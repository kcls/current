/**
 * Reports API — dashboard aggregates served by the current service's
 * /api/v1/current/reports/* endpoints (src/rust/current/src/reports.rs).
 *
 * Shared filter semantics: `org_unit` scopes to that unit AND all of its
 * descendants (expanded server-side via odo-org); `start` is an ISO instant
 * lower bound, omitted = all time.
 */

import { currentPost } from './client';

export type ReportBucket = 'day' | 'week' | 'month';
export type StatusFilter = 'all' | 'open' | 'closed';

export interface ReportFilter {
  org_unit?: string;
  start?: string;
  /** Open/closed incident filter; omitted = all. The over-time series and
   * the review-status report ignore it (see reports.rs). */
  status?: StatusFilter;
}

export interface TimeSeriesRequest extends ReportFilter {
  bucket: ReportBucket;
}

export interface IncidentsOverTimeRow {
  /** Bucket start date (YYYY-MM-DD). */
  bucket: string;
  opened: number;
  resolved: number;
}

export interface LabelCountRow {
  label: string;
  count: number;
}

export interface LocationCountRow {
  org_unit: string;
  label: string;
  count: number;
}

export interface BansOverTimeRow {
  /** Bucket start date (YYYY-MM-DD). */
  bucket: string;
  bans: number;
  trespasses: number;
}

export interface ResolutionTimeRow {
  /** Bucket start date (YYYY-MM-DD), bucketed by resolved_at. */
  bucket: string;
  resolved: number;
  /** Median days occurred->resolved; null for buckets with no resolutions. */
  median_days: number | null;
}

export interface HeatmapCell {
  /** Day of week, 0 = Sunday .. 6 = Saturday, in the report timezone. */
  day: number;
  /** Hour of day, 0-23, in the report timezone. */
  hour: number;
  count: number;
}

export interface OccurrenceHeatmap {
  /** IANA timezone the day/hour cells were computed in. */
  timezone: string;
  /** Sparse: only cells with a non-zero count. */
  cells: HeatmapCell[];
}

export interface ReportSummary {
  total_incidents: number;
  open_incidents: number;
  resolved_incidents: number;
  /** Median days from occurred to resolved for the period; null when
   * nothing was resolved. */
  median_days_to_resolve: number | null;
}

export interface PatronCountRow {
  patron: number;
  label: string;
  count: number;
}

export const reportsApi = {
  incidentsOverTime(req: TimeSeriesRequest): Promise<{ rows: IncidentsOverTimeRow[] }> {
    return currentPost('/reports/incidents-over-time', req);
  },

  incidentsByTemplate(req: ReportFilter): Promise<{ rows: LabelCountRow[] }> {
    return currentPost('/reports/by-template', req);
  },

  incidentsByCategory(req: ReportFilter): Promise<{ rows: LabelCountRow[] }> {
    return currentPost('/reports/by-category', req);
  },

  openByReviewStatus(req: ReportFilter): Promise<{ rows: LabelCountRow[] }> {
    return currentPost('/reports/open-by-review-status', req);
  },

  incidentsByLocation(req: ReportFilter): Promise<{ rows: LocationCountRow[] }> {
    return currentPost('/reports/incidents-by-location', req);
  },

  bansOverTime(req: TimeSeriesRequest): Promise<{ rows: BansOverTimeRow[] }> {
    return currentPost('/reports/bans-over-time', req);
  },

  topPatrons(req: ReportFilter): Promise<{ rows: PatronCountRow[] }> {
    return currentPost('/reports/top-patrons', req);
  },

  summary(req: Omit<ReportFilter, 'status'>): Promise<ReportSummary> {
    return currentPost('/reports/summary', req);
  },

  resolutionTime(req: TimeSeriesRequest): Promise<{ rows: ResolutionTimeRow[] }> {
    return currentPost('/reports/resolution-time', req);
  },

  occurrenceHeatmap(req: ReportFilter): Promise<OccurrenceHeatmap> {
    return currentPost('/reports/occurrence-heatmap', req);
  },
};
