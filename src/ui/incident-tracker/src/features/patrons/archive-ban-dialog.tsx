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
  CircularProgress,
} from '@mui/material';
import { bansApi } from '../../api/bans';
import { useToast } from '../../contexts/toast-context';
import { formatBanDate } from '../../shared/utils/date-utils';

interface ArchiveBanDialogProps {
  open: boolean;
  ban: {
    id: number;
    is_trespass?: boolean;
    patron_name?: string;
    org_unit_name?: string;
    lifts_at?: string;
  };
  onClose: () => void;
  onSuccess: () => void;
}

export const ArchiveBanDialog: React.FC<ArchiveBanDialogProps> = ({
  open,
  ban,
  onClose,
  onSuccess,
}) => {
  const { showSuccess, showError } = useToast();
  const [comments, setComments] = useState('');
  const [processing, setProcessing] = useState(false);

  const typeLabel = ban.is_trespass ? 'Trespass' : 'Ban';

  const handleSubmit = async () => {
    setProcessing(true);
    try {
      await bansApi.archiveBan({
        ban_id: ban.id,
        comments: comments || undefined,
      });
      showSuccess(`${typeLabel} has been archived.`);
      onSuccess();
      onClose();
    } catch (error: any) {
      showError(error.message || 'Failed to archive');
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
      slotProps={{ transition: { onExited: () => setComments('') } }}
    >
      <DialogTitle>Archive {typeLabel}</DialogTitle>
      <DialogContent>
        <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 1.5, mb: 2.5 }}>
          <Typography variant="body2" fontWeight={600}>
            {ban.patron_name || 'Unknown patron'}
            {ban.org_unit_name ? ` · ${ban.org_unit_name}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {ban.lifts_at ? `Lift date: ${formatBanDate(ban.lifts_at)}` : 'No lift date'}
          </Typography>
        </Box>
        <TextField
          label="Internal Comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          size="small"
          fullWidth
          multiline
          rows={2}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={processing}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          color="success"
          disabled={processing}
          startIcon={processing ? <CircularProgress size={16} /> : undefined}
        >
          Archive {typeLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ArchiveBanDialog;
