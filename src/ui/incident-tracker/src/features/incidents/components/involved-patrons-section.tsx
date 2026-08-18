import React, { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  InputAdornment,
  Autocomplete,
  Card,
  CardContent,
  Avatar,
  Chip,
  Link,
  Alert,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  PersonAdd as PersonAddIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { uploadService } from '@core/api/upload';
import type { PatronSearchResult } from '../../../types';
import { createTempUnknownPatron, formatAlias } from '../../../shared/utils/patron-utils';
import type { PatronProps } from './incident-form-step-report';

interface OrgUnit {
  id: number;
  uuid: string;
  label: string;
  display_label?: string;
}

interface InvolvedPatronsSectionProps {
  patron: PatronProps;
  locations: OrgUnit[];
  orgUnit: string | null;
  errors: Record<string, string>;
  clearError: (field: string) => void;
}

const createPatronFilterOptions = (
  excludeIds: Set<string>,
  inputValue: string,
  options: PatronSearchResult[],
): PatronSearchResult[] => {
  if (!inputValue || inputValue.length < 2) return [];

  const filtered = options.filter((option) => !excludeIds.has(option.id));

  return [
    ...filtered,
    { id: 'create-new', display_name: `Create new patron: "${inputValue}"`, isCreateNew: true } as any,
  ];
};

export const InvolvedPatronsSection: React.FC<InvolvedPatronsSectionProps> = ({
  patron,
  locations,
  orgUnit,
  errors,
  clearError,
}) => {
  const knownPatrons = useMemo(
    () => patron.selected.filter((p) => !(p.is_unknown && p.is_new_unsaved)),
    [patron.selected],
  );

  return (
    <Box>
      <Typography
        variant="subtitle2"
        gutterBottom
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <PersonAddIcon fontSize="small" />
        Involved Patrons
      </Typography>
      <Box
        sx={{
          mb: 3,
          p: errors.patron_id ? 2 : 0,
          border: errors.patron_id ? '1px solid' : 'none',
          borderColor: 'error.main',
          borderRadius: 1,
          bgcolor: errors.patron_id ? 'error.lighter' : 'transparent',
        }}
      >
        {errors.patron_id && (
          <Typography variant="caption" color="error" display="block" sx={{ mb: 1 }}>
            {errors.patron_id}
          </Typography>
        )}
        <Autocomplete
          multiple
          fullWidth
          loading={patron.isSearching}
          options={patron.searchResults}
          value={knownPatrons}
          isOptionEqualToValue={(option, value) => String(option.id) === String(value.id)}
          onChange={(_event, newValue) => {
            const unsavedUnknownPatrons = patron.selected.filter(
              (p) => p.is_unknown && p.is_new_unsaved,
            );
            const lastItem = newValue[newValue.length - 1];
            if (lastItem && (lastItem as any).isCreateNew) {
              const searchValue = patron.searchTerm.trim();
              let firstName = searchValue;
              let lastName = '';
              if (searchValue.includes(' ')) {
                const parts = searchValue.split(' ');
                firstName = parts[0] ?? '';
                lastName = parts.slice(1).join(' ');
              }
              const tempPatron: PatronSearchResult = {
                id: `new-${Date.now()}`,
                display_name: searchValue,
                status: 'active',
                is_banned: false,
                incident_count: 0,
                is_new_unsaved: true,
                first_name: firstName,
                last_name: lastName,
              };
              patron.setSelected([...newValue.slice(0, -1), tempPatron, ...unsavedUnknownPatrons]);
              clearError('patron_id');
            } else {
              patron.setSelected([...newValue, ...unsavedUnknownPatrons]);
              if (newValue.length > 0) clearError('patron_id');
            }
          }}
          onInputChange={(_event, newInputValue) => {
            patron.setSearchTerm(newInputValue);
            if (newInputValue && newInputValue.length >= 2) patron.search(newInputValue);
          }}
          getOptionLabel={(option) => {
            if ((option as any).isCreateNew) return `Create new patron: "${patron.searchTerm}"`;
            return option.display_name || '';
          }}
          filterOptions={(options, params) => {
            const excludeIds = new Set<string>();
            patron.selected.forEach((p) => excludeIds.add(String(p.id)));
            return createPatronFilterOptions(excludeIds, params.inputValue, options);
          }}
          renderOption={(props, option) => {
            const { key, ...restProps } = props as any;
            const uniqueKey = option.id || key;

            if ((option as any).isCreateNew) {
              return (
                <Box
                  component="li"
                  key={uniqueKey}
                  {...restProps}
                  sx={{
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'action.hover',
                    fontStyle: 'italic',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonAddIcon fontSize="small" color="primary" />
                    <Box>
                      <Typography variant="body2" color="primary">
                        Create new patron: &quot;{patron.searchTerm}&quot;
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {patron.searchTerm.includes(' ')
                          ? `Will be created as: ${patron.searchTerm.split(' ')[0]} (first) ${patron.searchTerm.split(' ').slice(1).join(' ')} (last)`
                          : `Will be created with first name: ${patron.searchTerm}`}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              );
            }

            return (
              <Box component="li" key={uniqueKey} {...restProps}>
                <Box>
                  <Typography variant="body2">{option.display_name}</Typography>
                  {formatAlias(option.alias) && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Alias: {formatAlias(option.alias)}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" display="block">
                    {option.library_card ? `Card: ${option.library_card}` : 'No library card'}
                    {(() => {
                      const now = new Date();
                      const labels: string[] = [];
                      if (option.ban_max_lifts_at && new Date(option.ban_max_lifts_at) > now) {
                        const loc = option.ban_location_names;
                        labels.push(loc ? `BANNED (${loc})` : 'BANNED');
                      }
                      if (
                        option.trespass_max_lifts_at &&
                        new Date(option.trespass_max_lifts_at) > now
                      ) {
                        labels.push('TRESPASSED');
                      }
                      return labels.length > 0 ? ` • ${labels.join(' • ')}` : '';
                    })()}
                    {option.incident_count ? ` • ${option.incident_count} incidents` : ''}
                  </Typography>
                </Box>
              </Box>
            );
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const { key, ...chipProps } = getTagProps({ index });
              return (
                <Chip key={key} variant="outlined" label={option.display_name} {...chipProps} size="small" />
              );
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search for patrons"
              placeholder="Type to search by name, alias, library card, or email..."
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
              }}
            />
          )}
          noOptionsText={
            patron.searchTerm.length < 2
              ? 'Type at least 2 characters to search'
              : 'No patrons found'
          }
        />

        {/* Selected patron cards */}
        {patron.selected.length > 0 && (
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {patron.selected.map((p) => {
              const banStatus = patron.banStatus[p.id];
              const hasActiveTrespass = !!banStatus?.hasTrespass;
              const hasActiveBanAtLocation = !!banStatus?.hasBan;
              const trespassLocationLabel = banStatus?.trespassOrgUnitName;
              const locationName = locations.find((l) => l.uuid === orgUnit)?.label;

              return (
                <Card key={p.id} variant="outlined" sx={{ overflow: 'visible' }}>
                  <CardContent sx={{ p: 1, '&:last-child': { pb: 0 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                      <Avatar
                        src={
                          p.primary_photo_url
                            ? uploadService.getFileUrl(p.primary_photo_url)
                            : undefined
                        }
                        sx={{ width: 32, height: 32, bgcolor: 'action.disabledBackground' }}
                      >
                        <PersonIcon sx={{ fontSize: 18 }} />
                      </Avatar>
                      {p.is_new_unsaved ? (
                        <Typography variant="body2">{p.display_name}</Typography>
                      ) : (
                        <Link
                          component={RouterLink}
                          to={`/patrons/${p.id}`}
                          target="_blank"
                          variant="body2"
                          sx={{
                            textDecoration: 'none',
                            '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          {p.display_name}
                        </Link>
                      )}
                      {p.is_unknown && <Chip label="Unknown" size="small" variant="outlined" />}
                      <Box sx={{ flex: 1 }} />
                      <IconButton
                        onClick={() => {
                          patron.setSelected((prev) => prev.filter((x) => x.id !== p.id));
                          patron.setNotes((prev) => {
                            const { [p.id]: _, ...rest } = prev;
                            return rest;
                          });
                          patron.clearBanIntents(p.id);
                        }}
                        sx={{ color: 'text.secondary' }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>

                    <TextField
                      fullWidth
                      multiline
                      rows={2}
                      label="Description"
                      value={patron.notes[p.id] || ''}
                      onChange={(e) =>
                        patron.setNotes((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                      placeholder="Add a description of this patron..."
                      size="small"
                      sx={{ mt: 1 }}
                    />

                    {/* Informational ban alerts */}
                    {hasActiveTrespass && (
                      <Alert severity="info" sx={{ mt: 1.5 }}>
                        Already has an active{' '}
                        <Link
                          component={RouterLink}
                          to={`/bans/${banStatus!.trespassId}`}
                          target="_blank"
                        >
                          trespass
                        </Link>{' '}
                        at {trespassLocationLabel || 'another location'}
                      </Alert>
                    )}
                    {!hasActiveTrespass && hasActiveBanAtLocation && (
                      <Alert severity="info" sx={{ mt: 1.5 }}>
                        Already has an active{' '}
                        <Link
                          component={RouterLink}
                          to={`/bans/${banStatus!.banId}`}
                          target="_blank"
                        >
                          ban
                        </Link>{' '}
                        at {locationName || 'this location'}
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </Box>
        )}

        <Button
          variant="outlined"
          size="small"
          startIcon={<PersonAddIcon />}
          onClick={() => {
            patron.setSelected((prev) => [...prev, createTempUnknownPatron()]);
            clearError('patron_id');
          }}
          sx={{ mt: 2 }}
        >
          Add Unknown Patron
        </Button>
      </Box>
    </Box>
  );
};
