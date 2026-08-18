import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
} from '@mui/material';
import {
  RateReview as ReviewIcon,
} from '@mui/icons-material';
import type { Incident } from '../../../types';

interface StatisticsCardsProps {
  incidents: Incident[];
}

export const StatisticsCards: React.FC<StatisticsCardsProps> = ({ incidents }) => {
  const stats = {
    total: incidents.length,
  };

  return (
    <Box display="flex" gap={2} flexWrap="wrap" sx={{ mb: 2 }}>
      <Card sx={{ flex: '1 1 100%', minWidth: 200 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box display="flex" alignItems="center" gap={1.5}>
            <ReviewIcon color="primary" sx={{ fontSize: 24 }} />
            <Box display="flex" alignItems="baseline" gap={1}>
              <Typography variant="h5">{stats.total}</Typography>
              <Typography variant="body2" color="text.secondary">
                In Review Process
              </Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};
