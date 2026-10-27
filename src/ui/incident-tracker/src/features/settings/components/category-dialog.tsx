import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  FormControlLabel,
  Switch,
  Alert,
} from '@mui/material';
import { categoryApi, type CategoryInput } from '../../../api/categories';
import type { Category } from '../../../types';

interface CategoryDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (category: Category) => void;
  /** Category to edit; null to create a new one */
  category: Category | null;
}

// Mirrors the server's checks so most mistakes are caught before saving
const CODE_PATTERN = /^[a-z0-9_]{1,50}$/;
const LABEL_MAX_LENGTH = 100;
const ICON_MAX_LENGTH = 10;

const emptyForm = (): CategoryInput => ({
  code: '',
  label: '',
  description: '',
  icon: '',
  display_order: 0,
  is_active: true,
});

/** Suggest a code from a label: "After Hours" -> "after_hours" */
export const codeFromLabel = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

const CategoryDialog: React.FC<CategoryDialogProps> = ({
  open,
  onClose,
  onSaved,
  category,
}) => {
  const [formData, setFormData] = useState<CategoryInput>(emptyForm);
  // Once the code is typed by hand, stop deriving it from the label
  const [codeEdited, setCodeEdited] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof CategoryInput, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEditMode = !!category;

  useEffect(() => {
    if (!open) return;
    setFormData(
      category
        ? {
            code: category.code,
            label: category.label,
            description: category.description || '',
            icon: category.icon || '',
            display_order: category.display_order ?? 0,
            is_active: category.is_active !== false,
          }
        : emptyForm()
    );
    setCodeEdited(false);
    setErrors({});
    setSaveError(null);
  }, [open, category]);

  const handleChange = <K extends keyof CategoryInput>(field: K, value: CategoryInput[K]) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'label' && !isEditMode && !codeEdited) {
        next.code = codeFromLabel(value as string);
      }
      return next;
    });
    if (field === 'code') setCodeEdited(true);
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    if (!formData.label.trim()) {
      newErrors.label = 'Label is required';
    }
    if (!isEditMode && !CODE_PATTERN.test(formData.code)) {
      newErrors.code = 'Use 1-50 characters of a-z, 0-9 and _';
    }
    if ([...formData.icon.trim()].length > ICON_MAX_LENGTH) {
      newErrors.icon = `At most ${ICON_MAX_LENGTH} characters`;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSaving(true);
    setSaveError(null);
    try {
      const saved = isEditMode
        ? await categoryApi.update(formData)
        : await categoryApi.create(formData);
      onSaved(saved);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Category' : 'New Category'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {saveError && <Alert severity="error">{saveError}</Alert>}

          <TextField
            fullWidth
            required
            label="Label"
            value={formData.label}
            onChange={(e) => handleChange('label', e.target.value)}
            error={!!errors.label}
            helperText={errors.label}
            slotProps={{ htmlInput: { maxLength: LABEL_MAX_LENGTH } }}
          />

          <TextField
            fullWidth
            required={!isEditMode}
            disabled={isEditMode}
            label="Code"
            value={formData.code}
            onChange={(e) => handleChange('code', e.target.value)}
            error={!!errors.code}
            helperText={errors.code ?? (isEditMode
              ? 'The code cannot be changed'
              : 'Stored on templates; cannot be changed later')}
          />

          <TextField
            fullWidth
            multiline
            rows={2}
            label="Description"
            value={formData.description}
            onChange={(e) => handleChange('description', e.target.value)}
          />

          <Box display="flex" gap={2}>
            <TextField
              label="Icon"
              value={formData.icon}
              onChange={(e) => handleChange('icon', e.target.value)}
              error={!!errors.icon}
              helperText={errors.icon ?? 'Optional, e.g. an emoji'}
              sx={{ flex: 1 }}
            />
            <TextField
              type="number"
              label="Display order"
              value={formData.display_order}
              onChange={(e) => handleChange('display_order', Number(e.target.value) || 0)}
              sx={{ flex: 1 }}
            />
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={formData.is_active}
                onChange={(e) => handleChange('is_active', e.target.checked)}
              />
            }
            label="Active"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CategoryDialog;
