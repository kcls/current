import React from 'react';
import {
  Box,
  Typography,
  Alert,
} from '@mui/material';
import { PageContainer } from '../../shared/components/layout';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import { StatisticsCards } from './components/statistics-cards';
import { SearchAndFilters } from './components/search-and-filters';
import { ReviewTable } from './components/review-table';
import { ReviewDialog } from './components/review-dialog';
import { useIncidentReviews } from './hooks/use-incident-reviews';

const IncidentReviews: React.FC = () => {
  const {
    // Data
    pendingReviewIncidents,
    isLoading,
    error,

    // Search and filters
    searchTerm,
    setSearchTerm,
    filterLocationCode,
    setFilterLocationCode,
    setFilterLocationId,
    filterDateFrom,
    setFilterDateFrom,
    filterDateTo,
    setFilterDateTo,
    filterMyLevelOnly,
    setFilterMyLevelOnly,
    hasActiveFilters,
    handleClearFilters,
    dateRangePreset,
    handleDateRangePresetChange,

    // Selection and pagination
    selected,
    page,
    rowsPerPage,
    handleSelectAll,
    handleSelect,
    handlePageChange,
    handleRowsPerPageChange,

    // Review actions
    reviewDialog,
    isSubmitting,
    openReviewDialog,
    closeReviewDialog,
    handleReviewAction,
    handleBatchApprove,
    canUserReviewIncident,
    hasAnyReviewableIncidents,
    showBulkActions,
  } = useIncidentReviews();

  if (isLoading && pendingReviewIncidents.length === 0) {
    return (
      <PageContainer>
        <LoadingSkeleton variant="table" rows={10} />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <Alert severity="error">Error loading incidents: {error}</Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="lg">
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1">Incident Reviews</Typography>
      </Box>

      {/* Statistics Cards */}
      <StatisticsCards incidents={pendingReviewIncidents} />

      {/* Search and Filters */}
      <SearchAndFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        filterLocationCode={filterLocationCode}
        onLocationCodeChange={setFilterLocationCode}
        onLocationIdChange={setFilterLocationId}
        dateRangePreset={dateRangePreset}
        onDateRangePresetChange={handleDateRangePresetChange}
        filterDateFrom={filterDateFrom}
        onDateFromChange={setFilterDateFrom}
        filterDateTo={filterDateTo}
        onDateToChange={setFilterDateTo}
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
        filterMyLevelOnly={filterMyLevelOnly}
        onMyLevelOnlyChange={setFilterMyLevelOnly}
        showMyLevelFilter={hasAnyReviewableIncidents}
      />

      {/* Review Table */}
      <ReviewTable
        incidents={pendingReviewIncidents}
        selected={selected}
        page={page}
        rowsPerPage={rowsPerPage}
        onSelectAll={handleSelectAll}
        onSelect={handleSelect}
        onPageChange={handlePageChange}
        onRowsPerPageChange={handleRowsPerPageChange}
        getIncidentHref={(id) => `/incidents/${id}`}
        onApprove={(incident) => openReviewDialog(incident, 'approve')}
        onRequestChanges={(incident) => openReviewDialog(incident, 'request_changes')}
        onBatchApprove={handleBatchApprove}
        isSubmitting={isSubmitting}
        canReviewIncident={canUserReviewIncident}
        showReviewActions={showBulkActions}
      />

      {/* Review Dialog */}
      <ReviewDialog
        incident={reviewDialog.incident}
        action={reviewDialog.action}
        reviewLevel={reviewDialog.reviewLevel}
        reviewCount={reviewDialog.incident?.current_review_level}
        latestReviewResult={reviewDialog.incident?.latest_review_result}
        onClose={closeReviewDialog}
        onConfirm={handleReviewAction}
      />
    </PageContainer>
  );
};

export default IncidentReviews;
