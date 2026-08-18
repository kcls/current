import React, { useMemo } from 'react';
import {
  Typography,
  Button,
  Box,
  CircularProgress,
  Tooltip,
  Alert,
  Paper,
  Stepper,
  Step,
  StepLabel,
  Chip,
} from '@mui/material';
import {
  Save as SaveIcon,
  Send as SendIcon,
  NavigateBefore as BackIcon,
} from '@mui/icons-material';
import type { ReviewChainEntry } from '../../../types';

interface StepReviewProps {
  reviewChain: ReviewChainEntry[];
  hasReviewChain: boolean | null;
  /** Current user's uuid (matches reviewer_ids entries). */
  currentUserId: string | null;
  isAdmin: boolean;
  onBack: () => void;
  onSaveReport: () => void;
  onSubmitForReview: () => void;
  isSubmitting: boolean;
}

export const StepReview: React.FC<StepReviewProps> = ({
  reviewChain,
  hasReviewChain,
  currentUserId,
  isAdmin,
  onBack,
  onSaveReport,
  onSubmitForReview,
  isSubmitting,
}) => {
  const reviewDisabled = isSubmitting || hasReviewChain !== true;
  const sortedChain = [...reviewChain].sort((a, b) => a.review_level - b.review_level);

  const userChainEntry = useMemo(() => {
    if (!currentUserId) return null;
    return sortedChain.find(entry =>
      entry.reviewer_ids?.includes(currentUserId)
    ) ?? null;
  }, [sortedChain, currentUserId]);

  const isUserInChain = userChainEntry !== null;
  const isUserFinalReviewer = userChainEntry?.is_final ?? false;
  const willAutoResolve = isAdmin || isUserFinalReviewer;

  // Build annotated reviewer names: append "(You)" to the current user
  const getAnnotatedNames = (entry: ReviewChainEntry): string[] => {
    if (!entry.reviewer_names || !entry.reviewer_ids || !currentUserId) {
      return entry.reviewer_names ?? [];
    }
    return entry.reviewer_names.map((name, i) =>
      entry.reviewer_ids![i] === currentUserId ? `${name} (You)` : name
    );
  };

  const isUserAtLevel = (entry: ReviewChainEntry): boolean => {
    if (!currentUserId || !entry.reviewer_ids) return false;
    return entry.reviewer_ids.includes(currentUserId);
  };

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Your incident report is ready. You can <strong>save the report</strong> to keep it on
        record, or <strong>submit for review</strong> to route it through your location's review
        chain and notify reviewers.
      </Typography>

      {hasReviewChain === false && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This location has no review process configured. Contact an administrator to set up the
          review process.
        </Alert>
      )}

      {sortedChain.length > 0 && (
        <Paper
          variant="outlined"
          sx={{ mb: 3, p: 2.5, borderRadius: 2, bgcolor: 'action.hover' }}
        >
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Review Chain
          </Typography>
          <Stepper orientation="vertical" activeStep={-1} sx={{ pl: 1 }}>
            {sortedChain.map((entry, index) => {
              const atThisLevel = isUserAtLevel(entry);
              const userLevel = userChainEntry?.review_level ?? 0;
              const belowUserLevel = isUserInChain && !willAutoResolve && entry.review_level < userLevel;
              const atUserLevelNoPeer = atThisLevel && !entry.is_final && !entry.require_peer_review && !isAdmin;
              const autoSkipped = willAutoResolve || belowUserLevel || atUserLevelNoPeer;
              const peerReview = atThisLevel && !entry.is_final && entry.require_peer_review && !isAdmin;
              const annotatedNames = getAnnotatedNames(entry);
              const levelLabel = `Level ${index + 1}${entry.is_final ? ' · Resolver' : ''}`;
              const namesLabel = annotatedNames.join(', ');

              return (
                <Step
                  key={entry.id}
                  completed={false}
                  sx={autoSkipped ? { opacity: 0.55 } : undefined}
                >
                  <StepLabel
                    sx={autoSkipped ? { '& .MuiStepLabel-label': { textDecoration: 'line-through' } } : undefined}
                    optional={
                      annotatedNames.length > 0 || peerReview ? (
                        <>
                          {annotatedNames.length > 0 && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={autoSkipped ? { textDecoration: 'line-through' } : undefined}
                            >
                              {namesLabel}
                            </Typography>
                          )}
                          {peerReview && (
                            <Chip
                              label="Peer review required"
                              size="small"
                              color="warning"
                              variant="outlined"
                              sx={{ ml: annotatedNames.length > 0 ? 1 : 0, height: 20, fontSize: '0.7rem' }}
                            />
                          )}
                        </>
                      ) : undefined
                    }
                  >
                    {levelLabel}
                  </StepLabel>
                </Step>
              );
            })}
          </Stepper>
        </Paper>
      )}

      <Box display="flex" gap={2} mt={4}>
        <Button variant="outlined" onClick={onBack} startIcon={<BackIcon />}>
          Back
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          color="primary"
          onClick={onSaveReport}
          disabled={isSubmitting}
          startIcon={isSubmitting ? <CircularProgress size={20} /> : <SaveIcon />}
        >
          {isSubmitting ? 'Saving...' : 'Save Report'}
        </Button>
        <Tooltip
          title={
            hasReviewChain === false
              ? 'This location has no review process configured. Contact an administrator to set up the review process.'
              : ''
          }
        >
          <span>
            <Button
              variant="contained"
              color="success"
              onClick={onSubmitForReview}
              disabled={reviewDisabled}
              startIcon={isSubmitting ? <CircularProgress size={20} /> : <SendIcon />}
            >
              {isSubmitting ? 'Submitting...' : 'Submit for Review'}
            </Button>
          </span>
        </Tooltip>
      </Box>
    </>
  );
};

export default StepReview;
