import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Alert,
} from '@mui/material';

export interface ExternalLinkFormData {
  id?: number;
  url: string;
  title: string;
  description: string;
}

interface ExternalLinkDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (link: ExternalLinkFormData) => void;
  onEdit?: (link: ExternalLinkFormData) => void;
  initialData?: ExternalLinkFormData | null;
  existingUrls?: string[];
}

const ExternalLinkDialog: React.FC<ExternalLinkDialogProps> = ({
  open,
  onClose,
  onAdd,
  onEdit,
  initialData = null,
  existingUrls = [],
}) => {
  const [formData, setFormData] = useState<ExternalLinkFormData>({
    url: '',
    title: '',
    description: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEditMode = !!initialData;

  useEffect(() => {
    if (open && initialData) {
      setFormData({
        url: initialData.url,
        title: initialData.title,
        description: initialData.description || '',
      });
      setErrors({});
    } else if (!open) {
      setFormData({ url: '', title: '', description: '' });
      setErrors({});
    }
  }, [open, initialData]);

  const handleInputChange = (field: keyof ExternalLinkFormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));

    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }

    // Auto-populate title from URL if title is empty
    if (field === 'url' && value && !formData.title) {
      try {
        const url = new URL(value);
        const hostname = url.hostname.replace('www.', '');
        setFormData(prev => ({
          ...prev,
          title: prev.title || hostname,
        }));
      } catch {
        // Invalid URL, ignore
      }
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.url) {
      newErrors.url = 'URL is required';
    } else {
      try {
        new URL(formData.url);
        const urlsToCheck = isEditMode
          ? existingUrls.filter(u => u !== initialData!.url)
          : existingUrls;
        if (urlsToCheck.includes(formData.url)) {
          newErrors.url = 'This URL has already been added. Each external link must have a unique URL.';
        }
      } catch {
        newErrors.url = 'Please enter a valid URL';
      }
    }

    if (!formData.title) {
      newErrors.title = 'Title is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) return;

    if (isEditMode) {
      onEdit?.({ ...formData, id: initialData!.id });
    } else {
      onAdd(formData);
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit External Link' : 'Add External Link'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Alert severity="info" sx={{ mb: 1 }}>
            Add links to external resources such as video footage, police reports, or related documents.
          </Alert>

          <TextField
            fullWidth
            required
            label="URL"
            placeholder="https://example.com/resource"
            value={formData.url}
            onChange={(e) => handleInputChange('url', e.target.value)}
            error={!!errors.url}
            helperText={errors.url}
          />

          <TextField
            fullWidth
            required
            label="Title"
            placeholder="Brief description of the link"
            value={formData.title}
            onChange={(e) => handleInputChange('title', e.target.value)}
            error={!!errors.title}
            helperText={errors.title}
          />

          <TextField
            fullWidth
            multiline
            rows={2}
            label="Description (Optional)"
            placeholder="Additional details about this link"
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" color="primary">
          {isEditMode ? 'Save Changes' : 'Add Link'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ExternalLinkDialog;
