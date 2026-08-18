import React from 'react';
import {
  Box,
  Button,
  Paper,
  TextField,
  InputAdornment,
  IconButton,
  FormControlLabel,
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import LocationSelector from '../../../shared/components/location-selector';
import { getDaysAgo, getToday } from '../../../shared/utils/date-utils';

export type DateRangePreset = 'last7' | 'last14' | 'last30' | 'custom';

export const getDateRangeFromPreset = (preset: DateRangePreset): { from: string; to: string } | null => {
  const today = getToday();
  switch (preset) {
    case 'last7':
      return { from: getDaysAgo(7), to: today };
    case 'last14':
      return { from: getDaysAgo(14), to: today };
    case 'last30':
      return { from: getDaysAgo(30), to: today };
    case 'custom':
      return null;
  }
};

interface SearchAndFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filterLocationCode: string;
  onLocationCodeChange: (value: string | null) => void;
  onLocationIdChange: (value: string | null) => void;
  dateRangePreset: DateRangePreset;
  onDateRangePresetChange: (preset: DateRangePreset, dateRange: { from: string; to: string } | null) => void;
  filterDateFrom: string;
  onDateFromChange: (value: string) => void;
  filterDateTo: string;
  onDateToChange: (value: string) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  filterStatus?: string;
  onStatusChange?: (value: string) => void;
  showStatusFilter?: boolean;
  filterMyLevelOnly?: boolean;
  onMyLevelOnlyChange?: (value: boolean) => void;
  showMyLevelFilter?: boolean;
}

export const SearchAndFilters: React.FC<SearchAndFiltersProps> = ({
  searchTerm,
  onSearchChange,
  filterLocationCode,
  onLocationCodeChange,
  onLocationIdChange,
  dateRangePreset,
  onDateRangePresetChange,
  filterDateFrom,
  onDateFromChange,
  filterDateTo,
  onDateToChange,
  onClearFilters,
  hasActiveFilters,
  filterStatus,
  onStatusChange,
  showStatusFilter = false,
  filterMyLevelOnly = false,
  onMyLevelOnlyChange,
  showMyLevelFilter = false,
}) => {
  const handlePresetChange = (preset: DateRangePreset) => {
    const dateRange = getDateRangeFromPreset(preset);
    onDateRangePresetChange(preset, dateRange);
  };

  const handleDateFromChange = (value: string) => {
    if (dateRangePreset !== 'custom') {
      onDateRangePresetChange('custom', null);
    }
    onDateFromChange(value);
    if (value && !filterDateTo) {
      onDateToChange(getToday());
    }
  };

  const handleDateToChange = (value: string) => {
    if (dateRangePreset !== 'custom') {
      onDateRangePresetChange('custom', null);
    }
    onDateToChange(value);
  };

  return (
    <Paper sx={{ mb: 2, p: 2 }}>
      <Box display="flex" flexDirection="column" gap={2}>
        <Box display="flex" gap={2} alignItems="center">
          <TextField
            placeholder="Search incidents (min 3 characters)..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            size="small"
            sx={{ flex: 1, maxWidth: 500 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
              endAdornment: searchTerm && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => onSearchChange('')}>
                    <ClearIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <LocationSelector
            value={filterLocationCode || null}
            onChange={onLocationCodeChange}
            onIdChange={onLocationIdChange}
            size="small"
            disableClearable
            autoSetDefault={false}
          />
          {hasActiveFilters && (
            <Button
              onClick={onClearFilters}
              variant="outlined"
              startIcon={<ClearIcon />}
              sx={{ ml: 'auto' }}
            >
              Clear Filters
            </Button>
          )}
        </Box>

        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          {showStatusFilter && onStatusChange && (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={filterStatus || 'any'}
                label="Status"
                onChange={(e) => onStatusChange(e.target.value)}
              >
                <MenuItem value="any">Any</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="resolved">Review Complete</MenuItem>
              </Select>
            </FormControl>
          )}

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Date Range</InputLabel>
            <Select
              value={dateRangePreset}
              label="Date Range"
              onChange={(e) => handlePresetChange(e.target.value as DateRangePreset)}
            >
              <MenuItem value="last7">Last 7 Days</MenuItem>
              <MenuItem value="last14">Last 14 Days</MenuItem>
              <MenuItem value="last30">Last 30 Days</MenuItem>
              <MenuItem value="custom">Custom Range</MenuItem>
            </Select>
          </FormControl>

          {dateRangePreset === 'custom' && (
            <>
              <TextField
                label="From"
                type="date"
                value={filterDateFrom}
                onChange={(e) => handleDateFromChange(e.target.value)}
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                inputProps={{ max: filterDateTo || undefined }}
              />
              <TextField
                label="To"
                type="date"
                value={filterDateTo}
                onChange={(e) => handleDateToChange(e.target.value)}
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                inputProps={{ min: filterDateFrom || undefined, max: getToday() }}
              />
            </>
          )}

          {showMyLevelFilter && onMyLevelOnlyChange && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={filterMyLevelOnly}
                  onChange={(e) => onMyLevelOnlyChange(e.target.checked)}
                  size="small"
                />
              }
              label="My Review Level Only"
              sx={{ whiteSpace: 'nowrap' }}
            />
          )}
        </Box>
      </Box>
    </Paper>
  );
};
