import React, { useMemo } from 'react';
import {
  Box,
  TextField,
  Autocomplete,
  Typography,
} from '@mui/material';
import { SubdirectoryArrowRight as SubdirectoryArrowRightIcon } from '@mui/icons-material';
import { useLocations } from '../../contexts/location-context';
import { authApi as coreAuthApi } from '@core';
import { buildLocationMap, getRegionOrgUnit } from '../utils/location-utils';

interface LocationSelectorProps {
  value: string | null;
  onChange: (value: string | null) => void;
  onIdChange?: (id: string | null) => void;
  size?: 'small' | 'medium';
  label?: string;
  placeholder?: string;
  sx?: any;
  autoSetDefault?: boolean;
  disableClearable?: boolean;
}

const LocationSelector: React.FC<LocationSelectorProps> = ({
  value,
  onChange,
  onIdChange,
  size = 'small',
  label = 'Location',
  placeholder = 'Filter by location...',
  sx = {},
  autoSetDefault = true,
  disableClearable = true
}) => {
  const { locations } = useLocations();

  const hierarchicalLocations = useMemo(() => {
    const { activeLocations, getLevel } = buildLocationMap(locations);

    const withLevels = activeLocations.map(loc => ({
      ...loc,
      level: getLevel(loc)
    }));

    const buildTree = (parentId: number | null | undefined = undefined): (typeof withLevels[0])[] => {
      const children = withLevels.filter(loc => {
        if (parentId === undefined || parentId === null) {
          return loc.parent === undefined || loc.parent === null;
        }
        return loc.parent === parentId;
      });

      children.sort((a, b) => {
        const labelA = a.display_label || a.label || '';
        const labelB = b.display_label || b.label || '';
        return labelA.localeCompare(labelB);
      });

      const result: (typeof withLevels[0])[] = [];
      for (const child of children) {
        result.push(child);
        result.push(...buildTree(child.id));
      }

      return result;
    };

    return buildTree(undefined);
  }, [locations]);

  React.useEffect(() => {
    if (!autoSetDefault) return;

    const sessionData = coreAuthApi.getSessionData();
    const userOrgUnitId = sessionData?.org_unit;

    if (!userOrgUnitId || locations.length === 0 || value !== null) {
      return;
    }

    const region = getRegionOrgUnit(userOrgUnitId, locations);
    if (region) {
      const regionLocation = locations.find(loc => loc.uuid === region);
      if (regionLocation?.code) {
        onChange(regionLocation.code);
        onIdChange?.(region);
      }
    }
  }, [locations, value, onChange, onIdChange, autoSetDefault]);

  const selectedLocation = useMemo(() => {
    if (!value) return null;
    return hierarchicalLocations.find(loc => loc.code === value) || null;
  }, [hierarchicalLocations, value]);

  return (
    <Autocomplete
      size={size}
      sx={{ minWidth: 300, ...sx }}
      options={hierarchicalLocations}
      value={selectedLocation}
      onChange={(event, newValue) => {
        onChange(newValue?.code || null);
        onIdChange?.(newValue?.uuid || null);
      }}
      disableClearable={disableClearable}
      autoSelect
      autoHighlight
      selectOnFocus
      getOptionLabel={(option) => option.display_label || option.label}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props as any;
        const level = (option as any).level || 0;
        return (
          <Box
            component="li"
            key={key}
            {...otherProps}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              pl: level * 4 + 1,
            }}
          >
            {level > 1 && (
              <SubdirectoryArrowRightIcon
                sx={{
                  fontSize: 16,
                  color: 'text.secondary',
                  opacity: 0.6,
                  ml: 0.5
                }}
              />
            )}
            <Typography
              variant="body2"
              sx={{
                fontWeight: level <= 1 ? 600 : 400,
                color: level === 0 ? 'text.primary' : 'text.secondary',
              }}
            >
              {option.display_label || option.label}
            </Typography>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          inputProps={{
            ...params.inputProps,
            autoComplete: 'off',
            'data-lpignore': 'true',
            'data-form-type': 'other',
          }}
        />
      )}
    />
  );
};

export default LocationSelector;
