import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import ExternalLinkDialog, { type ExternalLinkFormData } from './external-link-dialog';

interface ExternalLinksSectionProps {
  links: ExternalLinkFormData[];
  onAdd: (link: ExternalLinkFormData) => void;
  onEdit: (index: number, link: ExternalLinkFormData) => void;
  onRemove: (index: number) => void;
}

export const ExternalLinksSection: React.FC<ExternalLinksSectionProps> = ({
  links,
  onAdd,
  onEdit,
  onRemove,
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  const editingLink = editIndex !== null ? links[editIndex] ?? null : null;
  const isDialogOpen = dialogOpen || editIndex !== null;

  const handleClose = () => {
    setDialogOpen(false);
    setEditIndex(null);
  };

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        External Links
      </Typography>

      {links.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {links.map((link, index) => (
            <Box
              key={link.id ?? index}
              sx={{
                p: 1.5,
                mb: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" fontWeight="medium">
                  {link.title}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ wordBreak: 'break-all' }}
                >
                  {link.url}
                </Typography>
                {link.description && (
                  <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                    {link.description}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex' }}>
                <IconButton size="small" onClick={() => setEditIndex(index)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={() => onRemove(index)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Button
        variant="outlined"
        startIcon={<LinkIcon />}
        size="small"
        onClick={() => setDialogOpen(true)}
      >
        Add External Link
      </Button>

      <ExternalLinkDialog
        open={isDialogOpen}
        onClose={handleClose}
        onAdd={onAdd}
        onEdit={(updatedLink) => {
          if (editIndex !== null) {
            onEdit(editIndex, updatedLink);
          }
        }}
        initialData={editingLink}
        existingUrls={links.map((link) => link.url)}
      />
    </Box>
  );
};
