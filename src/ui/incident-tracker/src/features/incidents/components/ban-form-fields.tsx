import React from 'react';
import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
} from '@mui/material';
import { parseISO, addDays, isValid, format } from 'date-fns';
import { PRESET_DAYS, getDurationLabel } from '../../../shared/utils/date-utils';
import type { PerPatronFormData } from '../hooks/use-ban-form';

function parseIsoDateOrNull(value?: string): Date | null {
  if (!value) return null;
  const date = parseISO(value);
  return isValid(date) ? date : null;
}

interface BanFormFieldsProps {
  formData: PerPatronFormData;
  errors: Record<string, string>;
  presetValue: string;
  onFieldChange: (field: keyof PerPatronFormData, value: any) => void;
  typeDisabled?: boolean;
  banStatusAlert?: React.ReactNode;
}

export const BanFormFields: React.FC<BanFormFieldsProps> = ({
  formData,
  errors,
  presetValue,
  onFieldChange,
  typeDisabled,
  banStatusAlert,
}) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {banStatusAlert}

      <FormControl size="small" fullWidth>
        <InputLabel>Type</InputLabel>
        <Select
          value={formData.is_trespass ? 'trespass' : 'ban'}
          onChange={(e) => onFieldChange('is_trespass', e.target.value === 'trespass')}
          label="Type"
          disabled={typeDisabled}
        >
          <MenuItem value="ban">Ban</MenuItem>
          <MenuItem value="trespass">Trespass</MenuItem>
        </Select>
      </FormControl>

      <Box display="flex" gap={2}>
        <TextField
          size="small"
          type="date"
          label="Start Date"
          value={formData.starts_at}
          onChange={(e) => onFieldChange('starts_at', e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          required
          error={!!errors.starts_at}
          helperText={
            errors.starts_at ||
            `When the ${formData.is_trespass ? 'trespass' : 'ban'} begins`
          }
          sx={{ flex: 1, '& input::-webkit-calendar-picker-indicator': { cursor: 'pointer' } }}
        />

        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel>Duration</InputLabel>
          <Select
            value={presetValue}
            onChange={(e) => {
              if (!e.target.value) return;
              const startDate = parseIsoDateOrNull(formData.starts_at);
              if (!startDate) return;
              const liftDate = addDays(startDate, Number(e.target.value));
              onFieldChange('lifts_at', format(liftDate, 'yyyy-MM-dd'));
            }}
            label="Duration"
          >
            {PRESET_DAYS.map((days) => (
              <MenuItem key={days} value={String(days)}>
                {getDurationLabel(days)}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, ml: 1.75 }}>
            Quick preset to set lift date
          </Typography>
        </FormControl>

        <TextField
          size="small"
          type="date"
          label="Lift Date"
          value={formData.lifts_at}
          onChange={(e) => onFieldChange('lifts_at', e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          required
          error={!!errors.lifts_at}
          helperText={
            errors.lifts_at ||
            (formData.is_trespass
              ? 'After this date, coordinator will archive the trespass'
              : 'Ban will be automatically lifted on this date')
          }
          sx={{ flex: 1, '& input::-webkit-calendar-picker-indicator': { cursor: 'pointer' } }}
        />
      </Box>

      <Box display="flex" gap={2}>
        <TextField
          size="small"
          label="Law Enforcement Agency"
          value={formData.law_enforcement_agency}
          onChange={(e) => onFieldChange('law_enforcement_agency', e.target.value)}
          sx={{ flex: 1 }}
        />

        <TextField
          size="small"
          label="Police Case Number"
          value={formData.case_number}
          onChange={(e) => onFieldChange('case_number', e.target.value)}
          sx={{ flex: 1 }}
        />
      </Box>

      <TextField
        fullWidth
        size="small"
        multiline
        rows={2}
        label="Internal Comments"
        value={formData.comments}
        onChange={(e) => onFieldChange('comments', e.target.value)}
        placeholder="Internal notes visible only to staff"
      />
    </Box>
  );
};
