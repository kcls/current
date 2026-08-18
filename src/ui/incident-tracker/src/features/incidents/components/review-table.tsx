import React from 'react';
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
  Checkbox,
  Toolbar,
  IconButton,
  Tooltip,
  alpha,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  RateReview as RateReviewIcon,
  PlaylistAddCheck as PlaylistAddCheckIcon,
} from '@mui/icons-material';
import { PaginatedTableContainer } from '../../../shared/components/paginated-table-container';
import { LinkTableRow, LinkTableCell } from '../../../shared/components/link-table-row';
import { formatDisplayTime } from '../../../shared/utils/date-utils';
import type { Incident } from '../../../types';

interface ReviewTableProps {
  incidents: Incident[];
  selected: number[];
  page: number;
  rowsPerPage: number;
  onSelectAll: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelect: (id: number) => void;
  onPageChange: (newPage: number) => void;
  onRowsPerPageChange: (newRowsPerPage: number) => void;
  getIncidentHref: (id: number) => string;
  onApprove: (incident: Incident) => void;
  onRequestChanges: (incident: Incident) => void;
  onBatchApprove: () => void;
  isSubmitting: boolean;
  canReviewIncident: (incident: Incident) => boolean;
  showReviewActions?: boolean;
}

export const ReviewTable: React.FC<ReviewTableProps> = ({
  incidents,
  selected,
  page,
  rowsPerPage,
  onSelectAll,
  onSelect,
  onPageChange,
  onRowsPerPageChange,
  getIncidentHref,
  onApprove,
  onRequestChanges,
  onBatchApprove,
  isSubmitting,
  canReviewIncident,
  showReviewActions = true,
}) => {
  const paginatedIncidents = incidents.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  const reviewableCount = paginatedIncidents.filter(canReviewIncident).length;

  const isSelected = (id: number) => selected.indexOf(id) !== -1;

  return (
    <>
      {/* Selected Actions Toolbar */}
      {showReviewActions && selected.length > 0 && (
        <Toolbar
          sx={{
            pl: 2,
            pr: 2,
            py: 1,
            minHeight: 48,
            bgcolor: (theme) =>
              alpha(theme.palette.primary.main, theme.palette.action.activatedOpacity),
            mb: 1,
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Typography sx={{ flex: '1 1 auto' }} color="inherit" variant="subtitle1" fontWeight={500}>
            {selected.length} selected
          </Typography>
          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={<PlaylistAddCheckIcon />}
            onClick={onBatchApprove}
            disabled={isSubmitting}
            sx={{ flexShrink: 0 }}
          >
            Approve All
          </Button>
        </Toolbar>
      )}

      {/* Incidents Table */}
      <PaginatedTableContainer
        count={incidents.length}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={onPageChange}
        onRowsPerPageChange={onRowsPerPageChange}
      >
        <Table>
          <TableHead>
            <TableRow>
              {showReviewActions && (
                <TableCell padding="checkbox" sx={{ minWidth: 48 }}>
                  <Tooltip title={reviewableCount === 0 ? 'No incidents you can review on this page' : ''}>
                    <span>
                      <Checkbox
                        indeterminate={
                          selected.length > 0 && selected.length < reviewableCount
                        }
                        checked={
                          reviewableCount > 0 &&
                          selected.length === reviewableCount
                        }
                        disabled={reviewableCount === 0}
                        onChange={onSelectAll}
                      />
                    </span>
                  </Tooltip>
                </TableCell>
              )}
              <TableCell sx={{ minWidth: 60 }}>ID</TableCell>
              <TableCell sx={{ minWidth: 200 }}>Title</TableCell>
              <TableCell sx={{ minWidth: 120 }}>Location</TableCell>
              <TableCell sx={{ minWidth: 100 }}>Reporter</TableCell>
              <TableCell sx={{ minWidth: 100 }}>Occurred</TableCell>
              <TableCell align="right" sx={{ minWidth: 80 }}>Review</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedIncidents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showReviewActions ? 7 : 6} align="center">
                  <Box py={4}>
                    <CheckCircleIcon sx={{ fontSize: 60, color: 'success.main', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">
                      No incidents pending review
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      All incidents have been reviewed!
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              paginatedIncidents.map((incident) => {
                const isItemSelected = isSelected(incident.id);
                const canReview = canReviewIncident(incident);
                return (
                  <LinkTableRow
                    key={incident.id}
                    to={getIncidentHref(incident.id)}
                    hover
                    selected={isItemSelected}
                  >
                    {showReviewActions && (
                      <TableCell padding="checkbox">
                        <Tooltip title={canReview ? '' : 'You cannot review this incident at your current level'}>
                          <span>
                            <Checkbox
                              checked={isItemSelected}
                              disabled={!canReview}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelect(incident.id);
                              }}
                            />
                          </span>
                        </Tooltip>
                      </TableCell>
                    )}
                    <LinkTableCell>
                      <Typography variant="body2" fontWeight="medium">
                        #{incident.id}
                      </Typography>
                    </LinkTableCell>
                    <LinkTableCell>
                      <Box>
                        <Typography variant="body2">
                          {incident.template_name || incident.title|| 'Unknown Template'}
                        </Typography>
                        {incident.requires_follow_up && (
                          <Chip
                            label="Follow-up Required"
                            color="warning"
                            size="small"
                            sx={{ mt: 0.5 }}
                          />
                        )}
                      </Box>
                    </LinkTableCell>
                    <LinkTableCell>
                      {incident.org_unit_name || 'Unknown'}
                    </LinkTableCell>
                    <LinkTableCell>
                      {incident.created_by_name || 'System'}
                    </LinkTableCell>
                    <LinkTableCell>
                      <Typography variant="body2">
                        {new Date(incident.occurred_at).toLocaleDateString()}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDisplayTime(incident.occurred_at)}
                      </Typography>
                    </LinkTableCell>
                    <LinkTableCell align="right">
                      <Box display="flex" gap={0.5} justifyContent="flex-end">
                        <Tooltip title={canReview ? 'Approve' : 'You cannot review this incident at your current level'}>
                          <span>
                            <IconButton
                              size="small"
                              color="success"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onApprove(incident);
                              }}
                              disabled={!canReview}
                            >
                              <CheckCircleIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={canReview ? 'Request Changes' : 'You cannot review this incident at your current level'}>
                          <span>
                            <IconButton
                              size="small"
                              color="warning"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onRequestChanges(incident);
                              }}
                              disabled={!canReview}
                            >
                              <RateReviewIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
                    </LinkTableCell>
                  </LinkTableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </PaginatedTableContainer>
    </>
  );
};
