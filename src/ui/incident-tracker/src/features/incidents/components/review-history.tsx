import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  CircularProgress,
  Alert,
} from '@mui/material';
import Timeline from '@mui/lab/Timeline';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineOppositeContent from '@mui/lab/TimelineOppositeContent';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { incidentApi } from '../../../api';
import { formatDisplayTime } from '../../../shared/utils/date-utils';

interface Review {
  id: number;
  incident: number;
  reviewed_by: string;
  reviewer_name: string;
  result: string;
  min_review_level: number;
  comments: string | null;
  reviewed_at: string;
}

interface ReviewChainLevel {
  review_level: number;
  is_final: boolean;
  reviewer_group: number;
  reviewer_ids?: string[];
  reviewer_names?: string[];
  require_peer_review?: boolean;
}

interface ReviewHistoryProps {
  incidentId: number;
  incidentStatus?: 'draft' | 'pending' | 'resolved' | 'deleted';
  reviewChain?: ReviewChainLevel[];
  onReviewsLoaded?: (reviews: Review[]) => void;
  createdBy?: string;
}

const ReviewHistory: React.FC<ReviewHistoryProps> = ({
  incidentId,
  incidentStatus,
  reviewChain,
  onReviewsLoaded,
  createdBy,
}) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReviews = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await incidentApi.getReviews(incidentId);
      const sorted = data.sort((a: Review, b: Review) => {
        const timeDiff = new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime();
        return timeDiff !== 0 ? timeDiff : b.id - a.id;
      });
      setReviews(sorted);
      onReviewsLoaded?.(sorted);
    } catch (err: any) {
      setError(err.message || 'Failed to load review history');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  const getResultIcon = (result: string) => {
    switch (result) {
      case 'approved':
        return <CheckCircleIcon />;
      case 'approved-with-edits':
        return <EditIcon />;
      case 'returned':
        return <CancelIcon />;
      case 'deleted':
        return <DeleteIcon />;
      case 'resolved':
        return <CheckCircleIcon />;
      case 'reopened':
        return <RefreshIcon />;
      default:
        return <CheckCircleIcon />;
    }
  };

  const getTimelineDotColor = (result: string): 'success' | 'warning' | 'error' | 'info' | 'grey' => {
    switch (result) {
      case 'submitted':
        return 'success';
      case 'approved':
        return 'success';
      case 'approved-with-edits':
        return 'success';
      case 'returned':
        return 'warning';
      case 'deleted':
        return 'error';
      case 'resolved':
        return 'success';
      case 'reopened':
        return 'info';
      default:
        return 'grey';
    }
  };

  const getChipColor = (result: string): 'success' | 'warning' | 'error' | 'info' | 'default' => {
    switch (result) {
      case 'submitted':
        return 'success';
      case 'approved':
        return 'success';
      case 'approved-with-edits':
        return 'success';
      case 'returned':
        return 'warning';
      case 'deleted':
        return 'error';
      case 'resolved':
        return 'success';
      case 'reopened':
        return 'info';
      default:
        return 'default';
    }
  };

  const getResultLabel = (result: string): string => {
    switch (result) {
      case 'submitted':
        return 'Submitted';
      case 'approved':
        return 'Approved';
      case 'approved-with-edits':
        return 'Approved with Edits';
      case 'returned':
        return 'Returned';
      case 'deleted':
        return 'Deleted';
      case 'resolved':
        return 'Complete';
      case 'reopened':
        return 'Reopened';
      default:
        return result;
    }
  };

  const getActionLabel = (result: string): string => {
    switch (result) {
      case 'submitted':
        return 'Submitted by:';
      case 'approved':
      case 'approved-with-edits':
        return 'Approved by:';
      case 'returned':
        return 'Returned by:';
      case 'deleted':
        return 'Deleted by:';
      case 'resolved':
        return 'Review completed by:';
      case 'reopened':
        return 'Reopened by:';
      default:
        return 'By:';
    }
  };

  const getReviewerLabelForLevel = (level: number): string => {
    if (reviewChain && reviewChain.length > 0) {
      const chainLevel = reviewChain.find(c => c.review_level === level);
      if (chainLevel?.reviewer_names && chainLevel.reviewer_names.length > 0) {
        // When peer review is on, exclude the incident creator from the awaiting list
        const names = chainLevel.require_peer_review && createdBy != null && chainLevel.reviewer_ids
          ? chainLevel.reviewer_names.filter((_, i) => chainLevel.reviewer_ids![i] !== createdBy)
          : chainLevel.reviewer_names;
        if (names.length > 0) return names.join(', ');
      }
    }
    return `Level ${level} Reviewer`;
  };

  const getPendingMessage = (nextLevel: number, isReturned: boolean): string => {
    if (isReturned) {
      return 'Awaiting resubmission from Reporter';
    }
    return `Awaiting review from ${getReviewerLabelForLevel(nextLevel)}`;
  };

  const shouldShowPendingIndicator = (): boolean => {
    if (reviews.length === 0) return false;
    if (incidentStatus === 'resolved' || incidentStatus === 'deleted') return false;

    const latestReview = reviews[0]!;
    const result = latestReview.result;

    return ['submitted', 'approved', 'approved-with-edits', 'returned', 'reopened'].includes(result);
  };

  const getNextLevel = (): number => {
    if (reviews.length === 0) return 1;
    const latestReview = reviews[0]!;

    // min_review_level already represents the next level to review
    return latestReview.min_review_level;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="center" alignItems="center" py={4}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <Alert severity="error">{error}</Alert>
        </CardContent>
      </Card>
    );
  }

  if (reviews.length === 0) {
    return (
      <Card>
        <CardContent>
          <Alert severity="info">
            No reviews yet. This incident has not been reviewed.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Review History
        </Typography>
        <Timeline position="right" sx={{ padding: 0 }}>
          {shouldShowPendingIndicator() && (
            <TimelineItem>
              <TimelineOppositeContent sx={{ display: 'none' }} />
              <TimelineSeparator>
                <TimelineDot color="grey">
                  <CheckCircleIcon />
                </TimelineDot>
                <TimelineConnector />
              </TimelineSeparator>
              <TimelineContent>
                <Box mb={2}>
                  <Box display="flex" gap={1} alignItems="center" mb={0.5} flexWrap="wrap">
                    <Chip
                      label="Pending"
                      color="default"
                      size="small"
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                    {getPendingMessage(getNextLevel(), reviews[0]?.result === 'returned')}
                  </Typography>
                </Box>
              </TimelineContent>
            </TimelineItem>
          )}

          {reviews.map((review, index) => (
            <TimelineItem key={review.id}>
              <TimelineOppositeContent sx={{ display: 'none' }} />
              <TimelineSeparator>
                <TimelineDot color={getTimelineDotColor(review.result)}>
                  {getResultIcon(review.result)}
                </TimelineDot>
                {index < reviews.length - 1 && <TimelineConnector />}
              </TimelineSeparator>
              <TimelineContent>
                <Box mb={2}>
                  <Box display="flex" gap={1} alignItems="center" mb={0.5} flexWrap="wrap">
                    <Chip
                      label={getResultLabel(review.result)}
                      color={getChipColor(review.result)}
                      size="small"
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                      {new Date(review.reviewed_at).toLocaleDateString()} {formatDisplayTime(review.reviewed_at)}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {getActionLabel(review.result)} <strong>{review.reviewer_name}</strong>
                  </Typography>
                  {review.comments && (
                    <Box
                      mt={1}
                      p={1.5}
                      sx={{
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {review.comments}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </TimelineContent>
            </TimelineItem>
          ))}
        </Timeline>
      </CardContent>
    </Card>
  );
};

export default ReviewHistory;
