import React, { useState, useEffect } from 'react';
import {
  Autocomplete,
  TextField,
  Box,
  Typography,
  Chip,
  InputAdornment,
  CircularProgress,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';

export interface StaffOption {
  id: number | string;
  display_name: string;
  email?: string;
  secondary_text?: string;
}

interface StaffSearchProps<T extends StaffOption> {
  label: string;
  placeholder?: string;
  value: T[];
  onChange: (value: T[]) => void;
  onSearch: (query: string) => Promise<T[]>;
  getSecondaryText?: (option: T) => string;
  minSearchLength?: number;
  noOptionsText?: string;
  multiple?: boolean;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  excludeIds?: Set<number | string>;
}

export function StaffSearch<T extends StaffOption>({
  label,
  placeholder = '',
  value,
  onChange,
  onSearch,
  getSecondaryText,
  minSearchLength = 2,
  noOptionsText = 'No results found',
  multiple = true,
  error = false,
  helperText,
  disabled = false,
  excludeIds,
}: StaffSearchProps<T>) {
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (inputValue.length < minSearchLength) {
      setOptions([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        setLoading(true);
        const results = await onSearch(inputValue);
        // Filter out already selected items
        const selectedIds = new Set(value.map((v) => v.id));
        const filtered = results.filter(
          (r) => !selectedIds.has(r.id) && (!excludeIds || !excludeIds.has(r.id))
        );
        setOptions(filtered);
      } catch (err) {
        console.error('Search failed:', err);
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [inputValue, minSearchLength, onSearch, value, excludeIds]);

  const handleChange = (_event: React.SyntheticEvent, newValue: T | T[] | null) => {
    if (multiple) {
      onChange((newValue as T[]) || []);
    } else {
      onChange(newValue ? [newValue as T] : []);
    }
    setInputValue('');
    setOptions([]);
  };

  return (
    <Autocomplete
      multiple={multiple}
      fullWidth
      loading={loading}
      options={options}
      value={multiple ? value : (value[0] || null)}
      isOptionEqualToValue={(option, val) => option.id === val.id}
      onChange={handleChange}
      onInputChange={(_event, newInputValue) => setInputValue(newInputValue)}
      inputValue={inputValue}
      getOptionLabel={(option) => option.display_name || ''}
      filterOptions={(x) => x}
      disabled={disabled}
      renderOption={(props, option) => {
        const { key, ...restProps } = props as any;
        const secondary = getSecondaryText
          ? getSecondaryText(option)
          : option.email || option.secondary_text || '';
        return (
          <Box component="li" key={key} {...restProps}>
            <Box>
              <Typography variant="body2">{option.display_name}</Typography>
              {secondary && (
                <Typography variant="caption" color="text.secondary">
                  {secondary}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => {
          const { key, ...chipProps } = getTagProps({ index });
          return (
            <Chip
              key={key}
              variant="outlined"
              label={option.display_name}
              {...chipProps}
              size="small"
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length > 0 ? '' : placeholder}
          error={error}
          helperText={helperText}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <>
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
                {params.InputProps.startAdornment}
              </>
            ),
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      noOptionsText={
        inputValue.length < minSearchLength
          ? `Type at least ${minSearchLength} characters to search`
          : noOptionsText
      }
    />
  );
}
