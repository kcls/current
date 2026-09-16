import React from 'react';
import {
  Box,
  Typography,
  Collapse,
  Divider,
  FormControlLabel,
  Checkbox,
  FormHelperText,
} from '@mui/material';
import type { TrespassProcedureItem } from '../../../types';
import { type ProcedureState } from '../../../shared/utils/trespass-procedures';

interface TrespassProceduresChecklistProps {
  items: TrespassProcedureItem[];
  state: ProcedureState;
  onChange: (state: ProcedureState) => void;
  error?: string;
  embedded?: boolean;
}

export const TrespassProceduresChecklist: React.FC<TrespassProceduresChecklistProps> = ({
  items,
  state,
  onChange,
  error,
  embedded = false,
}) => {
  if (items.length === 0) return null;

  const escapeItem = items.find((i) => i.is_escape_hatch);
  const escapeChecked = escapeItem ? !!state[escapeItem.code] : false;

  const generalItems = items.filter((i) => !i.is_escape_hatch && !i.account_dependent);
  const accountItems = items.filter((i) => !i.is_escape_hatch && i.account_dependent);

  const applicableRequired = items.filter(
    (i) => !i.is_escape_hatch && i.required && !(i.account_dependent && escapeChecked),
  );
  const doneCount = applicableRequired.filter((i) => state[i.code]).length;
  const total = applicableRequired.length;
  const complete = doneCount >= total;
  const showError = !!error && !complete;

  const setItem = (code: string, checked: boolean, isEscape = false) => {
    const next: ProcedureState = { ...state, [code]: checked };
    if (isEscape && checked) {
      for (const it of accountItems) next[it.code] = false;
    }
    onChange(next);
  };

  const row = (item: TrespassProcedureItem) => {
    const checked = !!state[item.code];
    const missing = showError && item.required && !checked;
    return (
      <FormControlLabel
        key={item.code}
        sx={{ display: 'flex', mr: 0, mb: 0.25 }}
        control={
          <Checkbox
            size="small"
            checked={checked}
            color={missing ? 'error' : 'primary'}
            onChange={(e) => setItem(item.code, e.target.checked)}
          />
        }
        label={
          <Typography variant="body2" color={missing ? 'error' : 'text.primary'}>
            {item.label}
            {!item.required && (
              <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 0.75 }}>
                (optional)
              </Typography>
            )}
          </Typography>
        }
      />
    );
  };

  return (
    <Box
      sx={
        embedded
          ? {}
          : {
              p: 2,
              border: '1px solid',
              borderColor: showError ? 'error.main' : 'divider',
              borderRadius: 1,
            }
      }
    >
      <Box display="flex" alignItems="baseline" justifyContent="space-between" gap={1}>
        <Typography variant="subtitle2" gutterBottom color={showError ? 'error' : 'text.primary'}>
          Trespass Procedures
        </Typography>
        <Typography
          variant="caption"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
          color={complete ? 'success.main' : showError ? 'error' : 'text.secondary'}
        >
          {complete ? 'All required done' : `${doneCount} of ${total} required`}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block">
        Confirm the following steps were completed for this trespass.
      </Typography>

      {generalItems.length > 0 && (
        <Box sx={{ mt: 1 }}>
          {generalItems.map(row)}
        </Box>
      )}

      {(escapeItem || accountItems.length > 0) && (
        <>
          {generalItems.length > 0 && <Divider sx={{ my: 1 }} />}
          {escapeItem && (
            <FormControlLabel
              sx={{ display: 'flex', mr: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={escapeChecked}
                  onChange={(e) => setItem(escapeItem.code, e.target.checked, true)}
                />
              }
              label={<Typography variant="body2">{escapeItem.label}</Typography>}
            />
          )}
          {accountItems.length > 0 && (
            <Collapse in={!escapeChecked} unmountOnExit>
              <Box>{accountItems.map(row)}</Box>
            </Collapse>
          )}
        </>
      )}

      {showError && <FormHelperText error sx={{ mx: 0, mt: 1 }}>{error}</FormHelperText>}
    </Box>
  );
};

export default TrespassProceduresChecklist;
