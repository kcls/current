import { useState } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Checkbox,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Tune as TuneIcon,
} from '@mui/icons-material';

type PreferenceCategory = 'review_request' | 'returned_for_edits';
type PreferenceChannel = 'in_app' | 'email';

interface Preferences {
  review_request: { in_app: boolean; email: boolean };
  returned_for_edits: { in_app: boolean; email: boolean };
}

export const NotificationPreferences: React.FC = () => {
  const [preferences, setPreferences] = useState<Preferences>({
    review_request: { in_app: true, email: true },
    returned_for_edits: { in_app: true, email: true },
  });

  const handlePreferenceChange = (
    category: PreferenceCategory,
    channel: PreferenceChannel
  ) => {
    setPreferences(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [channel]: !prev[category][channel],
      },
    }));
    // TODO: Call API to persist preference
  };

  return (
    <Accordion
      elevation={1}
      defaultExpanded={false}
      disableGutters
      sx={{
        mb: 3,
        borderRadius: 1,
        '&:before': { display: 'none' },
        '&.Mui-expanded': { margin: 0, mb: 3 },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          borderRadius: 1,
          '&.Mui-expanded': { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
        }}
      >
        <Box display="flex" alignItems="center" gap={1.5}>
          <TuneIcon fontSize="small" color="action" />
          <Box>
            <Typography variant="body2" fontWeight={500}>
              Preferences
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Choose how you want to be notified
            </Typography>
          </Box>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <List disablePadding>
          {/* Header */}
          <ListItem
            sx={{ py: 0.5, borderBottom: 1, borderColor: 'divider' }}
            secondaryAction={
              <Box display="flex" gap={2}>
                <Typography variant="caption" color="text.secondary" sx={{ width: 48, textAlign: 'center' }}>
                  In-App
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ width: 48, textAlign: 'center' }}>
                  Email
                </Typography>
              </Box>
            }
          >
            <ListItemText
              primary={<Typography variant="caption" color="text.secondary">Event</Typography>}
            />
          </ListItem>

          {/* Review Requests */}
          <ListItem
            sx={{ borderBottom: 1, borderColor: 'divider' }}
            secondaryAction={
              <Box display="flex" gap={2}>
                <Checkbox
                  checked={preferences.review_request.in_app}
                  onChange={() => handlePreferenceChange('review_request', 'in_app')}
                  size="small"
                  sx={{ width: 48, justifyContent: 'center' }}
                />
                <Checkbox
                  checked={preferences.review_request.email}
                  onChange={() => handlePreferenceChange('review_request', 'email')}
                  size="small"
                  sx={{ width: 48, justifyContent: 'center' }}
                />
              </Box>
            }
          >
            <ListItemText
              primary="Review Requests"
              secondary="When an incident needs your review"
              primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
          </ListItem>

          {/* Returned for Edits */}
          <ListItem
            secondaryAction={
              <Box display="flex" gap={2}>
                <Checkbox
                  checked={preferences.returned_for_edits.in_app}
                  onChange={() => handlePreferenceChange('returned_for_edits', 'in_app')}
                  size="small"
                  sx={{ width: 48, justifyContent: 'center' }}
                />
                <Checkbox
                  checked={preferences.returned_for_edits.email}
                  onChange={() => handlePreferenceChange('returned_for_edits', 'email')}
                  size="small"
                  sx={{ width: 48, justifyContent: 'center' }}
                />
              </Box>
            }
          >
            <ListItemText
              primary="Returned for Edits"
              secondary="When your incident is returned for changes"
              primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
          </ListItem>
        </List>
      </AccordionDetails>
    </Accordion>
  );
};
