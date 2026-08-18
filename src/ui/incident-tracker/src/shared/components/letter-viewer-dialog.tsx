import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  Tooltip,
  Alert,
} from '@mui/material';
import {
  Print as PrintIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { printLetterHtml } from '../utils/print-service';

interface LetterViewerDialogProps {
  open: boolean;
  title: string;
  content: string | null;
  onClose: () => void;
}

export const LetterViewerDialog: React.FC<LetterViewerDialogProps> = ({
  open,
  title,
  content,
  onClose,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: { minHeight: '85vh' } } }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">{title}</Typography>
          <Box display="flex" gap={1}>
            {content && (
              <Tooltip title="Print letter">
                <IconButton size="small" onClick={() => printLetterHtml(content)}>
                  <PrintIcon />
                </IconButton>
              </Tooltip>
            )}
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ px: 0, py: 2, display: 'flex', flexDirection: 'column' }}>
        {content ? (
          <iframe
            srcDoc={`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; font-src https:;"><style>body{margin:0;padding:24px;font-family:'Times New Roman',Times,serif;line-height:1.6;color:#000;}</style></head><body>${content}</body></html>`}
            style={{ width: '100%', border: 'none', display: 'block', flex: 1 }}
            title={title}
          />
        ) : (
          <Box sx={{ p: 3 }}>
            <Alert severity="info">No letter content available.</Alert>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LetterViewerDialog;
