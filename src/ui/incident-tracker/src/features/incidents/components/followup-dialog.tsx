import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Save as SaveIcon, Send as SendIcon } from '@mui/icons-material';
import { useToast } from '../../../contexts/toast-context';
import { incidentApi } from '../../../api';
import { getLibraryToday, getLibraryNowTime, localDateTimeToUtc } from '../../../shared/utils/date-utils';
import { useFileUpload } from '../hooks/use-file-upload';
import { AttachmentsSection } from './attachments-section';
import type { AttachmentProps } from './incident-form-step-report';

interface FollowupDialogProps {
  open: boolean;
  sourceIncidentId: number;
  sourceTitle?: string;
  /** Review chain state at the source's org unit, where the follow-up lands. */
  hasReviewChain: boolean | null;
  onClose: () => void;
  onCreated: (incidentId: number, message: string) => void;
}

/**
 * Streamlined create for a follow-up incident.
 *
 * Location, title, templates and involved parties come from the source
 * incident (copied server-side), so only the narrative, when it happened
 * and attachments are asked for here. Follow-ups never get bans or
 * trespasses, which is why there is no ban step.
 */
export const FollowupDialog: React.FC<FollowupDialogProps> = ({
  open,
  sourceIncidentId,
  sourceTitle,
  hasReviewChain,
  onClose,
  onCreated,
}) => {
  const { showSuccess, showError } = useToast();
  const fileUpload = useFileUpload({ showError, showSuccess });
  const { setUploadedFiles } = fileUpload;

  const [description, setDescription] = useState('');
  const [occurredDate, setOccurredDate] = useState('');
  const [occurredTime, setOccurredTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDescription('');
    setOccurredDate(getLibraryToday());
    setOccurredTime(getLibraryNowTime());
    setUploadedFiles([]);
    setError(null);
  }, [open, setUploadedFiles]);

  const attachment: AttachmentProps = {
    files: fileUpload.uploadedFiles,
    isUploading: fileUpload.isUploadingFiles,
    progress: fileUpload.uploadProgress,
    maxFiles: fileUpload.maxFiles,
    onUpload: fileUpload.handleFileUpload,
    onRemove: fileUpload.removeAttachment,
  };

  const busy = saving || fileUpload.isUploadingFiles;
  const canSave = description.trim().length > 0 && !!occurredDate && !!occurredTime && !busy;

  const handleSave = async (submitForReview: boolean) => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    let createdId: number | null = null;
    try {
      const result = await incidentApi.createFollowup({
        source_incident_id: sourceIncidentId,
        description: description.trim(),
        occurred_at: localDateTimeToUtc(occurredDate, occurredTime),
        attachment_file_upload_ids: fileUpload.uploadedFiles
          .map((f) => f.uuid)
          .filter((uuid) => !!uuid),
      });
      createdId = result.id;

      if (submitForReview) {
        await incidentApi.createReview(createdId, 'submitted', 'Initial submission for review');
        onCreated(createdId, `Follow-up incident #${createdId} created and submitted for review`);
      } else {
        onCreated(createdId, `Follow-up incident #${createdId} saved as a draft`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create follow-up';
      if (createdId !== null) {
        // The incident exists; only the review submission failed. Send
        // the user to it rather than leaving them able to create a
        // duplicate.
        showError(`Follow-up #${createdId} was saved as a draft, but submitting it failed: ${message}`);
        onCreated(createdId, `Follow-up incident #${createdId} saved as a draft`);
      } else {
        setError(message);
        showError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Follow-up to Incident #{sourceIncidentId}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Alert severity="info">
            {sourceTitle ? <><strong>{sourceTitle}</strong>. </> : null}
            The location, template and involved parties are copied from the original incident.
            Bans and trespasses cannot be added to a follow-up.
          </Alert>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              When did this occur?
            </Typography>
            <Box display="flex" gap={2}>
              <TextField
                type="date"
                label="Date"
                value={occurredDate}
                onChange={(e) => setOccurredDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                required
                sx={{ flex: 1 }}
              />
              <TextField
                type="time"
                label="Time"
                value={occurredTime}
                onChange={(e) => setOccurredTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                required
                sx={{ flex: 1 }}
              />
            </Box>
          </Box>

          <TextField
            label="Narrative"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={6}
            required
            fullWidth
            placeholder="What happened since the original incident?"
          />

          <AttachmentsSection attachment={attachment} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => handleSave(false)}
          disabled={!canSave}
          startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
        >
          Save Report
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
              onClick={() => handleSave(true)}
              disabled={!canSave || hasReviewChain !== true}
              startIcon={saving ? <CircularProgress size={20} /> : <SendIcon />}
            >
              Submit for Review
            </Button>
          </span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
};
