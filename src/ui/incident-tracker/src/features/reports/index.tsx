import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Grid,
  Link,
  List,
  ListItem,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { format, parseISO, subDays, subMonths } from 'date-fns';
import { PageContainer } from '../../shared/components/layout';
import LocationSelector from '../../shared/components/location-selector';
import { useLocations } from '../../contexts/location-context';
import { getRegionOrgUnit } from '../../shared/utils/location-utils';
import { authApi as coreAuthApi } from '@core';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  reportsApi,
  type LabelCountRow,
  type OccurrenceHeatmap,
  type PatronCountRow,
  type ReportBucket,
  type ReportSummary,
  type ResolutionTimeRow,
  type StatusFilter,
} from '../../api/reports';
import { parseApiError } from '../../api/client';

/**
 * Reports dashboard: a grid of charts, each populated by its own
 * /api/v1/current/reports/* call. The location and time-range selectors at
 * the top apply to every chart; selecting an org unit includes all of its
 * descendant units (expanded server-side).
 */

type RangeKey = '30d' | '90d' | '12m' | 'all';

const RANGES: Record<RangeKey, { label: string; bucket: ReportBucket; start: () => string | undefined }> = {
  '30d': { label: '30 days', bucket: 'day', start: () => subDays(new Date(), 30).toISOString() },
  '90d': { label: '90 days', bucket: 'week', start: () => subDays(new Date(), 90).toISOString() },
  '12m': { label: '12 months', bucket: 'month', start: () => subMonths(new Date(), 12).toISOString() },
  all: { label: 'All time', bucket: 'month', start: () => undefined },
};

/** Validated 2-slot categorical palette (dataviz reference palette, checked
 * against this app's light/dark paper surfaces). Slot 1 doubles as the
 * single hue for the magnitude bar charts. */
const useSeriesColors = () => {
  const mode = useTheme().palette.mode;
  return mode === 'light'
    ? { series1: '#2a78d6', series2: '#eb6834' }
    : { series1: '#3987e5', series2: '#d95926' };
};

interface ReportState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Fetch one report, refetching whenever the shared filters change. While
 * `enabled` is false (filters still resolving) the report stays in its
 * loading state without firing a request. */
function useReport<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
  enabled = true,
): ReportState<T> {
  const [state, setState] = useState<ReportState<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher().then(
      (data) => !cancelled && setState({ data, loading: false, error: null }),
      (err) => {
        if (cancelled) return;
        const info = parseApiError(err);
        const error =
          info.code === 'PERMISSION_DENIED'
            ? "You don't have permission to view this report."
            : info.message;
        setState({ data: null, loading: false, error });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return state;
}

const CHART_HEIGHT = 300;

const ChartCard: React.FC<{
  title: string;
  subtitle?: string;
  state: ReportState<unknown>;
  empty: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, state, empty, children }) => (
  <Paper variant="outlined" sx={{ p: 2, height: '100%', borderRadius: 3 }}>
    <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
      {title}
    </Typography>
    {subtitle && (
      <Typography variant="caption" color="text.secondary" component="div">
        {subtitle}
      </Typography>
    )}
    <Box
      sx={{
        height: CHART_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        mt: 3,
      }}
    >
      {state.loading ? (
        <CircularProgress size={32} aria-label={`Loading ${title}`} />
      ) : state.error ? (
        <Alert severity="error" sx={{ width: '100%' }}>
          {state.error}
        </Alert>
      ) : empty ? (
        <Typography variant="body2" color="text.secondary">
          No data for this selection
        </Typography>
      ) : (
        <Box
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Box sx={{ width: '100%' }}>{children}</Box>
        </Box>
      )}
    </Box>
  </Paper>
);

/** One headline number for the KPI row. */
const StatTile: React.FC<{
  label: string;
  hint: string;
  state: ReportState<ReportSummary>;
  value: (s: ReportSummary) => string;
}> = ({ label, hint, state, value }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, height: '100%' }}>
    <Typography variant="overline" color="text.secondary" component="div" sx={{ lineHeight: 1.5 }}>
      {label}
    </Typography>
    <Typography variant="h4" component="div" sx={{ my: 0.5 }}>
      {state.loading ? '\u2026' : state.error || !state.data ? '\u2014' : value(state.data)}
    </Typography>
    <Typography variant="caption" color="text.secondary">
      {hint}
    </Typography>
  </Paper>
);

