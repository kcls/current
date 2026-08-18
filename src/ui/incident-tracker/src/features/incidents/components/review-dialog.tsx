import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  Box,
  Typography,
  Divider,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
} from '@mui/material';
import type { Incident } from '../../../types';
import { useDialogData } from '../../../shared/hooks/use-dialog-data';

export type ReviewResult = 'submitted' | 'approved' | 'approved-with-edits' | 'returned' | 'deleted' | 'resolved';

interface ReviewDialogProps {
  incident: Incident | null;
  action: 'approve' | 'request_changes' | null;
  reviewLevel?: number | null;
  isFinalReview?: boolean;
  reviewCount?: number;
  latestReviewResult?: string;
  onClose: () => void;
  onConfirm: (result: ReviewResult, comments: string) => Promise<void>;
}

export const ReviewDialog: React.FC<ReviewDialogProps> = ({
  incident: incidentProp,
  action,
  reviewLevel,
  isFinalReview = false,
  reviewCount = 0,
  latestReviewResult,
  onClose,
  onConfirm,
}) => {
  const [comments, setComments] = useState('');
  const [reviewResult, setReviewResult] = useState<ReviewResult>('approved');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: incident, open, onExited } = useDialogData(incidentProp);

  const isLevel4 = isFinalReview;
  const canReturn = reviewCount > 0 && latestReviewResult !== 'returned';

  React.useEffect(() => {
    if (action === 'approve') {
      setReviewResult(isLevel4 ? 'resolved' : 'approved');
    } else if (action === 'request_changes') {
      setReviewResult('returned');
    }
  }, [action, isLevel4]);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(reviewResult, comments);
      setComments('');
      setReviewResult(isLevel4 ? 'resolved' : 'approved');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setComments('');
    setReviewResult(isLevel4 ? 'resolved' : 'approved');
    onClose();
  };

  const getDialogTitle = (): string => {
    if (isLevel4) {
      return action === 'request_changes' ? 'Return Incident' : 'Complete Incident Review';
    }
    return action === 'approve' ? 'Approve Incident' : 'Request Changes';
  };

  const getResultLabel = (result: ReviewResult): string => {
    switch (result) {
      case 'approved': return 'Approve (Forward to Next Level)';
      case 'approved-with-edits': return 'Approve with Edits';
      case 'returned': return 'Return for Changes';
      case 'deleted': return 'Delete Incident';
      case 'resolved': return 'Mark Review Complete';
      default: return result;
    }
  };

  const getResultDescription = (result: ReviewResult): string => {
    switch (result) {
      case 'approved': return 'Approve and forward to the next review level';
      case 'approved-with-edits': return 'Approve and forward with edits already made by reviewer';
      case 'returned': return 'Send back to the submitter for changes';
      case 'deleted': return 'Delete this incident (cannot be undone)';
      case 'resolved': return 'Mark this incident review as complete';
      default: return '';
    }
  };

  const requiresComments = reviewResult === 'returned' || reviewResult === 'deleted';

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      TransitionProps={{ onExited }}
    >
      <DialogTitle>
        {getDialogTitle()}
      </DialogTitle>
      <DialogContent>
        {incident && (
          <>
            <Box mb={2}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Incident:
              </Typography>
              <Typography variant="h6">Incident #{incident.id}</Typography>
            </Box>

            <Box mb={2}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Title:
              </Typography>
              <Typography variant="body1">
                {incident.title || 'Untitled Incident'}
              </Typography>
            </Box>

            <Box mb={2}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Description:
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {incident.description}
              </Typography>
            </Box>

            <Divider sx={{ my: 2 }} />

            <FormControl component="fieldset" sx={{ mb: 2, width: '100%' }}>
              <FormLabel component="legend" sx={{ mb: 1, fontWeight: 600 }}>
                Review Decision
              </FormLabel>
              <RadioGroup
                value={reviewResult}
                onChange={(e) => setReviewResult(e.target.value as ReviewResult)}
              >
                {/* Level 4 shows "resolved" option, others show "approved" */}
                {isLevel4 ? (
                  <FormControlLabel
                    value="resolved"
                    control={<Radio />}
                    label={
                      <Box>
                        <Typography variant="body1">{getResultLabel('resolved')}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {getResultDescription('resolved')}
                        </Typography>
                      </Box>
                    }
                  />
                ) : (
                  <>
                    <FormControlLabel
                      value="approved"
                      control={<Radio />}
                      label={
                        <Box>
                          <Typography variant="body1">{getResultLabel('approved')}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {getResultDescription('approved')}
                          </Typography>
                        </Box>
                      }
                    />
                    <FormControlLabel
                      value="approved-with-edits"
                      control={<Radio />}
                      label={
                        <Box>
                          <Typography variant="body1">{getResultLabel('approved-with-edits')}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {getResultDescription('approved-with-edits')}
                          </Typography>
                        </Box>
                      }
                    />
                  </>
                )}
                {canReturn && (
                  <FormControlLabel
                    value="returned"
                    control={<Radio />}
                    label={
                      <Box>
                        <Typography variant="body1">{getResultLabel('returned')}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {getResultDescription('returned')}
                        </Typography>
                      </Box>
                    }
                  />
                )}
                <FormControlLabel
                  value="deleted"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body1">{getResultLabel('deleted')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {getResultDescription('deleted')}
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </FormControl>

            <Alert
              severity={
                reviewResult === 'deleted' ? 'error' :
                reviewResult === 'returned' ? 'warning' :
                'success'
              }
              sx={{ mb: 2 }}
            >
              {getResultDescription(reviewResult)}
            </Alert>

            <TextField
              fullWidth
              multiline
              rows={4}
              label="Review Comments"
              placeholder={
                requiresComments
                  ? 'Please provide details...'
                  : 'Optional comments about this review...'
              }
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              required={requiresComments}
              error={requiresComments && !comments.trim()}
              helperText={
                requiresComments && !comments.trim()
                  ? 'Comments are required for this action'
                  : ''
              }
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={
            isSubmitting ||
            (requiresComments && !comments.trim())
          }
          color={
            reviewResult === 'deleted' ? 'error' :
            reviewResult === 'returned' ? 'warning' :
            'success'
          }
        >
          {isSubmitting ? 'Processing...' : 'Confirm'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
