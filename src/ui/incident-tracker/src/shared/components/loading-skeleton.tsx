import React from 'react';
import { Skeleton, Box, Card, CardContent, Grid } from '@mui/material';

interface LoadingSkeletonProps {
  variant?: 'table' | 'card' | 'list' | 'form' | 'dashboard' | 'stats' | 'text' | 'custom';
  rows?: number;
  height?: number | string;
  width?: number | string;
  animation?: 'pulse' | 'wave' | false;
}

const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  variant = 'card',
  rows = 3,
  height = 60,
  width = '100%',
  animation = 'wave',
}) => {
  switch (variant) {
    case 'table':
      return (
        <Box>
          {/* Table header */}
          <Skeleton
            variant="rectangular"
            height={40}
            sx={{ mb: 1 }}
            animation={animation}
          />
          {/* Table rows */}
          {Array.from({ length: rows }).map((_, index) => (
            <Skeleton
              key={index}
              variant="rectangular"
              height={height}
              sx={{ mb: 0.5 }}
              animation={animation}
            />
          ))}
        </Box>
      );

    case 'card':
      return (
        <Card>
          <CardContent>
            <Skeleton
              variant="text"
              width="60%"
              height={32}
              sx={{ mb: 2 }}
              animation={animation}
            />
            <Skeleton variant="text" width="100%" animation={animation} />
            <Skeleton variant="text" width="100%" animation={animation} />
            <Skeleton variant="text" width="80%" animation={animation} />
          </CardContent>
        </Card>
      );

    case 'list':
      return (
        <Box>
          {Array.from({ length: rows }).map((_, index) => (
            <Box key={index} sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Skeleton
                variant="circular"
                width={40}
                height={40}
                sx={{ mr: 2 }}
                animation={animation}
              />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="70%" animation={animation} />
                <Skeleton variant="text" width="40%" animation={animation} />
              </Box>
            </Box>
          ))}
        </Box>
      );

    case 'form':
      return (
        <Box>
          {/* Form title */}
          <Skeleton
            variant="text"
            width="30%"
            height={32}
            sx={{ mb: 3 }}
            animation={animation}
          />
          {/* Form fields */}
          {Array.from({ length: rows }).map((_, index) => (
            <Box key={index} sx={{ mb: 3 }}>
              <Skeleton
                variant="text"
                width="20%"
                height={20}
                sx={{ mb: 1 }}
                animation={animation}
              />
              <Skeleton variant="rectangular" height={56} animation={animation} />
            </Box>
          ))}
          {/* Submit button */}
          <Skeleton
            variant="rectangular"
            width="30%"
            height={36}
            sx={{ mt: 4 }}
            animation={animation}
          />
        </Box>
      );

    case 'dashboard':
      return (
        <Box>
          {/* Stats cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {Array.from({ length: 4 }).map((_, index) => (
              <Grid key={index} size={{ xs: 12, sm: 6, md: 3 }}>
                <Card>
                  <CardContent>
                    <Skeleton variant="text" width="60%" animation={animation} />
                    <Skeleton
                      variant="text"
                      width="40%"
                      height={40}
                      animation={animation}
                    />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          {/* Main content area */}
          <Skeleton variant="rectangular" height={400} animation={animation} />
        </Box>
      );

    case 'stats':
      return (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Box
              key={index}
              sx={{ flex: '1 1 calc(50% - 8px)', minWidth: 120, textAlign: 'center' }}
            >
              <Skeleton
                variant="text"
                width="80%"
                height={48}
                sx={{ mx: 'auto' }}
                animation={animation}
              />
              <Skeleton
                variant="text"
                width="60%"
                sx={{ mx: 'auto' }}
                animation={animation}
              />
            </Box>
          ))}
        </Box>
      );

    case 'text':
      return (
        <Box>
          {Array.from({ length: rows }).map((_, index) => (
            <Skeleton
              key={index}
              variant="text"
              width={width}
              height={height}
              animation={animation}
            />
          ))}
        </Box>
      );

    case 'custom':
      return (
        <Skeleton
          variant="rectangular"
          width={width}
          height={height}
          animation={animation}
        />
      );

    default:
      return (
        <Skeleton
          variant="rectangular"
          width={width}
          height={height}
          animation={animation}
        />
      );
  }
};

// Specific loading components for common use cases
export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <LoadingSkeleton variant="table" rows={rows} />
);

export const CardSkeleton: React.FC = () => <LoadingSkeleton variant="card" />;

export const ListSkeleton: React.FC<{ items?: number }> = ({ items = 5 }) => (
  <LoadingSkeleton variant="list" rows={items} />
);

export const FormSkeleton: React.FC<{ fields?: number }> = ({ fields = 4 }) => (
  <LoadingSkeleton variant="form" rows={fields} />
);

export const DashboardSkeleton: React.FC = () => <LoadingSkeleton variant="dashboard" />;

export const StatsSkeleton: React.FC = () => <LoadingSkeleton variant="stats" />;

export default LoadingSkeleton;