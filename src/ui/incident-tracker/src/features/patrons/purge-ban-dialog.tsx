import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { bansApi } from '../../api/bans';
import { useToast } from '../../contexts/toast-context';
import { formatBanDate } from '../../shared/utils/date-utils';

interface PurgeBanDialogProps {
  open: boolean;
  ban: {
    id: number;
    is_trespass?: boolean;
    patron_name?: string;
    org_unit_name?: string;
    lifts_at?: string;
  };
  onClose: () => void;
  /** Called after a successful purge — the ban no longer exists. */
  onSuccess: () => void;
}

export const PurgeBanDialog: React.FC<PurgeBanDialogProps> = ({
  open,
  ban,
  onClose,
  onSuccess,
}) => {
  const { showSuccess, showError } = useToast();
  const [comments, setComments] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [processing, setProcessing] = useState(false);

  const typeLabel = ban.is_trespass ? 'Trespass' : 'Ban';
  const isConfirmed = confirmText === 'PURGE';

  const handleSubmit = async () => {
    if (!isConfirmed) return;
    setProcessing(true);
    try {
      await bansApi.purgeBan({
        ban_id: ban.id,
        comments: comments || undefined,
      });
      showSuccess(`${typeLabel} #${ban.id} has been permanently deleted.`);
      onSuccess();
      onClose();
    } catch (error: any) {
      showError(error.message || 'Failed to delete');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !processing && onClose()}
      maxWidth="sm"
      fullWidth
      slotProps={{
        transition: {
          onExited: () => {
            setComments('');
            setConfirmText('');
          },
        },
      }}
    >
      <DialogTitle>Delete {typeLabel} Permanently</DialogTitle>
      <DialogContent>
        <Alert severity="error" sx={{ mb: 2 }}>
          This permanently deletes the {typeLabel.toLowerCase()}, including its
          generated letters and its entire activity history. Unlike archiving,
          this cannot be undone.
        </Alert>
        <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 1.5, mb: 2.5 }}>
          <Typography variant="body2" fontWeight={600}>
            {typeLabel} #{ban.id} · {ban.patron_name || 'Unknown patron'}
            {ban.org_unit_name ? ` · ${ban.org_unit_name}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {ban.lifts_at ? `Lift date: ${formatBanDate(ban.lifts_at)}` : 'No lift date'}
          </Typography>
        </Box>
        <TextField
          label="Reason (kept in the audit log)"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          size="small"
          fullWidth
          multiline
          rows={2}
          sx={{ mb: 2.5 }}
        />
        <Typography variant="body2" sx={{ mb: 1 }}>
          Type <strong>PURGE</strong> to confirm:
        </Typography>
        <TextField
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
          size="small"
          fullWidth
          placeholder="PURGE"
          error={confirmText.length > 0 && !isConfirmed}
          helperText={confirmText.length > 0 && !isConfirmed ? 'Must type exactly "PURGE"' : ' '}
          slotProps={{ htmlInput: { 'data-testid': 'purge-confirm-input' } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={processing}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          color="error"
          disabled={!isConfirmed || processing}
          startIcon={processing ? <CircularProgress size={16} /> : undefined}
          data-testid="purge-confirm-button"
        >
          Delete {typeLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PurgeBanDialog;
