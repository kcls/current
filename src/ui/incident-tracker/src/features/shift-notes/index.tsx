import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  InputAdornment,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  AttachFile as AttachFileIcon,
  Clear as ClearIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { PaginatedTableContainer } from '../../shared/components/paginated-table-container';
import { SortableHeadCell } from '../../shared/components/data-table/sortable-head-cell';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import LocationSelector from '../../shared/components/location-selector';
import { useToast } from '../../contexts/toast-context';
import { useLocations } from '../../contexts/location-context';
import { formatDisplayDateTime } from '../../shared/utils/date-utils';
import { authApi } from '../../api';
import { shiftNotesApi } from '../../api/shift-notes';
import { useShiftNotes } from './hooks/use-shift-notes';
import ShiftNoteDialog from './shift-note-dialog';
import ShiftNoteViewDialog from './shift-note-view-dialog';
import type { ShiftNote } from '../../types';

/**
 * Map a configured type color to an MUI chip color. Unknown or missing
 * values fall back to "default" rather than breaking the row — the color
 * is decoration, and an admin can type anything into the config table.
 *
 * Rendered outlined, not filled: type is a way to tell rows apart at a
 * glance, not a status or a warning. Solid blocks of colour in every row
 * of a long list read as alarming and drown out the chips that do mean
 * something — the CoC areas, Instructed, Warned.
 */
const CHIP_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success'> = {
  amber: 'warning',
  blue: 'info',
  green: 'success',
  red: 'error',
  purple: 'secondary',
  grey: 'default',
};

const chipColor = (color: string | null) =>
  (color && CHIP_COLORS[color]) || 'default';

