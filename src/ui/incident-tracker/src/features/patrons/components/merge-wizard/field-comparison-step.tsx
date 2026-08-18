import React from 'react';
import {
  Box,
  Alert,
  Paper,
  Typography,
  Divider,
} from '@mui/material';
import { CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import type {
  PatronMergePreview,
  PatronMergeConflictResolution,
  BanResolution,
  TrespassResolution,
} from '../../../../types/patron-merge';
import { COMPARED_FIELDS, GENDER_LABELS } from '../../../../constants';

interface FieldComparisonStepProps {
  mergePreview: PatronMergePreview;
  conflictResolutions: PatronMergeConflictResolution[];
  onUpdateResolutions: (resolutions: PatronMergeConflictResolution[]) => void;
  banResolutions: BanResolution[];
  onUpdateBanResolutions: (resolutions: BanResolution[]) => void;
  trespassResolution: TrespassResolution | null;
  onUpdateTrespassResolution: (resolution: TrespassResolution | null) => void;
}

interface FieldDiff {
  fieldName: string;
  label: string;
  primaryValue: any;
  secondaryValue: any;
  isDifferent: boolean;
}

const LABEL_COL_WIDTH = 140;

const formatDate = (dateStr: string): string => {
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
};

export const FieldComparisonStep: React.FC<FieldComparisonStepProps> = ({
  mergePreview,
  conflictResolutions,
  onUpdateResolutions,
  banResolutions,
  onUpdateBanResolutions,
  trespassResolution,
  onUpdateTrespassResolution,
}) => {
  const { primary_patron, secondary_patron } = mergePreview;

  const hasBanConflicts = (mergePreview.ban_conflicts?.length ?? 0) > 0;
  const hasTrespassConflicts = (mergePreview.trespass_conflicts?.length ?? 0) > 0;

  const buildFieldDiffs = (): FieldDiff[] => {
    const fields: FieldDiff[] = [];
    const fieldLabels: Record<string, string> = {
      first_name: 'First Name',
      last_name: 'Last Name',
      preferred_name: 'Preferred Name',
      library_card: 'Library Card',
      alias: 'Alias',
      address_line1: 'Address Line 1',
      address_line2: 'Address Line 2',
      city: 'City',
      state_province: 'State / Province',
      postal_code: 'Postal Code',
      age_range_label: 'Age Range',
      gender: 'Gender',
      notes: 'Patron Description',
    };
    COMPARED_FIELDS.forEach((key) => {
      const primaryRaw = (primary_patron as any)[key];
      const secondaryRaw = (secondary_patron as any)[key];
      const primaryRawStr = primaryRaw ?? '';
      const secondaryRawStr = secondaryRaw ?? '';
      const primaryValue = key === 'gender'
        ? (GENDER_LABELS[primaryRawStr] ?? primaryRawStr)
        : primaryRawStr;
      const secondaryValue = key === 'gender'
        ? (GENDER_LABELS[secondaryRawStr] ?? secondaryRawStr)
        : secondaryRawStr;
      const isDifferent = primaryRawStr !== secondaryRawStr;

      fields.push({
        fieldName: key,
        label: fieldLabels[key] || key,
        primaryValue,
        secondaryValue,
        isDifferent,
      });
    });

    // Only show fields where both sides have a value and they differ.
    // One-sided diffs are auto-resolved by the wizard and don't need user input.
    return fields.filter(f => f.isDifferent && f.primaryValue !== '' && f.secondaryValue !== '');
  };

  const fieldDiffs = buildFieldDiffs();

  const handleResolutionChange = (fieldName: string, resolution: 'primary' | 'secondary') => {
    const existingIndex = conflictResolutions.findIndex(r => r.field === fieldName);
    const newResolution: PatronMergeConflictResolution = {
      type: 'field_conflict',
      field: fieldName,
      resolution,
    };

    let newResolutions: PatronMergeConflictResolution[];
    if (existingIndex >= 0) {
      newResolutions = [...conflictResolutions];
      newResolutions[existingIndex] = newResolution;
    } else {
      newResolutions = [...conflictResolutions, newResolution];
    }

    onUpdateResolutions(newResolutions);
  };

  const getResolution = (fieldName: string) => {
    return conflictResolutions.find(r => r.field === fieldName);
  };

  const handleBanResolution = (
    primaryBanId: number,
    secondaryBanId: number,
    resolution: 'primary' | 'secondary',
  ) => {
    const existingIndex = banResolutions.findIndex(
      r => r.primary_ban_id === primaryBanId && r.secondary_ban_id === secondaryBanId,
    );
    const newRes: BanResolution = { primary_ban_id: primaryBanId, secondary_ban_id: secondaryBanId, resolution };
    let updated: BanResolution[];
    if (existingIndex >= 0) {
      updated = [...banResolutions];
      updated[existingIndex] = newRes;
    } else {
      updated = [...banResolutions, newRes];
    }
    onUpdateBanResolutions(updated);
  };

  const handleTrespassResolution = (side: 'primary' | 'secondary') => {
    const conflict = mergePreview.trespass_conflicts?.[0];
    if (!conflict) return;

    const liftIds = side === 'primary'
      ? conflict.secondary_trespasses.map(t => t.id)
      : conflict.primary_trespasses.map(t => t.id);

    onUpdateTrespassResolution({ resolution: side, lift_ban_ids: liftIds });
  };

  const hasNoConflicts = fieldDiffs.length === 0 && !hasBanConflicts && !hasTrespassConflicts;

  if (hasNoConflicts) {
    return (
      <Alert severity="success">
        All fields are identical and no ban/trespass conflicts — no conflicts to resolve.
      </Alert>
    );
  }

  return (
    <Box>
      {fieldDiffs.length > 0 && (
        <>
          <Alert severity="info" sx={{ mb: 2.5 }}>
            <Typography variant="body2">
              Click the value you want to keep in the merged patron record.
            </Typography>
          </Alert>

          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Box
              display="flex"
              sx={{ bgcolor: 'action.selected', borderBottom: 2, borderColor: 'divider' }}
            >
              <Box sx={{ width: LABEL_COL_WIDTH, flexShrink: 0, px: 2, py: 1.5 }} />
              {(['primary', 'secondary'] as const).map((side) => {
                const patronName = side === 'primary'
                  ? primary_patron.display_name
                  : secondary_patron.display_name;
                return (
                  <Box
                    key={side}
                    flex={1}
                    px={2}
                    py={1.5}
                    display="flex"
                    alignItems="center"
                    gap={1}
                    sx={{ borderLeft: 1, borderColor: 'divider' }}
                  >
                    <Typography variant="subtitle2">
                      {patronName}
                    </Typography>
                  </Box>
                );
              })}
            </Box>

            {fieldDiffs.map((field) => {
              const resolution = getResolution(field.fieldName);
              const selectedSide = resolution?.resolution;

              return (
                <React.Fragment key={field.fieldName}>
                  <Box display="flex" alignItems="stretch">
                    <Box
                      sx={{
                        width: LABEL_COL_WIDTH,
                        flexShrink: 0,
                        px: 2,
                        py: 1.5,
                        bgcolor: 'action.hover',
                        borderRight: 1,
                        borderColor: 'divider',
                      }}
                      display="flex"
                      alignItems="center"
                      gap={0.75}
                    >
                      <Typography variant="body2" fontWeight={500} color="text.secondary">
                        {field.label}
                      </Typography>
                    </Box>

                    {(['primary', 'secondary'] as const).map((side) => {
                      const isSelected = selectedSide === side;
                      const value = side === 'primary' ? field.primaryValue : field.secondaryValue;

                      return (
                        <Box
                          key={side}
                          flex={1}
                          onClick={() => handleResolutionChange(field.fieldName, side)}
                          display="flex"
                          alignItems="center"
                          gap={1}
                          sx={{
                            px: 2,
                            py: 1.5,
                            cursor: 'pointer',
                            borderLeft: side === 'secondary' ? 1 : 0,
                            borderColor: 'divider',
                            bgcolor: (theme) =>
                              isSelected ? alpha(theme.palette.success.main, 0.08) : 'transparent',
                            '&:hover': {
                              bgcolor: (theme) =>
                                isSelected
                                  ? alpha(theme.palette.success.main, 0.13)
                                  : 'action.hover',
                            },
                            transition: 'background-color 0.12s',
                          }}
                        >
                          {isSelected
                            ? <CheckCircleIcon color="success" sx={{ fontSize: 16, flexShrink: 0 }} />
                            : <Box sx={{ width: 16, flexShrink: 0 }} />
                          }
                          <Typography
                            variant="body2"
                            sx={{
                              wordBreak: 'break-word',
                              color: isSelected ? 'text.primary' : 'text.secondary',
                              fontWeight: isSelected ? 500 : 400,
                            }}
                          >
                            {value}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                  <Divider />
                </React.Fragment>
              );
            })}
          </Paper>
        </>
      )}

      {hasBanConflicts && (
        <Box mt={fieldDiffs.length > 0 ? 3 : 0}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Ban Conflicts
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              Both patrons have an active ban at the same location.
              Choose which to keep. The other will be lifted.
            </Typography>
          </Alert>

          {mergePreview.ban_conflicts.map((conflict, idx) => {
            const currentRes = banResolutions.find(
              r => r.primary_ban_id === conflict.primary_ban.id
                && r.secondary_ban_id === conflict.secondary_ban.id,
            );
            const selectedSide = currentRes?.resolution;

            return (
              <Paper key={idx} variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
                <Box sx={{ bgcolor: 'action.selected', px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="subtitle2">{conflict.org_unit_name}</Typography>
                </Box>
                <Box display="flex">
                  {(['primary', 'secondary'] as const).map((side) => {
                    const ban = side === 'primary' ? conflict.primary_ban : conflict.secondary_ban;
                    const isSelected = selectedSide === side;
                    const patronName = side === 'primary'
                      ? primary_patron.display_name
                      : secondary_patron.display_name;

                    return (
                      <Box
                        key={side}
                        flex={1}
                        onClick={() => handleBanResolution(conflict.primary_ban.id, conflict.secondary_ban.id, side)}
                        sx={{
                          p: 2,
                          cursor: 'pointer',
                          borderLeft: side === 'secondary' ? 1 : 0,
                          borderColor: 'divider',
                          bgcolor: (theme) =>
                            isSelected ? alpha(theme.palette.success.main, 0.08) : 'transparent',
                          '&:hover': {
                            bgcolor: (theme) =>
                              isSelected
                                ? alpha(theme.palette.success.main, 0.13)
                                : 'action.hover',
                          },
                          transition: 'background-color 0.12s',
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={1} mb={1}>
                          {isSelected
                            ? <CheckCircleIcon color="success" sx={{ fontSize: 16 }} />
                            : <Box sx={{ width: 16 }} />
                          }
                          <Typography variant="body2" fontWeight={500}>
                            {patronName}
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          Started: {formatDate(ban.starts_at)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {ban.lifts_at ? `Lifts: ${formatDate(ban.lifts_at)}` : 'Permanent'}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      {hasTrespassConflicts && (
        <Box mt={(fieldDiffs.length > 0 || hasBanConflicts) ? 3 : 0}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Trespass Conflicts
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              Both patrons have an active trespass.
              Choose which to keep. The other will be lifted.
            </Typography>
          </Alert>

          {mergePreview.trespass_conflicts.map((conflict, idx) => {
            const selectedSide = trespassResolution?.resolution;

            return (
              <Paper key={idx} variant="outlined" sx={{ overflow: 'hidden' }}>
                <Box display="flex">
                  {(['primary', 'secondary'] as const).map((side) => {
                    const trespasses = side === 'primary'
                      ? conflict.primary_trespasses
                      : conflict.secondary_trespasses;
                    const isSelected = selectedSide === side;
                    const patronName = side === 'primary'
                      ? primary_patron.display_name
                      : secondary_patron.display_name;

                    return (
                      <Box
                        key={side}
                        flex={1}
                        onClick={() => handleTrespassResolution(side)}
                        sx={{
                          p: 2,
                          cursor: 'pointer',
                          borderLeft: side === 'secondary' ? 1 : 0,
                          borderColor: 'divider',
                          bgcolor: (theme) =>
                            isSelected ? alpha(theme.palette.success.main, 0.08) : 'transparent',
                          '&:hover': {
                            bgcolor: (theme) =>
                              isSelected
                                ? alpha(theme.palette.success.main, 0.13)
                                : 'action.hover',
                          },
                          transition: 'background-color 0.12s',
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={1} mb={1}>
                          {isSelected
                            ? <CheckCircleIcon color="success" sx={{ fontSize: 16 }} />
                            : <Box sx={{ width: 16 }} />
                          }
                          <Typography variant="body2" fontWeight={500}>
                            {patronName}
                          </Typography>
                        </Box>
                        {trespasses.map((t) => (
                          <Box key={t.id}>
                            <Typography variant="body2" color="text.secondary">
                              Started: {formatDate(t.starts_at)}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {t.lifts_at ? `Lifts: ${formatDate(t.lifts_at)}` : 'Permanent'}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    );
                  })}
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      {mergePreview.warnings && mergePreview.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mt: 3 }}>
          <Typography variant="body2" fontWeight="medium" gutterBottom>
            Warnings:
          </Typography>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {mergePreview.warnings.map((warning, index) => (
              <li key={index}>
                <Typography variant="body2">{warning}</Typography>
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </Box>
  );
};
