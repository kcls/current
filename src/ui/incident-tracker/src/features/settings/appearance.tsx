import React from 'react';
import {
  Box,
  Container,
  Paper,
  Typography,
  FormControl,
  FormControlLabel,
  FormLabel,
  RadioGroup,
  Radio,
  Switch,
  Stack,
} from '@mui/material';
import { useUserPreferences, type ThemeMode } from '../../contexts/user-preferences-context';

const Appearance: React.FC = () => {
  const {
    appearance,
    setMode,
    setHighContrast,
  } = useUserPreferences();

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Appearance
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Adjust theme and accessibility settings
        </Typography>

        <Stack spacing={3}>
          {/* Theme Mode */}
          <Paper elevation={1} sx={{ p: 3 }}>
            <FormControl component="fieldset">
              <FormLabel component="legend" sx={{ mb: 1, fontWeight: 500 }}>
                Theme Mode
              </FormLabel>
              <RadioGroup
                value={appearance.mode}
                onChange={(e) => setMode(e.target.value as ThemeMode)}
              >
                <FormControlLabel
                  value="light"
                  control={<Radio />}
                  label="Light"
                />
                <FormControlLabel
                  value="dark"
                  control={<Radio />}
                  label="Dark"
                />
                <FormControlLabel
                  value="system"
                  control={<Radio />}
                  label="System (follow device settings)"
                />
              </RadioGroup>
            </FormControl>
          </Paper>

          {/* Accessibility */}
          <Paper elevation={1} sx={{ p: 3 }}>
            <FormLabel component="legend" sx={{ mb: 1, fontWeight: 500 }}>
              Accessibility
            </FormLabel>
            <FormControlLabel
              control={
                <Switch
                  checked={appearance.highContrast}
                  onChange={(e) => setHighContrast(e.target.checked)}
                />
              }
              label="High contrast mode"
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, ml: 6 }}>
              Increases contrast for better visibility
            </Typography>
          </Paper>
        </Stack>
      </Box>
    </Container>
  );
};

export default Appearance;
