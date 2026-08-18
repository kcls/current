import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stepper,
  Step,
  StepLabel,
  Box,
  CircularProgress,
  Typography,
  IconButton,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useToast } from '../../../contexts/toast-context';
import { patronApi } from '../../../api/patrons';
import type { PatronSearchResult } from '../../../types';
import type {
  PatronMergePreview,
  PatronMergeConflictResolution,
  BanResolution,
  TrespassResolution,
} from '../../../types/patron-merge';

import { COMPARED_FIELDS } from '../../../constants';
import { SearchPatronStep } from './merge-wizard/search-patron-step';
import { FieldComparisonStep } from './merge-wizard/field-comparison-step';
import { PreviewMergeStep } from './merge-wizard/preview-merge-step';

const getDiffFields = (preview: PatronMergePreview): string[] => {
  const p = preview.primary_patron as Record<string, any>;
  const s = preview.secondary_patron as Record<string, any>;
  return COMPARED_FIELDS.filter(key => (p[key] ?? '') !== (s[key] ?? ''));
};

interface PatronMergeWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  primaryPatron: PatronSearchResult;
}

const steps = [
  'Search & Select',
  'Resolve Field Differences',
  'Preview & Confirm',
];

export const PatronMergeWizard: React.FC<PatronMergeWizardProps> = ({
  open,
  onClose,
  onSuccess,
  primaryPatron: initialPatron,
}) => {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchedPatron, setSearchedPatron] = useState<PatronSearchResult | undefined>(undefined);
  const [selectedPrimary, setSelectedPrimary] = useState<PatronSearchResult | undefined>(undefined);
  const [selectedSecondary, setSelectedSecondary] = useState<PatronSearchResult | undefined>(undefined);
  const [mergePreview, setMergePreview] = useState<PatronMergePreview | null>(null);
  const [conflictResolutions, setConflictResolutions] = useState<PatronMergeConflictResolution[]>([]);
  const [banResolutions, setBanResolutions] = useState<BanResolution[]>([]);
  const [trespassResolution, setTrespassResolution] = useState<TrespassResolution | null>(null);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    if (open) {
      setSearchedPatron(undefined);
      setSelectedPrimary(undefined);
      setSelectedSecondary(undefined);
      setActiveStep(0);
      setMergePreview(null);
      setConflictResolutions([]);
      setBanResolutions([]);
      setTrespassResolution(null);
      setConfirmText('');
    }
  }, [open]);

  useEffect(() => {
    if (activeStep === 1 && selectedPrimary && selectedSecondary && !mergePreview) {
      loadMergePreview();
    }
  }, [activeStep, selectedPrimary, selectedSecondary]);

  const loadMergePreview = async () => {
    if (!selectedPrimary || !selectedSecondary) return;

    setLoading(true);
    try {
      const preview = await patronApi.getMergePreview(
        Number(selectedPrimary.id),
        Number(selectedSecondary.id)
      );
      setMergePreview(preview);

      // Pre-populate resolutions for ALL differing fields
      const diffFields = getDiffFields(preview);
      const p = preview.primary_patron as Record<string, any>;
      const s = preview.secondary_patron as Record<string, any>;
      const defaultResolutions: PatronMergeConflictResolution[] = diffFields.map(field => {
        const conflict = preview.conflicts.find(c => c.field === field);
        const primaryVal = p[field] ?? '';
        const secondaryVal = s[field] ?? '';
        const autoResolution =
          primaryVal === '' && secondaryVal !== '' ? 'secondary' : 'primary';
        return {
          type: conflict?.type ?? 'field_conflict',
          field,
          resolution: conflict?.resolution ?? autoResolution,
        };
      });
      setConflictResolutions(defaultResolutions);

      // Pre-populate ban resolutions: default to keeping primary
      const defaultBanRes: BanResolution[] = (preview.ban_conflicts || []).map(c => ({
        primary_ban_id: c.primary_ban.id,
        secondary_ban_id: c.secondary_ban.id,
        resolution: 'primary' as const,
      }));
      setBanResolutions(defaultBanRes);

      // Pre-populate trespass resolution: default to keeping primary
      const tc = preview.trespass_conflicts?.[0];
      if (tc) {
        setTrespassResolution({
          resolution: 'primary',
          lift_ban_ids: tc.secondary_trespasses.map(t => t.id),
        });
      } else {
        setTrespassResolution(null);
      }
    } catch (error: any) {
      const errorMessage = error?.message || error?.error || JSON.stringify(error);
      console.error('Merge preview error:', error);
      showError(`Failed to load merge preview: ${errorMessage}`);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handlePatronSearched = (patron: PatronSearchResult | undefined) => {
    setSearchedPatron(patron);
    if (!patron) {
      setSelectedPrimary(undefined);
      setSelectedSecondary(undefined);
      setMergePreview(null);
      setConflictResolutions([]);
      setBanResolutions([]);
      setTrespassResolution(null);
    }
  };

  const handlePrimarySelected = (primary: PatronSearchResult, secondary: PatronSearchResult) => {
    setSelectedPrimary(primary);
    setSelectedSecondary(secondary);
    // Reset preview so it re-fetches with the new primary/secondary
    setMergePreview(null);
    setConflictResolutions([]);
    setBanResolutions([]);
    setTrespassResolution(null);
  };

  const handleNext = () => {
    if (activeStep === 0 && !selectedPrimary) {
      showError('Please search for a patron and select which record to keep');
      return;
    }

    if (activeStep < steps.length - 1) {
      setActiveStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  const handleExecuteMerge = async () => {
    if (!selectedPrimary || !selectedSecondary) return;

    if (confirmText !== 'MERGE') {
      showError('Please type "MERGE" to confirm');
      return;
    }

    setLoading(true);
    try {
      const result = await patronApi.executeMerge({
        primary_patron_id: Number(selectedPrimary.id),
        secondary_patron_id: Number(selectedSecondary.id),
        conflict_resolutions: conflictResolutions,
        ban_resolutions: banResolutions.length > 0 ? banResolutions : undefined,
        trespass_resolutions: trespassResolution ? [trespassResolution] : undefined,
      });

      showSuccess(`Successfully merged patrons. ${result.data_transferred.incidents} incidents, ${result.data_transferred.photos} photos, and ${result.data_transferred.bans} bans transferred.`);

      onClose();
      if (Number(selectedPrimary.id) === Number(initialPatron.id)) {
        if (onSuccess) onSuccess();
      } else {
        navigate(`/patrons/${selectedPrimary.id}`);
      }
    } catch (error) {
      showError(`Failed to merge patrons: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch (activeStep) {
      case 0:
        return !!selectedPrimary && !!selectedSecondary;
      case 1: {
        if (!mergePreview) return false;

        const hasBanConflicts = (mergePreview.ban_conflicts?.length ?? 0) > 0;
        const hasTrespassConflicts = (mergePreview.trespass_conflicts?.length ?? 0) > 0;

        // All field diffs resolved
        const diffFields = getDiffFields(mergePreview);
        const allFieldsResolved = diffFields.every(f => conflictResolutions.some(r => r.field === f));

        // All ban conflicts resolved
        const allBansResolved = (mergePreview.ban_conflicts || []).every(c =>
          banResolutions.some(r => r.primary_ban_id === c.primary_ban.id && r.secondary_ban_id === c.secondary_ban.id),
        );

        // Trespass conflict resolved (if any)
        const trespassResolved = !hasTrespassConflicts || trespassResolution !== null;

        return allFieldsResolved && allBansResolved && trespassResolved;
      }
      case 2:
        return confirmText === 'MERGE';
      default:
        return false;
    }
  };

  const renderStepContent = () => {
    if (loading) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
          <CircularProgress />
        </Box>
      );
    }

    switch (activeStep) {
      case 0:
        return (
          <SearchPatronStep
            initialPatron={initialPatron}
            selectedPatron={searchedPatron}
            onSelectPatron={handlePatronSearched}
            selectedPrimary={selectedPrimary}
            onSelectPrimary={handlePrimarySelected}
          />
        );
      case 1:
        return mergePreview ? (
          <FieldComparisonStep
            mergePreview={mergePreview}
            conflictResolutions={conflictResolutions}
            onUpdateResolutions={setConflictResolutions}
            banResolutions={banResolutions}
            onUpdateBanResolutions={setBanResolutions}
            trespassResolution={trespassResolution}
            onUpdateTrespassResolution={setTrespassResolution}
          />
        ) : null;
      case 2:
        return mergePreview && selectedPrimary && selectedSecondary ? (
          <PreviewMergeStep
            mergePreview={mergePreview}
            conflictResolutions={conflictResolutions}
            banResolutions={banResolutions}
            trespassResolution={trespassResolution}
            primaryPatron={selectedPrimary}
            secondaryPatron={selectedSecondary}
            confirmText={confirmText}
            setConfirmText={setConfirmText}
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: { minHeight: 550, display: 'flex', flexDirection: 'column' } } }}
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h5" component="div">
            Merge Patron Records
          </Typography>
          <IconButton onClick={(e) => { (e.currentTarget as HTMLElement).blur(); onClose(); }} disabled={loading} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
        <Stepper activeStep={activeStep} sx={{ mt: 2 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </DialogTitle>

      <DialogContent dividers sx={{ flex: 1 }}>
        {renderStepContent()}
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 2 }}>
        <Button
          onClick={handleBack}
          disabled={activeStep === 0 || loading}
        >
          Back
        </Button>
        {activeStep === steps.length - 1 ? (
          <Button
            variant="contained"
            color="error"
            onClick={handleExecuteMerge}
            disabled={!canProceed() || loading}
          >
            {loading ? 'Merging...' : 'Merge'}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleNext}
            disabled={!canProceed() || loading}
          >
            Next
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
