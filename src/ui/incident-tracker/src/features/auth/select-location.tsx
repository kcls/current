import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Typography,
  Paper,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  ListSubheader,
} from '@mui/material';
import { useAuth } from '../../contexts/auth-context';
import { authApi, orgUnitApi, type OrgUnit } from '@core';
import { STORAGE_KEYS, loadSavedOrgUnits } from '../../shared/utils/storage';
import { ROUTES } from '../../constants';
import { setLibraryTimezone } from '../../shared/utils/date-utils';
import type { SavedOrgUnit } from '../../types';

// Maximum number of recent locations to keep in localStorage
const MAX_SAVED_LOCATIONS = 3;

const SelectLocation: React.FC = () => {
  const navigate = useNavigate();
  const { fetchCurrentUser, logout } = useAuth();
  const [orgUnitUuid, setOrgUnitUuid] = useState<string>('');
  const [savedOrgUnits, setSavedOrgUnits] = useState<SavedOrgUnit[]>([]);
  const [orgUnits, setOrgUnits] = useState<(OrgUnit & { level: number })[]>([]);
  const [loadingOrgUnits, setLoadingOrgUnits] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadSavedUnits = () => {
      // loadSavedOrgUnits drops pre-uuid-migration entries (integer ids).
      setSavedOrgUnits(loadSavedOrgUnits());
    };

    const loadAllOrgUnits = async () => {
      setLoadingOrgUnits(true);
      try {
        // TODO: Filter by can_have_staff and restrict based on user role
        const tree = await orgUnitApi.getOrgUnitTree();
        const flattened = orgUnitApi.flattenOrgUnits(tree);
        const staffUnits = flattened.filter(unit =>
          unit.unit_type?.can_have_staff === true
        );
        setOrgUnits(staffUnits);
      } catch (err) {
        console.error('Failed to load org units:', err);
        setError('Failed to load organization units. Please try logging in again.');
      } finally {
        setLoadingOrgUnits(false);
      }
    }; 

    loadSavedUnits();
    loadAllOrgUnits();
  }, []);

  // Set default org unit after orgUnits are loaded, if not already set
  useEffect(() => {
    if (orgUnitUuid || loadingOrgUnits) return;

    // First try to get org unit from JWT token
    const currentOrgUnit = authApi.getOrgUnit();
    if (currentOrgUnit) {
      setOrgUnitUuid(currentOrgUnit);
      return;
    }

    // Fallback to most recent saved location
    const firstSaved = savedOrgUnits[0];
    if (savedOrgUnits.length > 0 && firstSaved && firstSaved.uuid) {
      setOrgUnitUuid(firstSaved.uuid);
    }
  }, [savedOrgUnits, orgUnitUuid, loadingOrgUnits]);

  const updateSavedLocation = (location: SavedOrgUnit) => {
    let updatedList = [...savedOrgUnits];
    const existingIndex = updatedList.findIndex(loc => loc.uuid === location.uuid);

    if (existingIndex >= 0) {
      // Update existing location's last_used_at
      const existing = updatedList[existingIndex]!;
      updatedList[existingIndex] = {
        ...existing,
        last_used_at: new Date().toISOString()
      };
    } else {
      // Add new location
      updatedList.push({
        ...location,
        last_used_at: new Date().toISOString()
      });
    }

    updatedList.sort((a, b) =>
      new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime()
    );

    updatedList = updatedList.slice(0, MAX_SAVED_LOCATIONS);

    localStorage.setItem(STORAGE_KEYS.SAVED_ORG_UNITS, JSON.stringify(updatedList));
    setSavedOrgUnits(updatedList);
  };

  const handleSubmit = async () => {
    if (!orgUnitUuid) {
      setError('Please select a working location');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await authApi.refreshToken({ org_unit: orgUnitUuid });

      await fetchCurrentUser();

      const selectedUnit = orgUnits.find(u => u.uuid === orgUnitUuid);
      if (selectedUnit) {
        if ((selectedUnit as any).timezone) {
          setLibraryTimezone((selectedUnit as any).timezone);
        }
        updateSavedLocation({
          uuid: selectedUnit.uuid,
          code: selectedUnit.code,
          label: selectedUnit.label,
          last_used_at: new Date().toISOString()
        });
      }

      navigate(ROUTES.HOME);
    } catch (err: any) {
      setError('Failed to switch location. Please try again.');
      console.error('Location switch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper elevation={3} sx={{ padding: 4, width: '100%' }}>
          <Typography component="h1" variant="h5" align="center">
            Select Working Location
          </Typography>

          {error && <Alert severity="error" sx={{ mt: 2, mb: 2 }}>{error}</Alert>}

          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
              You can change it anytime in Preferences.
            </Typography>

            <FormControl fullWidth margin="normal" required>
              <InputLabel id="location-label">Working Location</InputLabel>
              <Select
                labelId="location-label"
                id="location"
                value={orgUnitUuid}
                label="Working Location"
                onChange={(e) => setOrgUnitUuid(e.target.value)}
                disabled={loading || loadingOrgUnits}
                autoFocus
              >
                {loadingOrgUnits ? [
                  <MenuItem key="loading" value="" disabled>
                    <Box display="flex" alignItems="center" gap={1}>
                      <CircularProgress size={16} />
                      Loading locations...
                    </Box>
                  </MenuItem>
                ] : [
                  ...(savedOrgUnits.length > 0 ? [
                    <ListSubheader key="recent-header">Recent Locations</ListSubheader>,
                    ...savedOrgUnits.map((location) => (
                      <MenuItem
                        key={`saved-${location.uuid}`}
                        value={location.uuid}
                      >
                        {location.code ? `${location.code} - ${location.label}` : location.label}
                      </MenuItem>
                    ))
                  ] : []),
                  ...(orgUnits.length > 0 ? [
                    <ListSubheader key="all-header">All Locations</ListSubheader>,
                    ...orgUnits.map((unit) => (
                      <MenuItem key={`all-${unit.id}`} value={unit.uuid}>
                        {unit.level > 0 && '\u00A0\u00A0'.repeat(unit.level)}
                        {unit.display_label || unit.label}
                      </MenuItem>
                    ))
                  ] : []),
                  ...(orgUnits.length === 0 && savedOrgUnits.length === 0 ? [
                    <MenuItem key="no-locations" value="" disabled>
                      No locations available
                    </MenuItem>
                  ] : [])
                ]}
              </Select>
            </FormControl>

            <Button
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={loading || loadingOrgUnits || !orgUnitUuid}
              onClick={handleSubmit}
            >
              {loading ? 'Setting Location...' : 'Continue'}
            </Button>

            <Button
              fullWidth
              variant="text"
              onClick={handleLogout}
              disabled={loading}
            >
              Logout
            </Button>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default SelectLocation;
