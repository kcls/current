import React from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Paper,
  Avatar,
} from '@mui/material';
import {
  Person as PersonIcon,
} from '@mui/icons-material';
import { uploadService } from '@core';
import type { PatronSearchResult } from '../../../types/patron';
import { LinkTableRow, LinkTableCell } from '../../../shared/components/link-table-row';

interface PatronTableProps {
  patrons: PatronSearchResult[];
  total: number;
  page: number;
  rowsPerPage: number;
  loading: boolean;
  emptyMessage?: string;
  variant: 'bans' | 'trespasses';
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  getRowHref?: (patronId: string) => string;
}

const formatDate = (dateString?: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const PatronTable: React.FC<PatronTableProps> = ({
  patrons,
  total,
  page,
  rowsPerPage,
  loading,
  emptyMessage = 'No patrons found',
  variant,
  onPageChange,
  onRowsPerPageChange,
  getRowHref,
}) => {
  return (
    <>
      {loading ? (
        <Box display="flex" justifyContent="center" py={3}>
          <CircularProgress />
        </Box>
      ) : patrons.length === 0 ? (
        <Alert severity="info">{emptyMessage}</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Patron Name</TableCell>
                  <TableCell>Library Card</TableCell>
                  <TableCell>Lift Date</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell align="right">Open Incidents</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {patrons.map((patron) => {
                  const href = getRowHref?.(patron.id);
                  const cells = (
                    <>
                      <LinkTableCell>
                        <Box display="flex" alignItems="center" gap={1.5}>
                          <Avatar
                            src={patron.primary_photo_url ? uploadService.getFileUrl(patron.primary_photo_url) : undefined}
                            sx={{ width: 40, height: 40 }}
                          >
                            <PersonIcon />
                          </Avatar>
                          <Typography variant="body2" fontWeight="medium">
                            {patron.display_name}
                          </Typography>
                        </Box>
                      </LinkTableCell>
                      <LinkTableCell>
                        <Typography variant="body2">
                          {patron.library_card || patron.barcode || 'N/A'}
                        </Typography>
                      </LinkTableCell>
                      <LinkTableCell>
                        <Typography variant="body2">
                          {formatDate(
                            variant === 'bans' ? patron.ban_max_lifts_at : patron.trespass_max_lifts_at
                          ) || 'N/A'}
                        </Typography>
                      </LinkTableCell>
                      <LinkTableCell>
                        <Typography variant="body2">
                          {patron.incident_org_unit_label || 'N/A'}
                        </Typography>
                      </LinkTableCell>
                      <LinkTableCell align="right">
                        <Typography variant="body2">
                          {patron.incident_count || 0}
                        </Typography>
                      </LinkTableCell>
                    </>
                  );

                  return href ? (
                    <LinkTableRow key={patron.id} to={href} hover>
                      {cells}
                    </LinkTableRow>
                  ) : (
                    <TableRow key={patron.id} hover>
                      {cells}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={total}
              page={page}
              rowsPerPage={rowsPerPage}
              onPageChange={(e, newPage) => onPageChange(newPage)}
              onRowsPerPageChange={(e) => onRowsPerPageChange(parseInt(e.target.value, 10))}
              rowsPerPageOptions={[5, 10, 25]}
            />
          </TableContainer>
        )}
    </>
  );
};

export default PatronTable;
