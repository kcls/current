import React, { useState, useEffect } from 'react';
import {
  Autocomplete,
  Box,
  TextField,
  Typography,
  Alert,
  CircularProgress,
  Avatar,
  Chip,
  Card,
  CardContent,
  Stack,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  Person as PersonIcon,
  SwapHoriz as SwapHorizIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { uploadService } from '@core';
import { patronApi } from '../../../../api/patrons';
import type { PatronSearchResult } from '../../../../types';
import { formatAlias } from '../../../../shared/utils/patron-utils';

interface SearchPatronStepProps {
  initialPatron: PatronSearchResult;
  selectedPatron?: PatronSearchResult;
  onSelectPatron: (patron: PatronSearchResult | undefined) => void;
  selectedPrimary?: PatronSearchResult;
  onSelectPrimary: (primary: PatronSearchResult, secondary: PatronSearchResult) => void;
}

export const SearchPatronStep: React.FC<SearchPatronStepProps> = ({
  initialPatron,
  selectedPatron,
  onSelectPatron,
  selectedPrimary,
  onSelectPrimary,
}) => {
  const currentPatronId = Number(initialPatron.id);

  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<PatronSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [directionLeftPrimary, setDirectionLeftPrimary] = useState(
    !selectedPrimary || Number(selectedPrimary.id) === currentPatronId
  );

  useEffect(() => {
    if (!inputValue || inputValue.length < 3) {
      setOptions([]);
      return;
    }

    let active = true;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const results = await patronApi.search({ query: inputValue, limit: 20 });
        if (active) {
          setOptions(results.items.filter(p => Number(p.id) !== currentPatronId));
        }
      } catch {
        if (active) setOptions([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [inputValue, currentPatronId]);

  useEffect(() => {
    if (selectedPatron) {
      if (directionLeftPrimary) {
        onSelectPrimary(initialPatron, selectedPatron);
      } else {
        onSelectPrimary(selectedPatron, initialPatron);
      }
    }
  }, [directionLeftPrimary]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (_: any, patron: PatronSearchResult | null) => {
    if (!patron) return;
    onSelectPatron(patron);
    if (directionLeftPrimary) {
      onSelectPrimary(initialPatron, patron);
    } else {
      onSelectPrimary(patron, initialPatron);
    }
  };

  const handleSwap = () => {
    setDirectionLeftPrimary(prev => !prev);
  };

  const handleClearSelection = () => {
    onSelectPatron(undefined);
    setInputValue('');
    setOptions([]);
  };

  const renderPatronInfo = (patron: PatronSearchResult) => {
    const now = new Date();
    const hasActiveBan = (patron.active_ban_count ?? 0) > 0
      || (patron.ban_max_lifts_at && new Date(patron.ban_max_lifts_at) > now);
    const hasActiveTrespass = (patron.active_trespass_count ?? 0) > 0
      || (patron.trespass_max_lifts_at && new Date(patron.trespass_max_lifts_at) > now);

    return (
      <Stack spacing={0.5}>
        {formatAlias(patron.alias) && (
          <Typography variant="body2" color="text.secondary">
            Alias: {formatAlias(patron.alias)}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          Library Card: {patron.library_card || 'N/A'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Incidents: {patron.incident_count || 0}
        </Typography>
        {hasActiveBan && (
          <Typography variant="body2" color="text.secondary">
            Active Bans: {patron.active_ban_count || 0}
          </Typography>
        )}
        {hasActiveTrespass && (
          <Typography variant="body2" color="text.secondary">
            Active Trespass: Yes
          </Typography>
        )}
        {patron.last_incident && (
          <Typography variant="body2" color="text.secondary">
            Last Incident: {new Date(patron.last_incident).toLocaleDateString()}
          </Typography>
        )}
      </Stack>
    );
  };

  const leftIsPrimary = directionLeftPrimary;

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 4 }}>
        Search for the duplicate patron, then use the swap button to choose which record to <strong>keep</strong>.
        Incidents, photos, bans, and trespasses will be transferred to the kept record.
        Any differences (e.g. name, address, overlapping bans) can be resolved in the next step.
      </Alert>

      <Box display="flex" gap={2} alignItems="stretch">
        {/* Left: Current patron */}
        <Box flex={1} display="flex" flexDirection="column">
          <Box display="flex" alignItems="center" gap={1} mb={1.5}>
            <Chip
              label={leftIsPrimary ? 'Keep' : 'Remove'}
              size="small"
              color={leftIsPrimary ? 'success' : 'error'}
              variant="filled"
            />
          </Box>
          <Card
            variant="outlined"
            sx={{ flex: 1 }}
          >
            <CardContent sx={{ p: 0.5, '&:last-child': { pb: 0.5 } }}>
              <Box display="flex" alignItems="center" gap={1.5} mb={1.5}>
                <Avatar src={initialPatron.primary_photo_url ? uploadService.getFileUrl(initialPatron.primary_photo_url) : undefined} sx={{ width: 36, height: 36 }}>
                  <PersonIcon fontSize="small" />
                </Avatar>
                <Typography variant="subtitle2">
                  {initialPatron.display_name}
                </Typography>
              </Box>
              {renderPatronInfo(initialPatron)}
            </CardContent>
          </Card>
        </Box>

        {/* Center: Swap direction */}
        <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" sx={{ pt: 3.5 }}>
          <Tooltip title="Swap keep / remove" arrow>
            <IconButton
              onClick={handleSwap}
              color="primary"
              sx={{
                border: 1,
                borderColor: 'divider',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <SwapHorizIcon />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Right: Search / selected patron */}
        <Box flex={1} display="flex" flexDirection="column">
          <Box display="flex" alignItems="center" gap={1} mb={1.5}>
            <Chip
              label={!leftIsPrimary ? 'Keep' : 'Remove'}
              size="small"
              color={!leftIsPrimary ? 'success' : 'error'}
              variant="filled"
            />
          </Box>
          <Card
            variant="outlined"
            sx={{ flex: 1, position: 'relative' }}
          >
            <CardContent sx={{ p: 0.5, '&:last-child': { pb: 0.5 } }}>
              {selectedPatron ? (
                <>
                  <Tooltip title="Clear selection">
                    <IconButton
                      size="small"
                      onClick={handleClearSelection}
                      sx={{ position: 'absolute', top: 8, right: 8, color: 'text.secondary' }}
                    >
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>

                  <Box display="flex" alignItems="center" gap={1.5} mb={1.5}>
                    <Avatar src={selectedPatron.primary_photo_url ? uploadService.getFileUrl(selectedPatron.primary_photo_url) : undefined} sx={{ width: 36, height: 36 }}>
                      <PersonIcon fontSize="small" />
                    </Avatar>
                    <Typography
                      variant="subtitle2"
                      component={RouterLink}
                      to={`/patrons/${selectedPatron.id}`}
                      target="_blank"
                      sx={{
                        color: 'primary.main',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      {selectedPatron.display_name}
                      <OpenInNewIcon sx={{ fontSize: 14 }} />
                    </Typography>
                  </Box>
                  {renderPatronInfo(selectedPatron)}
                </>
              ) : (
                <Autocomplete
                  options={options}
                  getOptionLabel={(option) => option.display_name || String(option.id)}
                  filterOptions={(x) => x}
                  inputValue={inputValue}
                  onInputChange={(_, val, reason) => {
                    if (reason !== 'reset') setInputValue(val);
                  }}
                  onChange={handleSelect}
                  loading={loading}
                  noOptionsText={
                    inputValue.length < 3
                      ? 'Type at least 3 characters'
                      : 'No patrons found'
                  }
                  isOptionEqualToValue={(opt, val) => opt.id === val.id}
                  renderOption={(props, option) => {
                    const { key, ...otherProps } = props;
                    return (
                      <li key={key} {...otherProps}>
                        <Box display="flex" alignItems="center" gap={1.5} width="100%">
                          <Avatar src={option.primary_photo_url ? uploadService.getFileUrl(option.primary_photo_url) : undefined} sx={{ width: 32, height: 32 }}>
                            <PersonIcon fontSize="small" />
                          </Avatar>
                          <Box flex={1} minWidth={0}>
                            <Typography variant="body2" fontWeight={500} noWrap>
                              {option.display_name}
                            </Typography>
                            {formatAlias(option.alias) && (
                              <Typography variant="caption" color="text.secondary" noWrap display="block">
                                Alias: {formatAlias(option.alias)}
                              </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary" noWrap display="block">
                              Card: {option.library_card || 'N/A'} &middot; Incidents: {option.incident_count || 0}
                            </Typography>
                          </Box>
                        </Box>
                      </li>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder="Search by name, alias, or card number..."
                      size="small"
                      helperText={inputValue.length > 0 && inputValue.length < 3 ? 'Type at least 3 characters' : ' '}
                      slotProps={{
                        input: {
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {loading ? <CircularProgress size={18} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        },
                      }}
                    />
                  )}
                />
              )}
            </CardContent>
          </Card>
        </Box>
      </Box>

    </Box>
  );
};
