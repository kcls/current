import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useToast } from '../../../contexts/toast-context';
import { useLocations } from '../../../contexts/location-context';
import { useTableUrlState, useFilterUrlState } from '../../../shared/hooks/use-table-url-state';
import { useSortUrlState } from '../../../shared/hooks/use-sort-state';
import { useDebouncedSearch } from '../../../shared/hooks/use-debounced-search';
import { getRegionOrgUnit } from '../../../shared/utils/location-utils';
import { authApi } from '../../../api';
import { shiftNotesApi } from '../../../api/shift-notes';
import type { ShiftNote, ShiftNoteConductArea, ShiftNoteType } from '../../../types';

/** How often to check for notes filed by other staff. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Newest `created_at` among the given rows, or null when there are none.
 *
 * Deliberately a max rather than `rows[0]`: the first row is only the
 * newest under the default date-descending sort. Sorted ascending — or by
 * type, staff, or library — rows[0] can be the oldest entry on the page,
 * and using it as the poll's `since` makes the poll count entries already
 * on screen as new, on every tick.
 */
export const newestCreatedAt = (rows: { created_at: string }[]): string | null =>
  rows.reduce<string | null>(
    (newest, row) => (newest === null || row.created_at > newest ? row.created_at : newest),
    null,
  );

/**
 * Drives the shift-note list.
 *
 * Two loops share one fetch:
 *   * the **visible** load — filters/paging changed, so replace the page and
 *     show a spinner;
 *   * the **poll** — every 30s, ask only whether anything newer exists. It
 *     never disturbs the rendered page; it just raises a "N new notes"
 *     count the user can click to refresh. Silently replacing rows under
 *     someone mid-read is worse than making them ask for it.
 */
