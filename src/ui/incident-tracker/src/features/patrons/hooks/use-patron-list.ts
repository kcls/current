import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../../../contexts/toast-context';
import { useTableUrlState, useFilterUrlState } from '../../../shared/hooks/use-table-url-state';
import { useLocationFilter } from '../../../shared/hooks/use-location-filter';
import { useDebouncedSearch } from '../../../shared/hooks/use-debounced-search';
import { patronApi } from '../../../api/patrons';
import type { PatronSearchResult } from '../../../types/patron';

export const usePatronList = () => {
  const { showError } = useToast();

  const { page, rowsPerPage, setPage, setRowsPerPage } = useTableUrlState({
    defaultRowsPerPage: 25,
  });

  const filterConfig = useMemo(() => ({
    search: { type: 'string' as const, defaultValue: '' },
    location: { type: 'string' as const, defaultValue: '' },
    consequence: { type: 'string' as const, defaultValue: 'any' },
    hide_unknown: { type: 'boolean' as const, defaultValue: true },
  }), []);

  const { filters, setFilter, setFilters } = useFilterUrlState(filterConfig);

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

  const [patrons, setPatrons] = useState<PatronSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchPatrons = useCallback(async () => {
    if (!locationInitialized) return;

    setIsLoading(true);
    setError(null);
    try {
      const params: any = {
        page: page + 1,
        limit: rowsPerPage
      };
      if (locationId) params.org_unit = locationId;
      if (debouncedSearch) params.query = debouncedSearch;
      if (filters.consequence === 'ban') params.has_active_bans = true;
      if (filters.consequence === 'trespass') params.has_visible_trespass = true;
      if (filters.hide_unknown) params.is_unknown = false;

      const response = await patronApi.search(params);
      setPatrons(response.items);
      setTotalCount(response.total);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load patrons';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  }, [locationId, debouncedSearch, filters.consequence, filters.hide_unknown, page, rowsPerPage, showError, locationInitialized]);

  useEffect(() => {
    fetchPatrons();
  }, [fetchPatrons]);

  const handleClearFilters = useCallback(() => {
    clearSearch();
    setFilters({
      search: '',
      location: userDefaultCode ?? '',
      consequence: 'any',
      hide_unknown: true,
    });
    setLocationId(userDefaultId);
  }, [clearSearch, setFilters, userDefaultCode, userDefaultId, setLocationId]);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, [setPage]);

  const handleRowsPerPageChange = useCallback((newRowsPerPage: number) => {
    setRowsPerPage(newRowsPerPage);
  }, [setRowsPerPage]);

  const hasActiveFilters = useMemo(() =>
    searchInput || locationCode !== (userDefaultCode ?? '') || filters.consequence !== 'any' || !filters.hide_unknown,
    [searchInput, locationCode, userDefaultCode, filters.consequence, filters.hide_unknown]
  );

  return {
    patrons,
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

    page,
    rowsPerPage,
    handlePageChange,
    handleRowsPerPageChange,

    handleClearFilters,
  };
};
