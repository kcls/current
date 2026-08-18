import React from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import {
  Article as IncidentIcon,
  ExpandMore as ExpandMoreIcon,
  Gavel as BanIcon,
  Person as PersonIcon,
  PhotoCamera as PhotoIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { uploadService } from '@core';
import type { PatronSearchResult } from '../../../../types';
import type {
  PatronMergePreview,
  PatronMergeConflictResolution,
  BanResolution,
  TrespassResolution,
} from '../../../../types/patron-merge';
import { GENDER_LABELS } from '../../../../constants';

interface PreviewMergeStepProps {
  mergePreview: PatronMergePreview;
  conflictResolutions: PatronMergeConflictResolution[];
  banResolutions: BanResolution[];
  trespassResolution: TrespassResolution | null;
  primaryPatron: PatronSearchResult;
  secondaryPatron: PatronSearchResult;
  confirmText: string;
  setConfirmText: (text: string) => void;
}

export const PreviewMergeStep: React.FC<PreviewMergeStepProps> = ({
  mergePreview,
  conflictResolutions,
  banResolutions,
  trespassResolution,
  primaryPatron,
  secondaryPatron,
  confirmText,
  setConfirmText,
}) => {
  const isConfirmed = confirmText === 'MERGE';

  const emptyItems = { incidents: [], photos: [], bans: [] };
  const primaryItems = mergePreview.primary_items || emptyItems;
  const secondaryItems = mergePreview.secondary_items || emptyItems;

  // Collect ban IDs that will be lifted due to conflict resolution
  const liftedBanIds = new Set<number>();
  for (const res of banResolutions) {
    liftedBanIds.add(res.resolution === 'primary' ? res.secondary_ban_id : res.primary_ban_id);
  }
  if (trespassResolution) {
    for (const id of trespassResolution.lift_ban_ids) {
      liftedBanIds.add(id);
    }
  }

  const getResolvedFieldValue = (fieldName: string): string => {
    const resolution = conflictResolutions.find(r => r.field === fieldName);
    if (!resolution) {
      return (mergePreview.primary_patron as any)[fieldName] ?? '';
    }

    switch (resolution.resolution) {
      case 'secondary':
        return (mergePreview.secondary_patron as any)[fieldName] ?? '';
      case 'custom':
        return resolution.custom_value ?? '';
      case 'primary':
      default:
        return (mergePreview.primary_patron as any)[fieldName] ?? '';
    }
  };

  const resolvedGender = getResolvedFieldValue('gender');
  const genderLabel = resolvedGender
    ? (GENDER_LABELS[resolvedGender] || resolvedGender)
    : 'Unspecified';

  const primaryHasPhoto = primaryItems.photos.length > 0 || !!primaryPatron.primary_photo_url;
  const mergedPhotoUrl = primaryHasPhoto
    ? primaryPatron.primary_photo_url
    : secondaryPatron.primary_photo_url || undefined;

  const primaryIncidentIds = new Set(primaryItems.incidents.map(i => i.incident_id));
  const allIncidents = [
    ...primaryItems.incidents.map(i => ({ ...i, source: 'primary' as const })),
    ...secondaryItems.incidents
      .filter(i => !primaryIncidentIds.has(i.incident_id))
      .map(i => ({ ...i, source: 'secondary' as const })),
  ];
  const allPhotos = [
    ...primaryItems.photos.map(p => ({ ...p, source: 'primary' as const })),
    ...secondaryItems.photos.map(p => ({ ...p, source: 'secondary' as const })),
  ];
  const allBans = [
    ...primaryItems.bans.map(b => ({ ...b, source: 'primary' as const })),
    ...secondaryItems.bans.map(b => ({ ...b, source: 'secondary' as const })),
  ].filter(b => !liftedBanIds.has(b.id));

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Merged Patron Information
      </Typography>
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <Avatar
              src={mergedPhotoUrl ? uploadService.getFileUrl(mergedPhotoUrl) : undefined}
              sx={{ width: 48, height: 48 }}
            >
              <PersonIcon />
            </Avatar>
            <Typography variant="h6">
              {getResolvedFieldValue('first_name')} {getResolvedFieldValue('last_name')}
            </Typography>
          </Box>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="body2" color="text.secondary">First Name</Typography>
              <Typography variant="body1">{getResolvedFieldValue('first_name') || '—'}</Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="body2" color="text.secondary">Last Name</Typography>
              <Typography variant="body1">{getResolvedFieldValue('last_name') || '—'}</Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="body2" color="text.secondary">Nickname/Alias</Typography>
              <Typography variant="body1">{getResolvedFieldValue('alias') || '—'}</Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="body2" color="text.secondary">Library Card</Typography>
              <Typography variant="body1">{getResolvedFieldValue('library_card') || '—'}</Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="body2" color="text.secondary">Age Range</Typography>
              <Typography variant="body1">{getResolvedFieldValue('age_range_label') || 'Unspecified'}</Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="body2" color="text.secondary">Gender</Typography>
              <Typography variant="body1">{genderLabel}</Typography>
            </Grid>
            <Grid size={12}>
              <Typography variant="body2" color="text.secondary">Mailing Address</Typography>
              <Typography variant="body1">
                {[
                  getResolvedFieldValue('address_line1'),
                  getResolvedFieldValue('address_line2'),
                  getResolvedFieldValue('city'),
                  getResolvedFieldValue('state_province'),
                  getResolvedFieldValue('postal_code'),
                ].filter(Boolean).join(', ') || '—'}
              </Typography>
            </Grid>
            <Grid size={12}>
              <Typography variant="body2" color="text.secondary">Patron Description</Typography>
              <Typography variant="body1">{getResolvedFieldValue('notes') || '—'}</Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Typography variant="h6" gutterBottom>
        Associated Records
      </Typography>
      <Paper variant="outlined" sx={{ mb: 3, overflow: 'hidden' }}>
        <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{ px: 2.5, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Box display="flex" alignItems="center" gap={1}>
              <IncidentIcon fontSize="small" color="action" />
              <Typography variant="subtitle2">Incidents</Typography>
              <Chip label={allIncidents.length} size="small" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }} />
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <Divider />
            {allIncidents.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, py: 2 }}>
                No incidents.
              </Typography>
            ) : (
              <List dense disablePadding>
                {allIncidents.map((incident, idx) => (
                  <ListItem
                    key={`${incident.source}-${incident.incident_id}-${idx}`}
                    divider={idx < allIncidents.length - 1}
                    sx={{ px: 2.5 }}
                  >
                    <ListItemText
                      primary={
                        <Box display="flex" alignItems="center" gap={1}>
                          <Typography
                            variant="body2"
                            component={RouterLink}
                            to={`/incidents/${incident.incident_id}`}
                            target="_blank"
                            sx={{
                              color: 'primary.main',
                              textDecoration: 'none',
                              '&:hover': { textDecoration: 'underline' },
                            }}
                          >
                            Incident #{incident.incident_id}
                          </Typography>
                          {incident.source === 'secondary' && (
                            <Chip label="transferred" size="small" variant="outlined" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }} />
                          )}
                        </Box>
                      }
                      secondary={`${incident.org_unit_label} · ${new Date(incident.occurred_at).toLocaleDateString()}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </AccordionDetails>
        </Accordion>

        <Divider />

        <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{ px: 2.5, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Box display="flex" alignItems="center" gap={1}>
              <PhotoIcon fontSize="small" color="action" />
              <Typography variant="subtitle2">Photos</Typography>
              <Chip label={allPhotos.length} size="small" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }} />
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2.5, pb: 2, pt: 0 }}>
            <Divider sx={{ mb: 2, mx: -2.5 }} />
            {allPhotos.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No photos.
              </Typography>
            ) : (
              <Box display="flex" gap={2} flexWrap="wrap">
                {allPhotos.map((photo, idx) => (
                  <Box key={`${photo.source}-${photo.id}-${idx}`} textAlign="center">
                    <Avatar
                      src={photo.file_path ? uploadService.getFileUrl(photo.file_path) : undefined}
                      variant="rounded"
                      sx={{ width: 64, height: 64, mb: 0.5 }}
                    >
                      <PhotoIcon />
                    </Avatar>
                    <Box display="flex" gap={0.5} justifyContent="center">
                      {photo.is_primary && photo.source === 'primary' && (
                        <Chip label="primary" size="small" variant="outlined" sx={{ height: 18, '& .MuiChip-label': { px: 0.5, fontSize: '0.65rem' } }} />
                      )}
                      {photo.source === 'secondary' && (
                        <Chip label="transferred" size="small" variant="outlined" sx={{ height: 18, '& .MuiChip-label': { px: 0.5, fontSize: '0.65rem' } }} />
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </AccordionDetails>
        </Accordion>

        <Divider />

        <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{ px: 2.5, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Box display="flex" alignItems="center" gap={1}>
              <BanIcon fontSize="small" color="action" />
              <Typography variant="subtitle2">Bans &amp; Trespasses</Typography>
              <Chip label={allBans.length} size="small" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }} />
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <Divider />
            {allBans.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, py: 2 }}>
                No bans or trespasses.
              </Typography>
            ) : (
              <List dense disablePadding>
                {allBans.map((ban, idx) => (
                  <ListItem
                    key={`${ban.source}-${ban.id}-${idx}`}
                    divider={idx < allBans.length - 1}
                    sx={{ px: 2.5 }}
                  >
                    <ListItemText
                      primary={
                        <Box display="flex" alignItems="center" gap={1}>
                          <Typography variant="body2">
                            {ban.is_trespass ? 'Trespass' : 'Ban'} at {ban.org_unit_label}
                          </Typography>
                          {ban.source === 'secondary' && (
                            <Chip label="transferred" size="small" variant="outlined" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }} />
                          )}
                        </Box>
                      }
                      secondary={
                        <>
                          {new Date(ban.starts_at).toLocaleDateString()}
                          {ban.lifts_at && ` — ${new Date(ban.lifts_at).toLocaleDateString()}`}
                        </>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </AccordionDetails>
        </Accordion>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Type <strong>MERGE</strong> below to confirm this action. This cannot be undone.
        </Typography>
        <TextField
          fullWidth
          size="small"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
          placeholder="Type MERGE to confirm"
          error={confirmText.length > 0 && !isConfirmed}
          helperText={confirmText.length > 0 && !isConfirmed ? 'Must type exactly "MERGE"' : ' '}
        />
      </Paper>
    </Box>
  );
};
