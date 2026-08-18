import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToast } from '../../../contexts/toast-context';
import { useAuth } from '../../../contexts/auth-context';
import { useTableUrlState, useFilterUrlState } from '../../../shared/hooks/use-table-url-state';
import { useLocationFilter } from '../../../shared/hooks/use-location-filter';
import { useDebouncedSearch } from '../../../shared/hooks/use-debounced-search';
import { incidentApi } from '../../../api/incidents';
import { canEditIncident } from '../../../shared/utils/roles';
import { getDefaultDateRange, startOfDayUtc, endOfDayUtc } from '../../../shared/utils/date-utils';
import type { Incident } from '../../../types';
import type { DateRangePreset } from '../components/search-and-filters';

const defaultDateRange = getDefaultDateRange();

export const useIncidentList = () => {
  const { showError } = useToast();
  const { user } = useAuth();
  const location = useLocation();

  const { page, rowsPerPage, setPage, setRowsPerPage } = useTableUrlState({
    defaultRowsPerPage: 25,
  });

  const filterConfig = useMemo(() => ({
    search: { type: 'string' as const, defaultValue: '' },
    status: { type: 'string' as const, defaultValue: 'any' },
    location: { type: 'string' as const, defaultValue: '' },
    from: { type: 'string' as const, defaultValue: defaultDateRange.from },
    to: { type: 'string' as const, defaultValue: defaultDateRange.to },
  }), []);

  const { filters, setFilter, setFilters } = useFilterUrlState(filterConfig);

  const hasInitializedDates = useRef(false);
  useEffect(() => {
    if (!hasInitializedDates.current && !filters.from && !filters.to) {
      setFilters({ from: defaultDateRange.from, to: defaultDateRange.to });
      hasInitializedDates.current = true;
    }
  }, [filters.from, filters.to, setFilters]);

  const {
    locationCode,
    locationId,
    setLocationCode,
    setLocationId,
    userDefaultCode,
    userDefaultId,
    isInitialized: locationInitialized,
  } = useLocationFilter<'location'>({
    urlParamKey: 'location',
    setFilter,
    filterValue: filters.location,
  });

  const {
    searchInput,
    debouncedSearch,
    setSearchInput,
    clearSearch,
  } = useDebouncedSearch({
    initialValue: filters.search,
    onDebouncedChange: (value) => setFilter('search', value),
  });

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const [dateRangePreset, setDateRangePresetState] = useState<DateRangePreset>('last14');

  const hasInitializedPreset = useRef(false);
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const hasDateParams = urlParams.has('from') || urlParams.has('to');

    if (!hasInitializedPreset.current) {
      setDateRangePresetState(hasDateParams ? 'custom' : 'last14');
      hasInitializedPreset.current = true;
    } else if (!hasDateParams) {
      setDateRangePresetState('last14');
    }
  }, [location.search]);

  const handleDateRangePresetChange = useCallback(
    (preset: DateRangePreset, dateRange: { from: string; to: string } | null) => {
      setDateRangePresetState(preset);
      if (dateRange) {
        setFilters({ from: dateRange.from, to: dateRange.to });
      }
    },
    [setFilters]
  );

  const checkCanEdit = useCallback((incident: Incident) => {
    return canEditIncident(user, incident);
  }, [user]);

  const fetchIncidents = useCallback(async () => {
    if (!locationInitialized) return;

    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = {
        page: page + 1,
        limit: rowsPerPage,
      };

      if (filters.status === 'active') {
        params['is_resolved'] = false;
      } else if (filters.status === 'resolved') {
        params['is_resolved'] = true;
      }

      if (locationId) params['org_unit'] = locationId;
      if (debouncedSearch) params['query'] = debouncedSearch;
      if (filters.from) params['occurred_after'] = startOfDayUtc(filters.from);
      if (filters.to) params['occurred_before'] = endOfDayUtc(filters.to);

      const response = await incidentApi.searchV2(params);
      setIncidents(response.items);
      setTotalCount(response.total);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load incidents';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  }, [locationId, debouncedSearch, filters.status, filters.from, filters.to, page, rowsPerPage, showError, locationInitialized]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  const handleClearFilters = useCallback(() => {
    clearSearch();
    setDateRangePresetState('last14');
    setFilters({
      search: '',
      status: 'any',
      location: userDefaultCode ?? '',
      from: '',
      to: '',
    });
    setLocationId(userDefaultId);
  }, [clearSearch, setFilters, userDefaultCode, userDefaultId, setLocationId]);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, [setPage]);

  const handleRowsPerPageChange = useCallback((newRowsPerPage: number) => {
    setRowsPerPage(newRowsPerPage);
  }, [setRowsPerPage]);

  const hasActiveFilters = useMemo(() => {
    const freshDefaultRange = getDefaultDateRange();
    return Boolean(
      searchInput ||
      filters.from !== freshDefaultRange.from ||
      filters.to !== freshDefaultRange.to ||
      filters.status !== 'any' ||
      locationCode !== (userDefaultCode ?? '')
    );
  }, [searchInput, filters.from, filters.to, filters.status, locationCode, userDefaultCode]);

  return {
    incidents,
    isLoading,
    isInitialLoad,
    error,
    totalCount,
    searchInput,
    setSearchInput,
    clearSearch,
    locationCode,
    setLocationCode,
    setLocationId,
    filters,
    setFilter,
    hasActiveFilters,
    dateRangePreset,
    handleDateRangePresetChange,
    page,
    rowsPerPage,
    handlePageChange,
    handleRowsPerPageChange,
    handleClearFilters,
    checkCanEdit,
  };
};
