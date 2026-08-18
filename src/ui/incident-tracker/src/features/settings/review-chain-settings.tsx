import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
} from '@mui/material';
import { PageContainer } from '../../shared/components/layout';
import { ReviewChainList } from './components/review-chain-list';
import { useManageableLocations } from '../../shared/hooks/use-manageable-locations';
import type { OrgUnit } from '../../types';

const ReviewChainSettings: React.FC = () => {
  const { manageableLocations, isLoading } = useManageableLocations();
  const [selectedOrgUnit, setSelectedOrgUnit] = useState<number | null>(null);

  useEffect(() => {
    const firstLocation = manageableLocations[0];
    if (firstLocation && selectedOrgUnit === null) {
      setSelectedOrgUnit(firstLocation.id);
    }
  }, [manageableLocations, selectedOrgUnit]);

  const handleOrgUnitChange = (event: any) => {
    setSelectedOrgUnit(event.target.value as number);
  };

  const selectedLocation = manageableLocations.find((loc: OrgUnit) => loc.id === selectedOrgUnit);

  return (
    <PageContainer maxWidth="lg">
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1">Review Process</Typography>
      </Box>

      {isLoading ? (
        <Alert severity="info">Loading locations...</Alert>
      ) : manageableLocations.length === 0 ? (
        <Alert severity="warning">
          You don't have permission to manage review chains for any locations.
          Contact an administrator to request the <code>incident-manager</code> role.
        </Alert>
      ) : (
        <Paper sx={{ p: 3 }}>
          <Box sx={{ mb: 3 }}>
            <FormControl fullWidth>
              <InputLabel id="org-unit-select-label">Location</InputLabel>
              <Select
                labelId="org-unit-select-label"
                id="org-unit-select"
                value={selectedOrgUnit || ''}
                label="Location"
                onChange={handleOrgUnitChange}
              >
                {manageableLocations.map((location: OrgUnit) => (
                  <MenuItem key={location.id} value={location.id}>
                    {location.display_label || location.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {selectedOrgUnit && selectedLocation ? (
            <ReviewChainList
              orgUnit={selectedLocation.uuid}
              orgUnitName={selectedLocation.label || 'Unknown'}
            />
          ) : (
            <Alert severity="info">Please select a location to manage its review chain.</Alert>
          )}
        </Paper>
      )}
    </PageContainer>
  );
};

export default ReviewChainSettings;
