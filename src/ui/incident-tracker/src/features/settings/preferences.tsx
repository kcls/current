import React, { useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../../constants';
import {
  Box,
  Container,
  Paper,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Divider,
} from '@mui/material';
import {
  LocationOn as LocationIcon,
  Palette as ThemeIcon,
  Notifications as NotificationsIcon,
} from '@mui/icons-material';
import { authApi } from '@core';
import { locationApi } from '../../api/locations';

const Preferences: React.FC = () => {
  const orgUnitId = authApi.getOrgUnit();
  const [orgUnitName, setOrgUnitName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadOrgUnitName = async () => {
      if (!orgUnitId) {
        setLoading(false);
        return;
      }

      try {
        const location = await locationApi.get(orgUnitId);
        const name = location.code
          ? `${location.code} - ${location.name}`
          : location.name;
        setOrgUnitName(name);
      } catch (err) {
        console.error('Failed to load org unit name:', err);
      } finally {
        setLoading(false);
      }
    };

    loadOrgUnitName();
  }, [orgUnitId]);

  const getLocationSecondary = () => {
    if (loading || !orgUnitId) return 'Loading...';
    if (orgUnitName) return orgUnitName;
    return `Org Unit ${orgUnitId}`;
  };

  const preferenceCategories = [
    {
      id: 'location',
      icon: <LocationIcon />,
      primary: 'Working Location',
      secondary: getLocationSecondary(),
      href: ROUTES.SELECT_LOCATION,
    },
    {
      id: 'theme',
      icon: <ThemeIcon />,
      primary: 'Appearance',
      secondary: 'Theme, colors, and display settings',
      href: ROUTES.APPEARANCE,
    },
    {
      id: 'notifications',
      icon: <NotificationsIcon />,
      primary: 'Notifications',
      secondary: 'Email and in-app notification preferences',
      href: ROUTES.NOTIFICATIONS,
    }
  ];

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Preferences
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Manage your account settings and preferences
        </Typography>

        <Paper elevation={1}>
          <List>
            {preferenceCategories.map((category, index) => (
              <React.Fragment key={category.id}>
                {index > 0 && <Divider />}
                <ListItem disablePadding>
                  <ListItemButton
                    component={RouterLink}
                    to={category.href}
                  >
                    <ListItemIcon>{category.icon}</ListItemIcon>
                    <ListItemText
                      primary={category.primary}
                      secondary={category.secondary}
                    />
                  </ListItemButton>
                </ListItem>
              </React.Fragment>
            ))}
          </List>
        </Paper>
      </Box>
    </Container>
  );
};

export default Preferences;
