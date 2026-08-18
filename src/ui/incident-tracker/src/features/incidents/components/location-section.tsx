import React, { useMemo, useState } from 'react';
import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Autocomplete,
} from '@mui/material';

interface OrgUnit {
  id: number;
  uuid: string;
  label: string;
  display_label?: string;
  is_active?: boolean;
  unit_type_object?: { can_have_patrons?: boolean };
}

interface SubLocation {
  id: number;
  name: string;
}

interface LocationSectionProps {
  orgUnit: string | null;
  subLocation: number | null;
  locations: OrgUnit[];
  availableLocationOptions: OrgUnit[];
  subLocations: SubLocation[];
  isLoadingSubLocations: boolean;
  isEditMode: boolean;
  errors: Record<string, string>;
  onInputChange: (field: 'org_unit' | 'sub_location', value: any) => void;
  clearError: (field: string) => void;
}

export const LocationSection: React.FC<LocationSectionProps> = ({
  orgUnit,
  subLocation,
  locations,
  availableLocationOptions,
  subLocations,
  isLoadingSubLocations,
  isEditMode,
  errors,
  onInputChange,
  clearError,
}) => {
  const [locationInputValue, setLocationInputValue] = useState('');
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);

  const filteredLocationOptions = useMemo(() => {
    if (!locationInputValue) return availableLocationOptions;
    const inputLower = locationInputValue.toLowerCase();
    return availableLocationOptions.filter((option) => {
      const label = (option.display_label || option.label).toLowerCase();
      return label.includes(inputLower);
    });
  }, [availableLocationOptions, locationInputValue]);

  return (
    <Box sx={{ display: 'flex', gap: 2, mt: 1, mb: 2.5 }}>
      <Box sx={{ flex: 1 }}>
        <Autocomplete
          fullWidth
          disabled={isEditMode}
          open={isLocationDropdownOpen}
          onOpen={() => setIsLocationDropdownOpen(true)}
          onClose={() => setIsLocationDropdownOpen(false)}
          options={availableLocationOptions}
          value={(() => {
            if (!orgUnit) return null;
            return locations.find((loc) => loc.uuid === orgUnit) || null;
          })()}
          inputValue={locationInputValue}
          onInputChange={(_, newInputValue) => setLocationInputValue(newInputValue)}
          onKeyDown={(event) => {
            if (
              event.key === 'Tab' &&
              !event.shiftKey &&
              isLocationDropdownOpen &&
              filteredLocationOptions.length > 0
            ) {
              event.preventDefault();
              const selectedOption = filteredLocationOptions[0]!;
              const newOrgUnit = selectedOption.uuid;
              onInputChange('org_unit', newOrgUnit);
              if (newOrgUnit !== orgUnit) onInputChange('sub_location', null);
              setLocationInputValue(selectedOption.display_label || selectedOption.label);
              setIsLocationDropdownOpen(false);
            }
          }}
          onChange={(_, newValue, reason) => {
            const newOrgUnit = newValue ? newValue.uuid : null;
            onInputChange('org_unit', newOrgUnit);
            if (newOrgUnit !== orgUnit) onInputChange('sub_location', null);
            if (reason === 'selectOption') setLocationInputValue('');
          }}
          getOptionLabel={(option) => option.display_label || option.label}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Location"
              required
              error={!!errors.org_unit}
              helperText={errors.org_unit}
              placeholder="Type to search for location..."
            />
          )}
          renderOption={(props, option) => {
            const { key, ...restProps } = props as any;
            return (
              <Box component="li" key={key} {...restProps}>
                {option.display_label || option.label}
                {option.is_active === false && (
                  <Chip label="Inactive" size="small" color="warning" sx={{ ml: 1 }} />
                )}
              </Box>
            );
          }}
        />
      </Box>

      <FormControl sx={{ flex: 1 }}>
        <InputLabel>Sub-Location</InputLabel>
        <Select
          value={(() => {
            if (!subLocation) return '';
            const subLocNum = Number(subLocation);
            if (isEditMode && subLocation) return subLocNum;
            const subLocExists = subLocations.some((sl) => Number(sl.id) === subLocNum);
            return subLocExists ? subLocNum : '';
          })()}
          onChange={(e) => {
            const val = e.target.value as string | number;
            onInputChange('sub_location', !val || val === '' ? null : Number(val));
          }}
          label="Sub-Location"
          disabled={!orgUnit}
        >
          {isLoadingSubLocations && orgUnit && subLocations.length === 0 ? (
            <MenuItem disabled>Loading sub-locations...</MenuItem>
          ) : subLocations.length === 0 ? (
            <MenuItem disabled>
              <em>No sub-locations available for this location</em>
            </MenuItem>
          ) : (
            subLocations.map((sl) => (
              <MenuItem key={sl.id} value={Number(sl.id)}>
                {sl.name}
              </MenuItem>
            ))
          )}
        </Select>
      </FormControl>
    </Box>
  );
};
