import React, { useMemo, useState } from 'react';
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
  Button,
  Tooltip,
  TableContainer,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import type { Category, IncidentTemplate } from '../../../types';
import { useToast } from '../../../contexts/toast-context';
import CategoryDialog from './category-dialog';

interface CategoriesSectionProps {
  categories: Category[];
  templates: IncidentTemplate[];
  canWrite: boolean;
  onChanged: () => void;
}

// Categories can't be deleted (templates reference them by code), so the
// only way to retire one is to mark it inactive.
const CategoriesSection: React.FC<CategoriesSectionProps> = ({
  categories,
  templates,
  canWrite,
  onChanged,
}) => {
  const { showSuccess } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  const templateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates) {
      counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    }
    return counts;
  }, [templates]);

  const openDialog = (category: Category | null) => {
    setEditingCategory(category);
    setDialogOpen(true);
  };

  const handleSaved = (category: Category) => {
    showSuccess(`Category "${category.label}" saved`);
    onChanged();
  };

  return (
    <Box mt={4}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" component="h2">Categories</Typography>
        {canWrite && (
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => openDialog(null)}>
            New Category
          </Button>
        )}
      </Box>

      <TableContainer component={Paper}>
        <Table sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell>Category</TableCell>
              <TableCell width="160px">Code</TableCell>
              <TableCell width="110px" align="right">Templates</TableCell>
              <TableCell width="90px" align="right">Order</TableCell>
              <TableCell width="120px">Status</TableCell>
              {canWrite && <TableCell width="80px" align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 6 : 5} align="center">
                  <Typography color="text.secondary" py={3}>
                    No categories found
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              categories.map((category) => (
                <TableRow key={category.code} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      {category.icon && <span aria-hidden>{category.icon} </span>}
                      {category.label}
                    </Typography>
                    {category.description && (
                      <Typography variant="caption" color="text.secondary">
                        {category.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace">
                      {category.code}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{templateCounts.get(category.code) ?? 0}</TableCell>
                  <TableCell align="right">{category.display_order ?? 0}</TableCell>
                  <TableCell>
                    <Chip
                      label={category.is_active !== false ? 'Active' : 'Inactive'}
                      color={category.is_active !== false ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  {canWrite && (
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openDialog(category)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <CategoryDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
        category={editingCategory}
      />
    </Box>
  );
};

export default CategoriesSection;