/** Thin x-axis tick labels so long day/week series stay readable. */
const tickThinner = (count: number) => {
  const every = Math.max(1, Math.ceil(count / 8));
  return (_value: unknown, index: number) => index % every === 0;
};

const formatBucket = (bucket: ReportBucket, iso: string) =>
  format(parseISO(iso), bucket === 'month' ? 'MMM yyyy' : 'MMM d');

/** Draw point markers on short series — a 1-2 bucket "line" is invisible
 * without them — but drop them once the line alone reads clearly. */
const showMarks = (count: number) => count <= 31;

/** Fold rows past the first `max` into a single "Other" row (bar charts
 * stay legible; the full breakdown belongs in a future table view). */
function foldTail(rows: LabelCountRow[], max = 9): LabelCountRow[] {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max);
  const other = rows.slice(max).reduce((sum, r) => sum + r.count, 0);
  return [...head, { label: 'Other', count: other }];
}

const REVIEW_STATUS_LABELS: Record<string, string> = {
  unsubmitted: 'Not yet submitted',
  submitted: 'Awaiting review',
  approved: 'Approved — in review',
  'approved-with-edits': 'Approved with edits',
  returned: 'Returned to creator',
  reopened: 'Reopened',
};

/** Horizontal single-hue bar chart for "count per label" reports. The chart
 * height tracks the row count (capped at the card height) so a one-row
 * result renders a thin bar instead of a card-filling slab. */
const CountBars: React.FC<{ rows: LabelCountRow[]; color: string }> = ({ rows, color }) => (
  <BarChart
    layout="horizontal"
    height={Math.min(CHART_HEIGHT, 68 + rows.length * 40)}
    margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
    yAxis={[{ scaleType: 'band', data: rows.map((r) => r.label), width: 150 }]}
    xAxis={[{ tickMinStep: 1 }]}
    series={[{ data: rows.map((r) => r.count), color }]}
    hideLegend
    borderRadius={4}
  />
);

