import React, { ReactNode } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  loading?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmColor = 'primary',
  loading = false,
  disabled = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onCancel}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      slotProps={{
        paper: {
          sx: {
            borderRadius: 2,
            minWidth: 360,
          },
        },
      }}
    >
      <DialogTitle id="confirm-dialog-title" sx={{ pb: 1 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        {children ?? (
          <DialogContentText id="confirm-dialog-description">
            {message}
          </DialogContentText>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} variant="outlined" disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color={confirmColor}
          disabled={loading || disabled}
          autoFocus
        >
          {loading ? 'Processing...' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
