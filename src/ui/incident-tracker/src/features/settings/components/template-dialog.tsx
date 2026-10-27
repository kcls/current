import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  MenuItem,
  FormControlLabel,
  Switch,
  Alert,
} from '@mui/material';
import { templateApi, type TemplateInput } from '../../../api/templates';
import type { IncidentTemplate } from '../../../types';

interface TemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (template: IncidentTemplate) => void;
  /** Template to edit; null to create a new one */
  template: IncidentTemplate | null;
  categories: string[];
}

const NAME_MAX_LENGTH = 255;

const emptyForm = (): TemplateInput => ({
  name: '',
  description: '',
  category: '',
  is_active: true,
  requires_patron: true,
  show_called_emergency: true,
});

const TemplateDialog: React.FC<TemplateDialogProps> = ({
  open,
  onClose,
  onSaved,
  template,
  categories,
}) => {
  const [formData, setFormData] = useState<TemplateInput>(emptyForm);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEditMode = !!template;

  useEffect(() => {
    if (!open) return;
    setFormData(
      template
        ? {
            name: template.name,
            description: template.description || '',
            category: template.category,
            is_active: template.is_active,
            requires_patron: template.requires_patron ?? true,
            show_called_emergency: template.show_called_emergency ?? true,
          }
        : emptyForm()
    );
    setNameError(null);
    setSaveError(null);
  }, [open, template]);

  const handleChange = <K extends keyof TemplateInput>(field: K, value: TemplateInput[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (field === 'name') setNameError(null);
  };

  const handleSubmit = async () => {
    const name = formData.name.trim();
    if (!name) {
      setNameError('Name is required');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      // The form definition isn't editable here; pass the existing one
      // back so the update doesn't clear it.
      const input = { ...formData, name, fields: template?.fields ?? [] };
      const saved = isEditMode
        ? await templateApi.update(Number(template!.id), input)
        : await templateApi.create(input);
      onSaved(saved);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Template' : 'New Template'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {saveError && <Alert severity="error">{saveError}</Alert>}

          <TextField
            fullWidth
            required
            label="Name"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            error={!!nameError}
            helperText={nameError}
            slotProps={{ htmlInput: { maxLength: NAME_MAX_LENGTH } }}
          />

          <TextField
            fullWidth
            multiline
            rows={2}
            label="Description"
            value={formData.description}
            onChange={(e) => handleChange('description', e.target.value)}
          />

          <TextField
            select
            fullWidth
            required
            label="Category"
            value={formData.category}
            onChange={(e) => handleChange('category', e.target.value)}
          >
            {categories.map((category) => (
              <MenuItem key={category} value={category}>
                {category}
              </MenuItem>
            ))}
          </TextField>

          <FormControlLabel
            control={
              <Switch
                checked={formData.is_active}
                onChange={(e) => handleChange('is_active', e.target.checked)}
              />
            }
            label="Active"
          />
          <FormControlLabel
            control={
              <Switch
                checked={formData.requires_patron}
                onChange={(e) => handleChange('requires_patron', e.target.checked)}
              />
            }
            label="Requires patron"
          />
          <FormControlLabel
            control={
              <Switch
                checked={formData.show_called_emergency}
                onChange={(e) => handleChange('show_called_emergency', e.target.checked)}
              />
            }
            label='Show "Called 911 or 988"'
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving || !formData.category}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TemplateDialog;
