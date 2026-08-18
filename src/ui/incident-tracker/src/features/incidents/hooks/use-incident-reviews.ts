import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToast } from '../../../contexts/toast-context';
import { useLocations } from '../../../contexts/location-context';
import { useAuth } from '../../../contexts/auth-context';
import { useTableUrlState, useFilterUrlState } from '../../../shared/hooks/use-table-url-state';
import { useLocationFilter } from '../../../shared/hooks/use-location-filter';
import { useDebouncedSearch } from '../../../shared/hooks/use-debounced-search';
import { incidentApi } from '../../../api';
import type { Incident } from '../../../types';
import type { ReviewResult } from '../components/review-dialog';
import type { DateRangePreset } from '../components/search-and-filters';
import { parseTimestamp, startOfDayLocal, endOfDayLocal, getDefaultDateRange } from '../../../shared/utils/date-utils';

const defaultDateRange = getDefaultDateRange();

interface ReviewActionDialogData {
  incident: Incident | null;
  action: 'approve' | 'request_changes' | null;
  reviewLevel?: number;
}

export const useIncidentReviews = () => {
  const { showSuccess, showError } = useToast();
  const { locations } = useLocations();
  const { user } = useAuth();
  const location = useLocation();

  const { page, rowsPerPage, setPage, setRowsPerPage } = useTableUrlState({
    defaultRowsPerPage: 10,
  });

  const filterConfig = useMemo(() => ({
    search: { type: 'string' as const, defaultValue: '' },
    location: { type: 'string' as const, defaultValue: '' },
    from: { type: 'string' as const, defaultValue: defaultDateRange.from },
    to: { type: 'string' as const, defaultValue: defaultDateRange.to },
    my_level: { type: 'boolean' as const, defaultValue: false },
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
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [reviewDialog, setReviewDialog] = useState<ReviewActionDialogData>({
    incident: null,
    action: null,
    reviewLevel: undefined,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const fetchPendingReviews = useCallback(async (orgUnit: string | null) => {
    setIsLoading(true);
    setError(null);
    // Hard cap on rows accumulated client-side. The pending queue can
    // be very long on busy datasets; the table renders all rows it
    // gets, so we bound the count to keep render time predictable.
    // Past this point users should narrow the filter instead.
    //
    // TODO: proper UI paging. The backend's `getPendingReviews` API
    // is already keyset-paged; this hook hides that by draining all
    // pages on mount and feeding a single flat list to the table. A
    // future pass should:
    //   - expose page state (currentCursor + nextCursor) from the hook
    //   - drive a "load more" / infinite-scroll affordance in the
    //     pending-reviews table instead of the MAX_ROWS truncation
    //   - drop the eager drain entirely
    // Doing it now is premature — the table doesn't have the UX
    // hooks for paging yet, and most users have fewer than a page's
    // worth of pending items in real workflows.
    const MAX_ROWS = 1000;
    const PAGE_SIZE = 100;
    try {
      const accumulated: Incident[] = [];
      let cursor = null as Awaited<ReturnType<typeof incidentApi.getPendingReviews>>['nextCursor'];
      // Loop the keyset-paged endpoint until exhausted or capped.
      // `nextCursor === null` means the backend reached the end.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await incidentApi.getPendingReviews(orgUnit, {
          cursor,
          limit: PAGE_SIZE,
        });
        accumulated.push(...page.items);
        cursor = page.nextCursor;
        if (cursor == null || accumulated.length >= MAX_ROWS) {
          break;
        }
      }
      setIncidents(accumulated);
    } catch (err: any) {
      setError(err.message || 'Failed to load pending reviews');
      showError('Failed to load pending reviews');
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (!locationInitialized) return;
    fetchPendingReviews(locationId);
  }, [locationId, locationInitialized, fetchPendingReviews]);

  const hasAnyReviewableIncidents = useMemo(() => {
    return incidents.some((inc) => (inc.user_review_level ?? 0) > 0);
  }, [incidents]);

  const pendingReviewIncidents = useMemo(() => {
    let filtered = [...incidents];

    if (filters.my_level && hasAnyReviewableIncidents) {
      filtered = filtered.filter((incident) => {
        if (incident.can_resubmit === true) return true;
        const userLevel = incident.user_review_level ?? 0;
        const currentLevel = incident.current_review_level ?? 0;
        return userLevel === currentLevel;
      });
    }

    if (debouncedSearch) {
      const search = debouncedSearch.toLowerCase();
      filtered = filtered.filter(
        (incident) =>
          String(incident.id).includes(search) ||
          incident.title?.toLowerCase().includes(search) ||
          incident.description?.toLowerCase().includes(search) ||
          incident.org_unit_name?.toLowerCase().includes(search) ||
          incident.created_by_name?.toLowerCase().includes(search)
      );
    }

    if (filters.from) {
      const fromDate = startOfDayLocal(filters.from);
      filtered = filtered.filter(
        (incident) => parseTimestamp(incident.created_at) >= fromDate
      );
    }

    if (filters.to) {
      const toDate = endOfDayLocal(filters.to);
      filtered = filtered.filter(
        (incident) => parseTimestamp(incident.created_at) <= toDate
      );
    }

    return filtered.sort((a, b) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [incidents, debouncedSearch, filters.from, filters.to, filters.my_level, hasAnyReviewableIncidents]);

  const canUserReviewIncident = useCallback((incident: Incident): boolean => {
    return incident.can_review ?? false;
  }, []);

  const showBulkActions = false;

  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      const start = page * rowsPerPage;
      const paginatedIncidents = pendingReviewIncidents.slice(start, start + rowsPerPage);
      const reviewableIncidents = paginatedIncidents.filter(canUserReviewIncident);
      setSelected(reviewableIncidents.map((n) => n.id));
      return;
    }
    setSelected([]);
  };

  const handleSelect = (id: number) => {
    const selectedIndex = selected.indexOf(id);
    if (selectedIndex === -1) {
      setSelected([...selected, id]);
    } else {
      setSelected(selected.filter((_, i) => i !== selectedIndex));
    }
  };

  const hasActiveFilters = useMemo(() => {
    const freshDefaultRange = getDefaultDateRange();
    return Boolean(
      searchInput ||
      filters.from !== freshDefaultRange.from ||
      filters.to !== freshDefaultRange.to ||
      filters.my_level ||
      locationCode !== (userDefaultCode ?? '')
    );
  }, [searchInput, filters.from, filters.to, filters.my_level, locationCode, userDefaultCode]);

  const handleClearFilters = useCallback(() => {
    clearSearch();
    setDateRangePresetState('last14');
    setFilters({
      search: '',
      location: userDefaultCode ?? '',
      from: '',
      to: '',
      my_level: false,
    });
    setLocationId(userDefaultId);
  }, [clearSearch, setFilters, userDefaultCode, userDefaultId, setLocationId]);

  const handleRefresh = useCallback(async () => {
    await fetchPendingReviews(locationId);
  }, [fetchPendingReviews, locationId]);

  const openReviewDialog = (incident: Incident, action: 'approve' | 'request_changes') => {
    setReviewDialog({ incident, action, reviewLevel: incident.user_review_level });
  };

  const closeReviewDialog = () => {
    setReviewDialog({ incident: null, action: null, reviewLevel: undefined });
  };

  const handleReviewAction = async (reviewResult: ReviewResult, comments: string) => {
    if (!reviewDialog.incident || !user) return;

    setIsSubmitting(true);
    try {
      const { incident } = reviewDialog;
      await incidentApi.createReview(incident.id, reviewResult, comments || undefined);

      const resultText = {
        'submitted': 'submitted for review',
        'approved': 'approved and forwarded',
        'approved-with-edits': 'approved with edits required',
        'returned': 'returned for changes',
        'deleted': 'deleted',
        'resolved': 'review completed'
      }[reviewResult] || reviewResult;

      showSuccess(`Incident #${incident.id} ${resultText}`);
      closeReviewDialog();
      handleRefresh();
    } catch (err: any) {
      showError(`Failed to review incident: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchApprove = async () => {
    if (selected.length === 0) {
      showError('No incidents selected');
      return;
    }

    const reviewableIncidents = incidents.filter(
      (inc) => selected.includes(inc.id) && canUserReviewIncident(inc)
    );

    if (reviewableIncidents.length === 0) {
      showError('None of the selected incidents can be approved by you');
      return;
    }

    if (reviewableIncidents.length < selected.length) {
      const skipped = selected.length - reviewableIncidents.length;
      if (!window.confirm(
        `You can only approve ${reviewableIncidents.length} of the ${selected.length} selected incident(s). ` +
        `${skipped} incident(s) will be skipped because you don't have permission to review them. Continue?`
      )) {
        return;
      }
    } else {
      if (!window.confirm(`Are you sure you want to approve ${reviewableIncidents.length} incident(s)?`)) {
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await Promise.all(
        reviewableIncidents.map((inc) =>
          incidentApi.createReview(inc.id, 'approved', 'Batch approved')
        )
      );
      showSuccess(`${reviewableIncidents.length} incident(s) approved`);
      setSelected([]);
      handleRefresh();
    } catch (err: any) {
      showError('Failed to approve incidents');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, [setPage]);

  const handleRowsPerPageChange = useCallback((newRowsPerPage: number) => {
    setRowsPerPage(newRowsPerPage);
  }, [setRowsPerPage]);

  return {
    pendingReviewIncidents,
    isLoading,
    error,
    locations,
    searchTerm: searchInput,
    setSearchTerm: setSearchInput,
    filterLocationCode: locationCode,
    setFilterLocationCode: setLocationCode,
    setFilterLocationId: setLocationId,
    filterDateFrom: filters.from,
    setFilterDateFrom: (value: string) => setFilter('from', value),
    filterDateTo: filters.to,
    setFilterDateTo: (value: string) => setFilter('to', value),
    filterMyLevelOnly: filters.my_level,
    setFilterMyLevelOnly: (value: boolean) => setFilter('my_level', value),
    hasActiveFilters,
    handleClearFilters,
    dateRangePreset,
    handleDateRangePresetChange,
    selected,
    page,
    rowsPerPage,
    handleSelectAll,
    handleSelect,
    handlePageChange,
    handleRowsPerPageChange,
    reviewDialog,
    isSubmitting,
    openReviewDialog,
    closeReviewDialog,
    handleReviewAction,
    handleBatchApprove,
    canUserReviewIncident,
    hasAnyReviewableIncidents,
    showBulkActions,
  };
};