export const useShiftNotes = () => {
  const { showError } = useToast();
  const { locations } = useLocations();

  const { page, rowsPerPage, setPage, setRowsPerPage } = useTableUrlState({
    defaultRowsPerPage: 25,
  });

  const filterConfig = useMemo(() => ({
    scope: { type: 'string' as const, defaultValue: '' },
    // The selector is driven by code, the query by uuid. Both live in the
    // URL so a filtered view reloads and shares correctly.
    scopeCode: { type: 'string' as const, defaultValue: '', urlKey: 'loc' },
    type: { type: 'number' as const, defaultValue: 0 },
    search: { type: 'string' as const, defaultValue: '', urlKey: 'q' },
    archived: { type: 'boolean' as const, defaultValue: false },
  }), []);
  const { filters, setFilter, setFilters } = useFilterUrlState(filterConfig);
  const { sort, toggleSort } = useSortUrlState();

  // Typing hits the URL (and the server) only after a pause, and only
  // once there is enough of a term to be worth a query.
  const {
    searchInput,
    setSearchInput,
    clearSearch,
  } = useDebouncedSearch({
    initialValue: filters.search,
    onDebouncedChange: value => setFilter('search', value),
  });

  // Default scope is the user's region; the picker can widen or narrow it.
  const defaultScope = useMemo(() => {
    const orgUnit = authApi.getOrgUnit();
    if (!orgUnit || locations.length === 0) return null;
    return getRegionOrgUnit(orgUnit, locations);
  }, [locations]);

  const scopeId = filters.scope || defaultScope;

  // Code for whatever scope is in effect — the explicit choice if there is
  // one, otherwise the default region, so the picker is never blank while
  // the list is in fact scoped.
  const scopeCode = useMemo(() => {
    if (filters.scopeCode) return filters.scopeCode;
    if (!scopeId || locations.length === 0) return null;
    return locations.find(l => l.uuid === scopeId)?.code ?? null;
  }, [filters.scopeCode, scopeId, locations]);

  const [notes, setNotes] = useState<ShiftNote[]>([]);
  const [types, setTypes] = useState<ShiftNoteType[]>([]);
  const [conductAreas, setConductAreas] = useState<ShiftNoteConductArea[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [archivedIncluded, setArchivedIncluded] = useState(false);
  // Scope-dependent: a coordinator may hold read_archived at one region
  // and not another, so this comes back with every list.
  const [canReadArchived, setCanReadArchived] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);

  // Newest created_at currently rendered — the poll's `since` watermark.
  const watermark = useRef<string | null>(null);

  const listParams = useMemo(() => {
    if (!scopeId) return null;
    const params: Parameters<typeof shiftNotesApi.list>[0] = {
      org_unit: scopeId,
      limit: rowsPerPage,
      offset: page * rowsPerPage,
    };
    if (filters.type) params.types = [filters.type];
    if (filters.search) params.search = filters.search;
    if (filters.archived) params.include_archived = true;
    if (sort.key) {
      params.sort_by = sort.key;
      params.sort_dir = sort.dir;
    }
    return params;
  }, [scopeId, rowsPerPage, page, filters.type, filters.search, filters.archived, sort.key, sort.dir]);

  const fetchNotes = useCallback(async () => {
    if (!listParams) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await shiftNotesApi.list(listParams);
      setNotes(response.rows);
      setTotalCount(response.total);
      setRetentionDays(response.retention_days);
      setArchivedIncluded(response.archived_included);
      setCanReadArchived(response.can_read_archived);

      // Reset the poll watermark on the first page. On deeper pages the
      // newest row isn't here, so leave the watermark be.
      if (page === 0) {
        watermark.current = newestCreatedAt(response.rows);
      }
      setNewCount(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load the communication log';
      setError(message);
      showError(message);
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  }, [listParams, page, showError]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Config lists — static for the session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, a] = await Promise.all([
          shiftNotesApi.listTypes(),
          shiftNotesApi.listConductAreas(),
        ]);
        if (!cancelled) {
          setTypes(t);
          setConductAreas(a);
        }
      } catch {
        // Non-fatal: the list still renders, only the filter/form options
        // are missing. The create dialog surfaces its own error.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The 30s poll. Only runs on page 0 — on a deeper page the user is
  // reading history, and "3 new notes" would be noise.
  useEffect(() => {
    if (!scopeId || page !== 0) return;

    const check = async () => {
      if (document.hidden || !watermark.current) return;
      try {
        const response = await shiftNotesApi.list({
          org_unit: scopeId,
          since: watermark.current,
          ...(filters.type ? { types: [filters.type] } : {}),
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.archived ? { include_archived: true } : {}),
          // Count only — the banner needs a number, not the rows.
          count_only: true,
          limit: 1,
        });
        setNewCount(response.total);
      } catch {
        // A failed poll is not worth a toast — the next one may succeed.
      }
    };

    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [scopeId, page, filters.type, filters.search, filters.archived]);

  const typeById = useMemo(
    () => new Map(types.map(t => [t.id, t])),
    [types],
  );
  const conductAreaById = useMemo(
    () => new Map(conductAreas.map(a => [a.id, a])),
    [conductAreas],
  );

  /**
   * Select a scope. Both halves move together — an id without its code
   * leaves the picker blank, a code without its id leaves the query on the
   * old scope.
   *
   * Clearing (id === null) falls back to the default region rather than
   * root: the picker's clear button means "no explicit choice", and the
   * region is what no choice means here.
   */
  // NOTE: do not call setPage(0) alongside these. setFilter/setFilters
  // already clear the page param, and both they and setPage write the URL
  // through a functional setSearchParams. Called in the same handler, the
  // second read of `prev` is stale — React Router has not committed the
  // first update yet — so setPage would silently overwrite the filter
  // change and the selection would appear to do nothing.
  const setScope = useCallback((id: string | null, code: string | null) => {
    // Drop include_archived when the location changes: read_archived is
    // per-scope, so the new location may not grant it. The server ignores
    // the flag either way, but leaving it set would hide an active filter
    // behind a checkbox that is no longer rendered, and silently
    // reactivate it on switching back.
    setFilters({ scope: id ?? '', scopeCode: code ?? '', archived: false });
  }, [setFilters]);

  const setTypeFilter = useCallback((id: number) => {
    setFilter('type', id);
  }, [setFilter]);

  const setIncludeArchived = useCallback((value: boolean) => {
    setFilter('archived', value);
  }, [setFilter]);

  const handleClearFilters = useCallback(() => {
    clearSearch();
    setFilters({ scope: '', scopeCode: '', type: 0, search: '', archived: false });
  }, [clearSearch, setFilters]);

  const hasActiveFilters = useMemo(
    () =>
      Boolean(searchInput) ||
      Boolean(filters.type) ||
      Boolean(filters.archived) ||
      (Boolean(filters.scope) && filters.scope !== defaultScope),
    [searchInput, filters.type, filters.archived, filters.scope, defaultScope],
  );

  return {
    notes,
    types,
    conductAreas,
    typeById,
    conductAreaById,

    isLoading,
    isInitialLoad,
    error,
    totalCount,
    retentionDays,
    archivedIncluded,
    canReadArchived,

    newCount,
    refresh: fetchNotes,

    scopeId,
    scopeCode,
    setScope,
    typeFilter: filters.type,
    setTypeFilter,
    includeArchived: Boolean(filters.archived),
    setIncludeArchived,
    searchInput,
    setSearchInput,
    clearSearch,
    sort,
    toggleSort,
    hasActiveFilters,
    handleClearFilters,

    page,
    rowsPerPage,
    handlePageChange: setPage,
    handleRowsPerPageChange: setRowsPerPage,
  };
};
