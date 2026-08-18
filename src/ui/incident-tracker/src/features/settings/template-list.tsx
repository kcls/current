import React, { useState, useEffect, useMemo } from 'react';
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
} from '@mui/material';
import {
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { PaginatedTableContainer } from '../../shared/components/paginated-table-container';
import { useTableUrlState, useFilterUrlState } from '../../shared/hooks/use-table-url-state';
import LoadingSkeleton from '../../shared/components/loading-skeleton';

// Templates are reference data installed by the reference seed; the UI
// is read-only until the backend grows template CUD endpoints.
const TemplateList: React.FC = () => {
  const { templates, isLoading, error, fetchTemplates } = useTemplates();
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

  // Filter templates based on search and active status
  const filteredTemplates = templates.filter(template => {
    const matchesSearch =
      template.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      template.description.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      template.category.toLowerCase().includes(debouncedSearch.toLowerCase());

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
              <TableCell width="120px">Fields</TableCell>
              <TableCell width="120px">Usage</TableCell>
              <TableCell width="150px">Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedTemplates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center">
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
                      label={template.category}
                      color={getCategoryColor(template.category) as any}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {template.fields?.length || 0} fields
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {template.usage_count || 0} uses
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={template.is_active ? 'Active' : 'Inactive'}
                      color={template.is_active ? 'success' : 'default'}
                      size="small"
                      icon={template.is_active ? <VisibilityIcon /> : <VisibilityOffIcon />}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </PaginatedTableContainer>

      {/* Summary Stats */}
      <Box display="flex" gap={2} mt={2}>
        <Paper sx={{ p: 2, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Total Templates
          </Typography>
          <Typography variant="h6">{templates.length}</Typography>
        </Paper>
        <Paper sx={{ p: 2, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Active Templates
          </Typography>
          <Typography variant="h6">
            {templates.filter(t => t.is_active).length}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Most Used
          </Typography>
          <Typography variant="h6">
            {templates.reduce((max, t) => 
              (t.usage_count || 0) > (max.usage_count || 0) ? t : max, 
              templates[0] || { name: 'N/A', usage_count: 0 }
            ).name}
          </Typography>
        </Paper>
      </Box>
    </PageContainer>
  );
};

export default TemplateList;