const HEATMAP_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatHour = (h: number) => {
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${h < 12 ? 'a' : 'p'}`;
};

/** Day-of-week x hour-of-day heatmap. A hand-rolled CSS grid (the x-charts
 * heatmap is pro-only): sequential single-hue cells, intensity scaled to
 * the busiest cell, with a tooltip per non-empty cell. */
const OccurrenceHeatmapGrid: React.FC<{ data: OccurrenceHeatmap; color: string }> = ({
  data,
  color,
}) => {
  const grid = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const cell of data.cells) {
      // Bounds-checked so a malformed cell can't crash the page.
      if (cell.day >= 0 && cell.day < 7 && cell.hour >= 0 && cell.hour < 24) {
        g[cell.day]![cell.hour] = cell.count;
      }
    }
    return g;
  }, [data]);
  const max = Math.max(1, ...data.cells.map((c) => c.count));

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '36px repeat(24, 1fr)',
        gap: '2px',
        alignItems: 'center',
        width: '100%',
      }}
    >
      {grid.map((hours, day) => (
        <React.Fragment key={day}>
          <Typography variant="caption" color="text.secondary" sx={{ pr: 0.5, textAlign: 'right' }}>
            {HEATMAP_DAYS[day]}
          </Typography>
          {hours.map((count, hour) => {
            const cell = (
              <Box
                key={hour}
                role="img"
                aria-label={`${HEATMAP_DAYS[day]} ${formatHour(hour)}: ${count} incident${count === 1 ? '' : 's'}`}
                sx={{
                  aspectRatio: '1 / 1',
                  minWidth: 0,
                  borderRadius: '4px',
                  bgcolor: count === 0 ? 'action.hover' : color,
                  opacity: count === 0 ? 1 : 0.25 + 0.75 * (count / max),
                }}
              />
            );
            return count === 0 ? (
              cell
            ) : (
              <Tooltip
                key={hour}
                title={`${HEATMAP_DAYS[day]} ${formatHour(hour)} \u2014 ${count} incident${count === 1 ? '' : 's'}`}
              >
                {cell}
              </Tooltip>
            );
          })}
        </React.Fragment>
      ))}
      <Box />
      {Array.from({ length: 24 }, (_, hour) => (
        <Typography
          key={hour}
          variant="caption"
          color="text.secondary"
          sx={{ textAlign: 'center', minWidth: 0 }}
        >
          {hour % 3 === 0 ? formatHour(hour) : ''}
        </Typography>
      ))}
    </Box>
  );
};

/** Ranked list of the patrons involved in the most incidents, each linking
 * to the patron's detail page. */
const TopPatronsList: React.FC<{ rows: PatronCountRow[] }> = ({ rows }) => (
  <List dense disablePadding sx={{ width: '100%' }}>
    {rows.map((row, i) => (
      <ListItem
        key={row.patron}
        disableGutters
        divider={i < rows.length - 1}
        secondaryAction={
          <Chip
            size="small"
            label={`${row.count} incident${row.count === 1 ? '' : 's'}`}
            variant="outlined"
          />
        }
      >
        <Typography variant="body2" color="text.secondary" sx={{ width: 24 }}>
          {i + 1}.
        </Typography>
        <Link
          component={RouterLink}
          to={`/patrons/${row.patron}`}
          variant="body2"
          underline="hover"
        >
          {row.label}
        </Link>
      </ListItem>
    ))}
  </List>
);

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All incidents' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

const STATUS_NOUN: Record<StatusFilter, string> = {
  all: 'Incidents',
  open: 'Open incidents',
  closed: 'Closed incidents',
};

const isRangeKey = (v: string | null): v is RangeKey => v !== null && v in RANGES;
const isStatusFilter = (v: string | null): v is StatusFilter =>
  v === 'all' || v === 'open' || v === 'closed';

const ReportsDashboard: React.FC = () => {
  // The URL is the source of truth for all three filters, so report views
  // survive refresh and can be shared. `loc` is an org-unit code, 'all',
  // or absent (= not yet defaulted).
  const [searchParams, setSearchParams] = useSearchParams();
  const { locations } = useLocations();
  const colors = useSeriesColors();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const rangeParam = searchParams.get('range');
  const rangeKey: RangeKey = isRangeKey(rangeParam) ? rangeParam : '90d';
  const statusParam = searchParams.get('status');
  const status: StatusFilter = isStatusFilter(statusParam) ? statusParam : 'all';
  const locParam = searchParams.get('loc');

  // First visit (no loc in the URL): default to the user's region, like the
  // incident list does, so branch-scoped users don't open on an
  // all-locations view their permissions may not cover.
  useEffect(() => {
    if (locParam !== null || locations.length === 0) return;
    const userOrgUnit = coreAuthApi.getSessionData()?.org_unit;
    const region = userOrgUnit ? getRegionOrgUnit(userOrgUnit, locations) : null;
    const code = region ? locations.find((l) => l.uuid === region)?.code : null;
    setParam('loc', code || 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locParam, locations]);

  const locationCode = locParam && locParam !== 'all' ? locParam : null;
  const orgUnit = useMemo(() => {
    if (!locationCode) return null;
    return locations.find((l) => l.code === locationCode)?.uuid ?? null;
  }, [locations, locationCode]);
  // Hold the charts in their loading state until the location filter is
  // fully resolved (default applied, code mapped to a uuid).
  const ready = locParam !== null && (locationCode === null || orgUnit !== null);

  const { bucket } = RANGES[rangeKey];
  const filter = useMemo(
    () => ({
      org_unit: orgUnit ?? undefined,
      start: RANGES[rangeKey].start(),
      status,
    }),
    [orgUnit, rangeKey, status],
  );
  // One dependency key shared by every chart's fetch.
  const deps = [filter.org_unit, filter.start, filter.status];

  const overTime = useReport(() => reportsApi.incidentsOverTime({ ...filter, bucket }), deps, ready);
  const byTemplate = useReport(() => reportsApi.incidentsByTemplate(filter), deps, ready);
  const byCategory = useReport(() => reportsApi.incidentsByCategory(filter), deps, ready);
  const byStatus = useReport(() => reportsApi.openByReviewStatus(filter), deps, ready);
  const byLocation = useReport(() => reportsApi.incidentsByLocation(filter), deps, ready);
  const bans = useReport(() => reportsApi.bansOverTime({ ...filter, bucket }), deps, ready);
  const topPatrons = useReport(() => reportsApi.topPatrons(filter), deps, ready);
  const heatmap = useReport(() => reportsApi.occurrenceHeatmap(filter), deps, ready);
  const resolutionTime = useReport(
    () => reportsApi.resolutionTime({ org_unit: filter.org_unit, start: filter.start, bucket }),
    [filter.org_unit, filter.start],
    ready,
  );
  // The KPI row breaks counts down by status itself, so it only refetches
  // on location/range changes.
  const summary = useReport(
    () => reportsApi.summary({ org_unit: filter.org_unit, start: filter.start }),
    [filter.org_unit, filter.start],
    ready,
  );

  const statusRows = useMemo(
    () =>
      (byStatus.data?.rows ?? []).map((r) => ({
        ...r,
        label: REVIEW_STATUS_LABELS[r.label] ?? r.label,
      })),
    [byStatus.data],
  );

  const rangeText = rangeKey === 'all' ? 'all time' : `occurred in the last ${RANGES[rangeKey].label.toLowerCase()}`;
  // Subtitle for the charts that honor the status toggle.
  const statusSubtitle = `${STATUS_NOUN[status]} — ${rangeText}`;

  return (
    <PageContainer>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 2,
          mb: 3,
        }}
      >
        <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
          Reports
        </Typography>
        <LocationSelector
          value={locationCode}
          onChange={(code) => setParam('loc', code || 'all')}
          label="Location"
          placeholder="All locations"
          autoSetDefault={false}
          disableClearable={false}
          sx={{ minWidth: 260 }}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={status}
          onChange={(_e, v: StatusFilter | null) => v && setParam('status', v)}
          aria-label="Incident status"
        >
          {STATUS_OPTIONS.map((opt) => (
            <ToggleButton key={opt.value} value={opt.value}>
              {opt.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={rangeKey}
          onChange={(_e, v: RangeKey | null) => v && setParam('range', v)}
          aria-label="Time range"
        >
          {(Object.keys(RANGES) as RangeKey[]).map((key) => (
            <ToggleButton key={key} value={key}>
              {RANGES[key].label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Incidents"
            hint={rangeText === 'all time' ? 'All time' : rangeText.charAt(0).toUpperCase() + rangeText.slice(1)}
            state={summary}
            value={(s) => s.total_incidents.toLocaleString()}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Open now"
            hint="Of those, not yet resolved"
            state={summary}
            value={(s) => s.open_incidents.toLocaleString()}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Resolved"
            hint="Resolved during the period"
            state={summary}
            value={(s) => s.resolved_incidents.toLocaleString()}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Median days to resolve"
            hint="Across incidents resolved in the period"
            state={summary}
            value={(s) =>
              s.median_days_to_resolve === null ? '\u2014' : s.median_days_to_resolve.toFixed(1)
            }
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard
            title="Incident reports over time"
            subtitle={`Opened vs. resolved per ${bucket}`}
            state={overTime}
            empty={!overTime.data?.rows.length}
          >
            <LineChart
              height={CHART_HEIGHT}
              xAxis={[
                {
                  scaleType: 'point',
                  data: overTime.data?.rows.map((r) => r.bucket) ?? [],
                  valueFormatter: (v: string) => formatBucket(bucket, v),
                  tickLabelInterval: tickThinner(overTime.data?.rows.length ?? 0),
                },
              ]}
              yAxis={[{ tickMinStep: 1 }]}
              series={[
                {
                  data: overTime.data?.rows.map((r) => r.opened) ?? [],
                  label: 'Opened',
                  color: colors.series1,
                  showMark: showMarks(overTime.data?.rows.length ?? 0),
                  curve: 'linear',
                },
                {
                  data: overTime.data?.rows.map((r) => r.resolved) ?? [],
                  label: 'Resolved',
                  color: colors.series2,
                  showMark: showMarks(overTime.data?.rows.length ?? 0),
                  curve: 'linear',
                },
              ]}
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard
            title="Open incidents by review status"
            subtitle="Open incidents only — not affected by the status filter"
            state={byStatus}
            empty={!statusRows.length}
          >
            <CountBars rows={statusRows} color={colors.series1} />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard
            title="Incidents by template"
            subtitle={statusSubtitle}
            state={byTemplate}
            empty={!byTemplate.data?.rows.length}
          >
            <CountBars rows={foldTail(byTemplate.data?.rows ?? [])} color={colors.series1} />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard
            title="Incidents by category"
            subtitle={statusSubtitle}
            state={byCategory}
            empty={!byCategory.data?.rows.length}
          >
            <CountBars rows={foldTail(byCategory.data?.rows ?? [])} color={colors.series1} />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard
            title="Incidents by location"
            subtitle={statusSubtitle}
            state={byLocation}
            empty={!byLocation.data?.rows.length}
          >
            <CountBars
              rows={foldTail((byLocation.data?.rows ?? []).map((r) => ({ label: r.label, count: r.count })))}
              color={colors.series1}
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard
            title="Bans issued over time"
            subtitle={`Bans vs. trespasses per ${bucket}`}
            state={bans}
            empty={!bans.data?.rows.length}
          >
            <LineChart
              height={CHART_HEIGHT}
              xAxis={[
                {
                  scaleType: 'point',
                  data: bans.data?.rows.map((r) => r.bucket) ?? [],
                  valueFormatter: (v: string) => formatBucket(bucket, v),
                  tickLabelInterval: tickThinner(bans.data?.rows.length ?? 0),
                },
              ]}
              yAxis={[{ tickMinStep: 1 }]}
              series={[
                {
                  data: bans.data?.rows.map((r) => r.bans) ?? [],
                  label: 'Bans',
                  color: colors.series1,
                  showMark: showMarks(bans.data?.rows.length ?? 0),
                  curve: 'linear',
                },
                {
                  data: bans.data?.rows.map((r) => r.trespasses) ?? [],
                  label: 'Trespasses',
                  color: colors.series2,
                  showMark: showMarks(bans.data?.rows.length ?? 0),
                  curve: 'linear',
                },
              ]}
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard
            title="Time to resolution"
            subtitle={`Median days from occurrence to resolution, per ${bucket} resolved`}
            state={resolutionTime}
            empty={!resolutionTime.data?.rows.some((r) => r.median_days !== null)}
          >
            <LineChart
              height={CHART_HEIGHT}
              xAxis={[
                {
                  scaleType: 'point',
                  data: resolutionTime.data?.rows.map((r) => r.bucket) ?? [],
                  valueFormatter: (v: string) => formatBucket(bucket, v),
                  tickLabelInterval: tickThinner(resolutionTime.data?.rows.length ?? 0),
                },
              ]}
              yAxis={[{ min: 0 }]}
              series={[
                {
                  data: resolutionTime.data?.rows.map((r) => r.median_days) ?? [],
                  label: 'Median days',
                  color: colors.series1,
                  showMark: showMarks(resolutionTime.data?.rows.length ?? 0),
                  curve: 'linear',
                  valueFormatter: (v: number | null, { dataIndex }: { dataIndex: number }) => {
                    if (v === null) return 'No resolutions';
                    const n = resolutionTime.data?.rows[dataIndex]?.resolved ?? 0;
                    return `${v.toFixed(1)} days (${n} resolved)`;
                  },
                },
              ]}
              hideLegend
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard
            title="Top patrons"
            subtitle={`Most involved — ${statusSubtitle.toLowerCase()}`}
            state={topPatrons}
            empty={!topPatrons.data?.rows.length}
          >
            <TopPatronsList rows={topPatrons.data?.rows ?? []} />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <ChartCard
            title="When incidents occur"
            subtitle={`${statusSubtitle} \u00b7 by day and hour, ${heatmap.data?.timezone ?? 'local'} time`}
            state={heatmap}
            empty={!heatmap.data?.cells.length}
          >
            {heatmap.data && <OccurrenceHeatmapGrid data={heatmap.data} color={colors.series1} />}
          </ChartCard>
        </Grid>
      </Grid>
    </PageContainer>
  );
};

export default ReportsDashboard;
