import React from 'react';
import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Chip,
  TextField,
  InputAdornment,
  IconButton,
  Alert,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { PaginatedTableContainer } from '../../shared/components/paginated-table-container';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import LocationSelector from '../../shared/components/location-selector';
import { usePatronList } from './hooks/use-patron-list';
import { LinkTableRow, LinkTableCell } from '../../shared/components/link-table-row';
import { formatAlias } from '../../shared/utils/patron-utils';

const PatronList: React.FC = () => {
  const {
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
  } = usePatronList();

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
        <Typography variant="h4" component="h1">Patrons</Typography>
      </Box>

      <Paper sx={{ mb: 2, p: 2 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" gap={2} alignItems="center">
            <TextField
              placeholder="Search by name, alias, card, or email (min 3 characters)..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              size="small"
              sx={{ flex: 1, maxWidth: 500 }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                  endAdornment: searchInput && (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={clearSearch}>
                        <ClearIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <LocationSelector
              value={locationCode || null}
              onChange={setLocationCode}
              onIdChange={setLocationId}
              size="small"
              autoSetDefault={false}
              disableClearable={false}
            />
            {hasActiveFilters && (
              <Button
                onClick={handleClearFilters}
                variant="outlined"
                startIcon={<ClearIcon />}
                sx={{ ml: 'auto' }}
              >
                Clear All
              </Button>
            )}
          </Box>

          <Box display="flex" alignItems="center" gap={2}>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Consequence</InputLabel>
              <Select
                value={filters.consequence}
                label="Consequence"
                onChange={(e) => setFilter('consequence', e.target.value)}
              >
                <MenuItem value="any">Any</MenuItem>
                <MenuItem value="ban">Ban</MenuItem>
                <MenuItem value="trespass">Trespass</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Checkbox
                  checked={filters.hide_unknown}
                  onChange={(e) => setFilter('hide_unknown', e.target.checked)}
                  size="small"
                />
              }
              label="Hide unknown patrons"
            />
          </Box>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Error loading patrons: {error}
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
              <TableCell sx={{ minWidth: 150 }}>Name</TableCell>
              <TableCell sx={{ minWidth: 120 }}>Library Card</TableCell>
              <TableCell sx={{ minWidth: 120 }}>Status</TableCell>
              <TableCell sx={{ minWidth: 100 }}>Open Incidents</TableCell>
              <TableCell sx={{ minWidth: 100 }}>Last Incident</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {patrons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="text.secondary" py={3}>
                    No patrons found
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              patrons.map((patron) => (
                <LinkTableRow
                  key={patron.id}
                  to={`/patrons/${patron.id}`}
                  hover
                >
                  <LinkTableCell>
                    <Typography variant="body2" fontWeight="medium" component="span">
                      {patron.display_name}
                    </Typography>
                    {(() => {
                      const aliasText = formatAlias(patron.alias);
                      return aliasText ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="span"
                          sx={{ ml: 0.75 }}
                        >
                          ({aliasText})
                        </Typography>
                      ) : null;
                    })()}
                  </LinkTableCell>
                  <LinkTableCell>
                    <Typography variant="body2">
                      {patron.barcode || patron.library_card || 'N/A'}
                    </Typography>
                  </LinkTableCell>
                  <LinkTableCell>
                    {(() => {
                      const now = new Date();
                      const banLiftsAt = patron.ban_max_lifts_at ? new Date(patron.ban_max_lifts_at) : null;
                      const trespassLiftsAt = patron.trespass_max_lifts_at ? new Date(patron.trespass_max_lifts_at) : null;

                      const hasActiveBan = banLiftsAt !== null && banLiftsAt > now;
                      const hasActiveTrespass = trespassLiftsAt !== null && trespassLiftsAt > now;
                      const hasLiftedTrespass = trespassLiftsAt !== null && trespassLiftsAt <= now;

                      return (
                        <Box display="flex" flexDirection="column" gap={0.5}>
                          <Box display="flex" gap={0.5} flexWrap="wrap">
                            {hasActiveBan && (
                              <Chip label="Banned" color="default" size="small" />
                            )}
                            {hasActiveTrespass && (
                              <Chip label="Trespassed" color="default" size="small" />
                            )}
                            {hasLiftedTrespass && (
                              <Chip
                                label="Pending Archive"
                                variant="outlined"
                                color="default"
                                size="small"
                              />
                            )}
                          </Box>
                        </Box>
                      );
                    })()}
                  </LinkTableCell>
                  <LinkTableCell>
                    <Typography variant="body2">
                      {patron.incident_count || 0}
                    </Typography>
                  </LinkTableCell>
                  <LinkTableCell>
                    <Typography variant="body2">
                      {patron.last_incident
                        ? new Date(patron.last_incident).toLocaleDateString()
                        : ''}
                    </Typography>
                  </LinkTableCell>
                </LinkTableRow>
              ))
            )}
          </TableBody>
        </Table>
      </PaginatedTableContainer>
    </PageContainer>
  );
};

export default PatronList;
