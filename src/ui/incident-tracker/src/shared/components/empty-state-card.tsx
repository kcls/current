import React from 'react';
import { Paper, Typography, Button } from '@mui/material';
import { SvgIconComponent } from '@mui/icons-material';

interface EmptyStateCardProps {
  icon: SvgIconComponent;
  iconColor?: 'inherit' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' | 'disabled' | 'action';
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

const EmptyStateCard: React.FC<EmptyStateCardProps> = ({
  icon: Icon,
  iconColor = 'disabled',
  title,
  description,
  actionLabel,
  onAction,
}) => {
  return (
    <Paper
      sx={{
        p: 6,
        textAlign: 'center',
        maxWidth: 500,
        mx: 'auto',
        mt: 4,
      }}
    >
      <Icon
        sx={{
          fontSize: 80,
          color: iconColor === 'disabled' ? 'text.secondary' : `${iconColor}.main`,
          mb: 2,
        }}
      />
      <Typography variant="h5" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: actionLabel ? 3 : 0 }}>
        {description}
      </Typography>
      {actionLabel && onAction && (
        <Button variant="contained" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Paper>
  );
};

export default EmptyStateCard;
