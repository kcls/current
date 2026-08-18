import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, CircularProgress } from '@mui/material';
import { Cancel as CancelIcon } from '@mui/icons-material';

interface BanFormActionsProps {
  onSubmit: () => void;
  cancelTo: string;
  submitLabel: string;
  submitIcon: React.ReactNode;
  isSubmitting: boolean;
  disabled?: boolean;
}

export const BanFormActions: React.FC<BanFormActionsProps> = ({
  onSubmit,
  cancelTo,
  submitLabel,
  submitIcon,
  isSubmitting,
  disabled,
}) => {
  return (
    <Box display="flex" gap={2} mt={4}>
      <Button
        variant="contained"
        onClick={onSubmit}
        disabled={disabled || isSubmitting}
        startIcon={isSubmitting ? <CircularProgress size={20} /> : submitIcon}
      >
        {isSubmitting ? 'Saving...' : submitLabel}
      </Button>

      <Button
        component={RouterLink}
        to={cancelTo}
        variant="outlined"
        startIcon={<CancelIcon />}
      >
        Cancel
      </Button>
    </Box>
  );
};