const ShiftNotes: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { locations } = useLocations();
  const {
    notes,
    types,
    conductAreas,
    conductAreaById,
    isLoading,
    isInitialLoad,
    error,
    totalCount,
    retentionDays,
    archivedIncluded,
    canReadArchived,
    newCount,
    refresh,
    scopeId,
    scopeCode,
    setScope,
    typeFilter,
    setTypeFilter,
    includeArchived,
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
    handlePageChange,
    handleRowsPerPageChange,
  } = useShiftNotes();

  // Set by LocationSelector's onChange, consumed by onIdChange in the same
  // interaction — the two callbacks fire back to back for one selection.
  const pendingScopeCode = useRef<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftNote | null>(null);
  const [viewing, setViewing] = useState<ShiftNote | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ShiftNote | null>(null);
  const [deleting, setDeleting] = useState(false);

  const workingOrgUnitId = authApi.getOrgUnit() ?? null;
  const workingOrgUnitCode = useMemo(() => {
    if (!workingOrgUnitId) return null;
    return locations.find(l => l.uuid === workingOrgUnitId)?.code ?? null;
  }, [workingOrgUnitId, locations]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (note: ShiftNote) => {
    setViewing(null);
    setEditing(note);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await shiftNotesApi.remove(pendingDelete.id);
      showSuccess('Entry deleted');
      setPendingDelete(null);
      refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete entry');
    } finally {
      setDeleting(false);
    }
  };

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
        <Box>
          <Typography variant="h4" component="h1">Communication Log</Typography>
          {retentionDays !== null && (
            <Typography variant="body2" color="text.secondary">
              {archivedIncluded
                ? 'Showing all entries, including archived'
                : `Showing the last ${retentionDays} days`}
            </Typography>
          )}
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          New Entry
        </Button>
      </Box>

      {newCount > 0 && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={refresh}>
              Show
            </Button>
          }
        >
          {newCount === 1 ? '1 new entry' : `${newCount} new entries`}
        </Alert>
      )}

      <Paper sx={{ mb: 2, p: 2 }}>
        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          <TextField
            placeholder="Search entries and patron names…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            size="small"
            sx={{ flex: 1, minWidth: 260 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: searchInput ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={clearSearch}>
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
          {/* The selector reports code and id through separate callbacks;
              buffer the code and commit both together in onIdChange, which
              always fires second. */}
          <LocationSelector
            value={scopeCode}
            onChange={code => { pendingScopeCode.current = code; }}
            onIdChange={id => setScope(id, pendingScopeCode.current)}
            label="Location"
            size="small"
            autoSetDefault={false}
            disableClearable={false}
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="shift-note-type-filter">Type</InputLabel>
            <Select
              labelId="shift-note-type-filter"
              label="Type"
              value={typeFilter || 0}
              onChange={e => setTypeFilter(Number(e.target.value))}
            >
              <MenuItem value={0}>All types</MenuItem>
              {types.map(t => (
                <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {/* Only offered to callers who hold read_archived at the selected
              scope. The server reports that per request, so switching to a
              location where the user lacks it hides the control — and the
              server ignores the flag regardless, so hiding it is a
              convenience, not the enforcement. */}
          {canReadArchived && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={includeArchived}
                  onChange={e => setIncludeArchived(e.target.checked)}
                />
              }
              label="Include archived"
            />
          )}
          {hasActiveFilters && (
            <Button onClick={handleClearFilters} variant="outlined" startIcon={<ClearIcon />}>
              Clear All
            </Button>
          )}
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {notes.length === 0 && !isLoading ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No entries for this location yet.
          </Typography>
        </Paper>
      ) : (
        <PaginatedTableContainer
          count={totalCount}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={handlePageChange}
          onRowsPerPageChange={handleRowsPerPageChange}
          rowsPerPageOptions={[10, 25, 50]}
          minWidth={760}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <SortableHeadCell
                  label="Library"
                  sortKey="org_unit"
                  sort={sort}
                  onSort={toggleSort}
                />
                {/* Region is derived from the note's org unit rather than
                    stored, so there is no column to order by. */}
                <TableCell>Region</TableCell>
                {/* The log is a chronology of what happened, so the date
                    column is occurred_at; created_at is shown in the view
                    dialog when the two differ. */}
                <SortableHeadCell
                  label="Date"
                  sortKey="occurred_at"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHeadCell
                  label="Type"
                  sortKey="type"
                  sort={sort}
                  onSort={toggleSort}
                />
                <TableCell>Patron</TableCell>
                <TableCell>Notes</TableCell>
                {/* Not sortable: the server can only order by created_by,
                    which groups a person's notes but not alphabetically —
                    a "Staff" sort that ignores the displayed name is more
                    confusing than no sort at all. */}
                <TableCell>Staff</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {notes.map(note => (
                <TableRow
                  key={note.id}
                  hover
                  onClick={() => setViewing(note)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>{note.org_unit_name ?? `Unit ${note.org_unit}`}</TableCell>
                  <TableCell>{note.region_name ?? '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatDisplayDateTime(note.occurred_at)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={note.type_label}
                      size="small"
                      variant="outlined"
                      color={chipColor(note.type_color)}
                    />
                  </TableCell>
                  <TableCell>
                    {note.patron_name ?? '—'}
                    {note.patron_description && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {note.patron_description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    {/* Clamped — the full text lives in the view dialog. */}
                    <Typography
                      variant="body2"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {note.notes}
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                      {note.was_instructed && <Chip label="Instructed" size="small" variant="outlined" />}
                      {note.was_warned && <Chip label="Warned" size="small" variant="outlined" />}
                      {note.conduct_areas.map(id => (
                        <Chip
                          key={id}
                          label={conductAreaById.get(id)?.label ?? `Area ${id}`}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                      {note.attachments.length > 0 && (
                        <Tooltip
                          title={note.attachments.map(a => a.file_name).join(', ')}
                        >
                          <Chip
                            icon={<AttachFileIcon />}
                            label={note.attachments.length}
                            size="small"
                            variant="outlined"
                            onClick={e => {
                              e.stopPropagation();
                              setViewing(note);
                            }}
                          />
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {note.staff_name ?? `User ${note.created_by}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PaginatedTableContainer>
      )}

      <ShiftNoteViewDialog
        open={viewing !== null}
        note={viewing}
        conductAreaById={conductAreaById}
        onClose={() => setViewing(null)}
        onEdit={openEdit}
        onDelete={note => {
          setViewing(null);
          setPendingDelete(note);
        }}
      />

      <ShiftNoteDialog
        open={dialogOpen}
        note={editing}
        types={types}
        conductAreas={conductAreas}
        defaultOrgUnitId={workingOrgUnitId}
        defaultOrgUnitCode={workingOrgUnitCode}
        onClose={() => setDialogOpen(false)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this entry?"
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </PageContainer>
  );
};

export default ShiftNotes;
