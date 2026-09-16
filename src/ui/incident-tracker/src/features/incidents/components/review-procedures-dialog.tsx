import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Typography,
} from '@mui/material';
import { TrespassProceduresChecklist } from './trespass-procedures-checklist';
import { trespassProceduresApi } from '../../../api/trespass-procedures';
import {
  isTrespassProceduresComplete,
  type ProcedureState,
} from '../../../shared/utils/trespass-procedures';
import type { TrespassProcedureItem } from '../../../types';

/** One trespass on the incident awaiting a procedure checklist. */
export interface TrespassNeedingProcedures {
  banId: number;
  patronName: string;
}

interface ReviewProceduresDialogProps {
  open: boolean;
  trespasses: TrespassNeedingProcedures[];
  submitting: boolean;
  onCancel: () => void;
  /** Confirmed checklists keyed by ban id (string), ready for createReview. */
  onConfirm: (proceduresByBan: Record<string, ProcedureState>) => void;
}

/**
 * Shown at the first review submission of an incident that has trespass
 * ban(s), to capture the required procedure checklist per trespass. Mirrors
 * the backend gate in review.rs: confirm is disabled until every trespass's
 * required steps are complete.
 */
export const ReviewProceduresDialog: React.FC<ReviewProceduresDialogProps> = ({
  open,
  trespasses,
  submitting,
  onCancel,
  onConfirm,
}) => {
  const [items, setItems] = useState<TrespassProcedureItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stateByBan, setStateByBan] = useState<Record<string, ProcedureState>>({});

  // Load the active checklist once the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setItems(null);
    setLoadError(null);
    trespassProceduresApi.list().then(
      (list) => !cancelled && setItems(list),
      () => !cancelled && setLoadError('Could not load the trespass procedure checklist.'),
    );
    // Reset checklist state each time the dialog opens.
    setStateByBan(Object.fromEntries(trespasses.map((t) => [String(t.banId), {}])));
    return () => {
      cancelled = true;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeItems = items ?? [];
  const allComplete = useMemo(
    () =>
      trespasses.every((t) =>
        isTrespassProceduresComplete(activeItems, stateByBan[String(t.banId)] ?? {}),
      ),
    [trespasses, activeItems, stateByBan],
  );

  const setBanState = (banId: number, next: ProcedureState) =>
    setStateByBan((prev) => ({ ...prev, [String(banId)]: next }));

  return (
    <Dialog open={open} onClose={submitting ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Confirm trespass procedures</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Before this incident goes for review, confirm the required steps were
          completed for {trespasses.length > 1 ? 'each trespass' : 'the trespass'}.
        </DialogContentText>

        {items === null && !loadError && (
          <CircularProgress size={28} sx={{ display: 'block', mx: 'auto', my: 3 }} />
        )}
        {loadError && <Alert severity="error">{loadError}</Alert>}

        {items !== null &&
          !loadError &&
          trespasses.map((t, i) => (
            <React.Fragment key={t.banId}>
              {i > 0 && <Divider sx={{ my: 2 }} />}
              {trespasses.length > 1 && (
                <Typography variant="subtitle2" sx={{ mt: i > 0 ? 0 : 1 }}>
                  {t.patronName}
                </Typography>
              )}
              <TrespassProceduresChecklist
                items={activeItems}
                state={stateByBan[String(t.banId)] ?? {}}
                onChange={(next) => setBanState(t.banId, next)}
                embedded
              />
            </React.Fragment>
          ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => onConfirm(stateByBan)}
          disabled={submitting || items === null || !!loadError || !allComplete}
        >
          {submitting ? 'Submitting…' : 'Submit for review'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReviewProceduresDialog;
