import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../../constants';
import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Chip,
  Alert,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { PaginatedTableContainer } from '../../shared/components/paginated-table-container';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import { SearchAndFilters } from './components/search-and-filters';
import { useIncidentList } from './hooks/use-incident-list';
import { getIncidentStatus, getStatusColor, getStatusLabel } from '../../shared/utils/incident-status';
import { formatDisplayTime } from '../../shared/utils/date-utils';
import { LinkTableRow, LinkTableCell } from '../../shared/components/link-table-row';

const IncidentList: React.FC = () => {
  const {
    incidents,
    isLoading,
    isInitialLoad,
    error,
    totalCount,
    searchInput,
    setSearchInput,
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
  } = useIncidentList();

  if (isInitialLoad && isLoading) {
    return (
      <PageContainer>
        <LoadingSkeleton variant="table" rows={10} />
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="lg">
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">Incidents</Typography>
        <Box display="flex" gap={1}>
          <Button
            component={RouterLink}
            to={ROUTES.INCIDENTS_NEW}
            variant="contained"
            startIcon={<AddIcon />}
          >
            New Incident
          </Button>
        </Box>
      </Box>

      <SearchAndFilters
        searchTerm={searchInput}
        onSearchChange={setSearchInput}
        filterLocationCode={locationCode}
        onLocationCodeChange={setLocationCode}
        onLocationIdChange={setLocationId}
        dateRangePreset={dateRangePreset}
        onDateRangePresetChange={handleDateRangePresetChange}
        filterDateFrom={filters.from}
        onDateFromChange={(value) => setFilter('from', value)}
        filterDateTo={filters.to}
        onDateToChange={(value) => setFilter('to', value)}
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
        // Status filter
        filterStatus={filters.status}
        onStatusChange={(value) => setFilter('status', value)}
        showStatusFilter={true}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Error loading incidents: {error}
        </Alert>
      )}

      <PaginatedTableContainer
        count={totalCount}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={handlePageChange}
        onRowsPerPageChange={handleRowsPerPageChange}
      >
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 60 }}>ID</TableCell>
              <TableCell sx={{ minWidth: 200 }}>Title</TableCell>
              <TableCell sx={{ minWidth: 100 }}>Status</TableCell>
              <TableCell sx={{ minWidth: 120 }}>Location</TableCell>
              <TableCell sx={{ minWidth: 100 }}>Occurred</TableCell>
              <TableCell sx={{ minWidth: 100 }}>Reporter</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {incidents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="text.secondary" py={3}>
                    No incidents found
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              incidents.map((incident) => (
                <LinkTableRow
                  key={incident.id}
                  to={`/incidents/${incident.id}`}
                  hover
                >
                  <LinkTableCell>
                    <Typography variant="body2" fontWeight="medium">
                      #{incident.id}
                    </Typography>
                  </LinkTableCell>
                  <LinkTableCell>
                    <Typography variant="body2">
                      {incident.title || 'Untitled Incident'}
                    </Typography>
                  </LinkTableCell>
                  <LinkTableCell>
                    {(() => {
                      const status = getIncidentStatus(incident);
                      return (
                        <Chip
                          label={getStatusLabel(status)}
                          color={getStatusColor(status) as any}
                          size="small"
                        />
                      );
                    })()}
                  </LinkTableCell>
                  <LinkTableCell>{incident.org_unit_name || 'Unknown'}</LinkTableCell>
                  <LinkTableCell>
                    <Typography variant="body2">
                      {new Date(incident.occurred_at).toLocaleDateString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDisplayTime(incident.occurred_at)}
                    </Typography>
                  </LinkTableCell>
                  <LinkTableCell>{incident.created_by_name || 'System'}</LinkTableCell>
                </LinkTableRow>
              ))
            )}
          </TableBody>
        </Table>
      </PaginatedTableContainer>
    </PageContainer>
  );
};

export default IncidentList;
