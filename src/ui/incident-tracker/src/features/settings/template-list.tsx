import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTemplates } from '../../contexts/templates-context';
import {
  Paper,
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  TextField,
  InputAdornment,
  FormControlLabel,
  Switch,
  Alert,
  Button,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Clear as ClearIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { authApi } from '@core';
import { templateApi } from '../../api/templates';
import { categoryApi } from '../../api/categories';
import type { Category, IncidentTemplate } from '../../types';
import { useToast } from '../../contexts/toast-context';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import TemplateDialog from './components/template-dialog';
import CategoriesSection from './components/categories-section';
import { PageContainer } from '../../shared/components/layout';
import { PaginatedTableContainer } from '../../shared/components/paginated-table-container';
import { useTableUrlState, useFilterUrlState } from '../../shared/hooks/use-table-url-state';
import LoadingSkeleton from '../../shared/components/loading-skeleton';

const TemplateList: React.FC = () => {
  const { templates, isLoading, error, fetchTemplates } = useTemplates();
  const [categories, setCategories] = useState<Category[]>([]);
  const { showSuccess, showError } = useToast();
  const [canWrite, setCanWrite] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<IncidentTemplate | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<IncidentTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { page, rowsPerPage, setPage, setRowsPerPage } = useTableUrlState({
    defaultRowsPerPage: 10,
  });
  const filterConfig = useMemo(() => ({
    search: { type: 'string' as const, defaultValue: '' },
    show_inactive: { type: 'boolean' as const, defaultValue: false },
  }), []);
  const { filters, setFilter } = useFilterUrlState(filterConfig);
  const [searchInput, setSearchInput] = useState(filters.search);
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  useEffect(() => {
    setSearchInput(filters.search);
    setDebouncedSearch(filters.search);
  }, [filters.search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (debouncedSearch !== searchInput) {
        setDebouncedSearch(searchInput);
        // Only update URL when debounce completes and value changed
        if (searchInput !== filters.search) {
          setFilter('search', searchInput);
        }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput, debouncedSearch, filters.search, setFilter]);

  useEffect(() => {
    fetchTemplates({});
  }, [fetchTemplates]);

  const fetchCategories = useCallback(() => {
    categoryApi.list().then(setCategories).catch(() => {
      // Labels fall back to category codes
    });
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const categoryLabels = useMemo(
    () => new Map(categories.map((c) => [c.code, c.label])),
    [categories]
  );
  const categoryLabel = (code: string) => categoryLabels.get(code) ?? code;

  useEffect(() => {
    let cancelled = false;
    authApi.userHasPerm('current.incident_template.write').then((allowed) => {
      if (!cancelled) setCanWrite(allowed);
    });
    return () => { cancelled = true; };
  }, []);

  const openDialog = (template: IncidentTemplate | null) => {
    setEditingTemplate(template);
    setDialogOpen(true);
  };

  const handleSaved = (template: IncidentTemplate) => {
    showSuccess(`Template "${template.name}" saved`);
    fetchTemplates({});
  };

  const handleDelete = async () => {
    if (!deletingTemplate) return;
    setDeleting(true);
    try {
      await templateApi.delete(Number(deletingTemplate.id));
      showSuccess(`Template "${deletingTemplate.name}" deleted`);
      setDeletingTemplate(null);
      fetchTemplates({});
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setDeleting(false);
    }
  };

  // Filter templates based on search and active status
  const filteredTemplates = templates.filter(template => {
    const matchesSearch =
      template.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      template.description.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      categoryLabel(template.category).toLowerCase().includes(debouncedSearch.toLowerCase());

    const matchesActive = filters.show_inactive || template.is_active;

    return matchesSearch && matchesActive;
  });

  // Pagination
  const paginatedTemplates = filteredTemplates.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'behavior':
        return 'primary';
      case 'medical':
        return 'error';
      case 'property':
        return 'warning';
      case 'theft':
        return 'secondary';
      case 'safety':
        return 'info';
      case 'technology':
        return 'default';
      default:
        return 'default';
    }
  };


  if (isLoading && templates.length === 0) {
    return (
      <PageContainer>
        <LoadingSkeleton variant="table" rows={8} />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <Alert severity="error">{error}</Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="lg">
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">Incident Templates</Typography>
        {canWrite && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openDialog(null)}>
            New Template
          </Button>
        )}
      </Box>

      {/* Search and Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box display="flex" gap={2} alignItems="center">
          <TextField
            placeholder="Search templates..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            size="small"
            sx={{ flex: 1, maxWidth: 400 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
              endAdornment: searchInput && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => { setSearchInput(''); setFilter('search', ''); }}>
                    <ClearIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={filters.show_inactive}
                onChange={(e) => setFilter('show_inactive', e.target.checked)}
              />
            }
            label="Show inactive"
          />
        </Box>
      </Paper>

      {/* Templates Table */}
      <PaginatedTableContainer
        count={filteredTemplates.length}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        rowsPerPageOptions={[5, 10, 25]}
      >
        <Table sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell>Template Name</TableCell>
              <TableCell width="180px">Category</TableCell>
              <TableCell width="130px" align="center">Requires Patron</TableCell>
              <TableCell width="130px" align="center">Asks 911/988</TableCell>
              <TableCell width="150px">Status</TableCell>
              {canWrite && <TableCell width="110px" align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedTemplates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 6 : 5} align="center">
                  <Typography color="text.secondary" py={3}>
                    No templates found
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedTemplates.map((template) => (
                <TableRow key={template.id} hover>
                  <TableCell>
                    <Box>
                      <Typography variant="body2" fontWeight="medium">
                        {template.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {template.description}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={categoryLabel(template.category)}
                      color={getCategoryColor(template.category) as any}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="center">
                    {template.requires_patron && <CheckIcon fontSize="small" aria-label="Yes" />}
                  </TableCell>
                  <TableCell align="center">
                    {template.show_called_emergency && <CheckIcon fontSize="small" aria-label="Yes" />}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={template.is_active ? 'Active' : 'Inactive'}
                      color={template.is_active ? 'success' : 'default'}
                      size="small"
                      icon={template.is_active ? <VisibilityIcon /> : <VisibilityOffIcon />}
                    />
                  </TableCell>
                  {canWrite && (
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openDialog(template)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => setDeletingTemplate(template)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </PaginatedTableContainer>

      <CategoriesSection
        categories={categories}
        templates={templates}
        canWrite={canWrite}
        onChanged={fetchCategories}
      />

      <TemplateDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
        template={editingTemplate}
        categories={categories}
      />

      <ConfirmDialog
        open={!!deletingTemplate}
        title="Delete Template"
        message={`Delete "${deletingTemplate?.name ?? ''}"? Incidents already filed with this template keep it; it will no longer be offered for new incidents.`}
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeletingTemplate(null)}
      />
    </PageContainer>
  );
};

export default TemplateList;