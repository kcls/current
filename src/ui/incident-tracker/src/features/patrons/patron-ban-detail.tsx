import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import {
  Paper,
  Typography,
  Box,
  Chip,
  Button,
  IconButton,
  Tooltip,
  Divider,
  Alert,
  Link,
  Grid,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Avatar,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
CheckCircle as LiftedIcon,
  Schedule as ScheduleIcon,
  Archive as ArchiveIcon,
  CalendarToday as CalendarIcon,
  Event as EventIcon,
  Person as PersonIcon,
  AccountCircle as PatronIcon,
  LocationOn as LocationIcon,
  Link as LinkChainIcon,
  PostAddOutlined as AttachNoteIcon,
} from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { Breadcrumbs } from '../../shared/components/breadcrumbs';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import { ArchiveBanDialog } from './archive-ban-dialog';
import { LetterViewerDialog } from '../../shared/components/letter-viewer-dialog';
import { AddBanNoteDialog } from './add-ban-note-dialog';
import { bansApi } from '../../api/bans';
import { getBanActivity } from '../../api/activity';
import { patronApi } from '../../api/patrons';
import { uploadService } from '@core';
import { useAuth } from '../../contexts/auth-context';
import { useToast } from '../../contexts/toast-context';
import { INCIDENT_ROLES } from '../../shared/utils/roles';
import { ActivityLogPaper } from '../../shared/components/activity-log';
import type { ActivityLogEntry } from '../../types';
import {
  isTimestampPast,
  formatBanDate,
  formatDisplayDateTime,
} from '../../shared/utils/date-utils';
import type { BanDetailsResponse } from '../../types';
import { getBanStatus } from '../../shared/utils/ban-status';

const ARCHIVE_ROLES = [INCIDENT_ROLES.COORDINATOR, INCIDENT_ROLES.ADMIN];

const PatronBanDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { showError } = useToast();

  const [data, setData] = useState<BanDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false);
  const [viewLetterContent, setViewLetterContent] = useState<string | null>(null);
  const [viewLetterDialogOpen, setViewLetterDialogOpen] = useState(false);
  const [patronPhotoUrl, setPatronPhotoUrl] = useState<string | undefined>();
  const [activityEntries, setActivityEntries] = useState<ActivityLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadData = useCallback(async (showLoading = true) => {
    if (!id) return;

    try {
      if (showLoading) setLoading(true);
      const response = await bansApi.getBanDetails(parseInt(id));
      setData(response);
    } catch (error) {
      console.error('Failed to load ban details:', error);
      showError('Failed to load ban details');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [id, showError]);

  const loadActivity = useCallback(() => {
    if (!id) return;
    setActivityLoading(true);
    setActivityError(null);
    getBanActivity(parseInt(id)).then((entries) => {
      setActivityEntries(entries);
    }).catch(() => {
      setActivityError('Failed to load activity log');
    }).finally(() => {
      setActivityLoading(false);
    });
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load activity log
  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  // Load patron photo for avatar
  useEffect(() => {
    if (!data) return;
    const pId = data.ban.patron_id || (typeof data.ban.patron === 'object' ? data.ban.patron?.id : data.ban.patron);
    if (!pId) return;

    let cancelled = false;
    patronApi.getDetailSummary(pId).then((result) => {
      if (cancelled) return;
      const primaryPhoto = result.photos?.find((p: any) => p.is_primary);
      if (primaryPhoto?.file_upload_data?.relative_path) {
        setPatronPhotoUrl(uploadService.getFileUrl(primaryPhoto.file_upload_data.relative_path));
      }
    }).catch(() => { /* ignore — avatar will just show default */ });
    return () => { cancelled = true; };
  }, [data]);

  // Silent refresh to avoid unmounting open dialogs
  const handleDialogSuccess = () => {
    loadData(false);
    loadActivity();
  };

  const involvedLocations = useMemo(() => {
    if (!data) return [];
    const { ban } = data;
    const locations = new Map<string, string>();
    if (ban.org_unit && ban.org_unit_name) {
      locations.set(ban.org_unit, ban.org_unit_name);
    }
    for (const entry of activityEntries) {
      if (entry.org_unit && entry.org_unit_name && !locations.has(entry.org_unit)) {
        locations.set(entry.org_unit, entry.org_unit_name);
      }
    }
    return Array.from(locations.values());
  }, [data, activityEntries]);

  const linkedIncidentIds = useMemo(() => {
    if (!data) return [];
    const { ban, letters } = data;
    return Array.from(new Set([
      ban.incident,
      ...letters.map((l) => l.incident),
    ].filter(Boolean) as number[]));
  }, [data]);

  if (loading) {
    return (
      <PageContainer>
        <LoadingSkeleton variant="form" rows={8} />
      </PageContainer>
    );
  }

  if (!data) {
    return (
      <PageContainer>
        <Alert severity="error">Ban not found.</Alert>
      </PageContainer>
    );
  }

  const { ban } = data;
  const status = getBanStatus(ban);
  const isActive = !ban.archived_by && !(ban.lifts_at && isTimestampPast(ban.lifts_at) && !ban.is_trespass);
  const typeLabel = ban.is_trespass ? 'Trespass' : 'Ban';

  const canArchive = user?.roles?.some((r: any) => ARCHIVE_ROLES.includes(r.role)) ?? false;
  const showArchiveButton = canArchive && !ban.archived_by;

  const patronId = ban.patron_id || (typeof ban.patron === 'object' ? ban.patron?.id : ban.patron);

  return (
    <PageContainer maxWidth="lg">
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Breadcrumbs
          items={[
            { label: 'Patrons', href: '/patrons' },
            { label: ban.patron_name || `Patron #${patronId}`, href: `/patrons/${patronId}` },
            { label: `${typeLabel} #${ban.id}` },
          ]}
          noMargin
        />
        <Box display="flex" gap={0.5}>
          {isActive && (
            <Tooltip title="Report Incident">
              <IconButton component={RouterLink} to={`/incidents/new?ban_id=${ban.id}`}>
                <AddIcon />
              </IconButton>
            </Tooltip>
          )}
          {!ban.archived_by && (
            <Tooltip title={`Edit ${typeLabel}`}>
              <IconButton component={RouterLink} to={`/bans/${ban.id}/edit`}>
                <EditIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box display="flex" alignItems="center" gap={2} mb={3} flexWrap="wrap">
              <Avatar
                src={patronPhotoUrl}
                sx={{ width: 48, height: 48, bgcolor: 'grey.300' }}
              >
                <PersonIcon />
              </Avatar>
              <Typography variant="h4" component="h1">
                {ban.is_trespass ? 'Trespass (System-wide)' : `${typeLabel}${ban.org_unit_name ? ` at ${ban.org_unit_name}` : ''}`}
              </Typography>
              <Chip label={status.label} color={status.color} size="small" />
            </Box>

            {ban.archived_by && (
              <Alert severity="success" sx={{ mb: 2 }}>
                This {typeLabel.toLowerCase()} has been archived.
              </Alert>
            )}
            {ban.lifts_at && isTimestampPast(ban.lifts_at) && !ban.archived_by && !ban.is_trespass && (
              <Alert severity="success" sx={{ mb: 2 }}>
                This ban was automatically lifted on {formatBanDate(ban.lifts_at)}.
              </Alert>
            )}

            <Box display="flex" gap={3} flexWrap="wrap" mb={2}>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Start Date
                </Typography>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <EventIcon fontSize="small" color="action" />
                  <Typography variant="body2">
                    {formatBanDate(ban.starts_at)}
                  </Typography>
                </Box>
              </Box>

              {ban.lifts_at && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Lift Date
                  </Typography>
                  <Box display="flex" alignItems="center" gap={0.5}>
                    {isTimestampPast(ban.lifts_at) ? (
                      ban.is_trespass ? (
                        <>
                          <ScheduleIcon fontSize="small" color="warning" />
                          <Typography variant="body2" color="warning.main">
                            {formatBanDate(ban.lifts_at)} (Eligible)
                          </Typography>
                        </>
                      ) : (
                        <>
                          <LiftedIcon fontSize="small" color="success" />
                          <Typography variant="body2" color="success.main">
                            {formatBanDate(ban.lifts_at)} (Lifted)
                          </Typography>
                        </>
                      )
                    ) : (
                      <>
                        <ScheduleIcon fontSize="small" color="action" />
                        <Typography variant="body2">
                          {formatBanDate(ban.lifts_at)}
                        </Typography>
                      </>
                    )}
                  </Box>
                </Box>
              )}

              {ban.archives_at && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Archive Date
                  </Typography>
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <ScheduleIcon fontSize="small" color="action" />
                    <Typography variant="body2">
                      {formatBanDate(ban.archives_at)}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>

            {ban.comments && (
              <>
                <Divider sx={{ my: 3 }} />
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Comments
                  </Typography>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
                    {ban.comments}
                  </Typography>
                </Box>
              </>
            )}

            <Box display="flex" gap={1} mt={3.5} flexWrap="wrap" alignItems="center">
              <Button
                variant="contained"
                size="small"
                startIcon={<AttachNoteIcon />}
                onClick={() => setAddNoteDialogOpen(true)}
              >
                Attach / Note
              </Button>
              {showArchiveButton && (
                <Button
                  variant="contained"
                  size="small"
                  color="success"
                  startIcon={<ArchiveIcon />}
                  onClick={() => setArchiveDialogOpen(true)}
                >
                  Archive
                </Button>
              )}
            </Box>
          </Paper>

          <ActivityLogPaper
            title={`${typeLabel} History`}
            entries={activityEntries}
            loading={activityLoading}
            error={activityError}
            showIncidentLink
            onViewLetter={async (letterId) => {
              try {
                const result = await bansApi.getBanLetter(letterId);
                if (result?.content) {
                  setViewLetterContent(result.content);
                  setViewLetterDialogOpen(true);
                } else {
                  showError('Letter content not found');
                }
              } catch {
                showError('Failed to load letter');
              }
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {typeLabel} Information
              </Typography>

              <List dense sx={{ '& .MuiListItemIcon-root': { alignSelf: 'center' } }}>
                <ListItem>
                  <ListItemIcon>
                    <CalendarIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Created"
                    secondary={ban.created_at ? formatDisplayDateTime(ban.created_at) : 'Unknown'}
                  />
                </ListItem>

                {ban.created_by_name && (
                  <ListItem>
                    <ListItemIcon>
                      <PersonIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Created By"
                      secondary={ban.created_by_name}
                    />
                  </ListItem>
                )}

                {involvedLocations.length > 0 && (
                  <ListItem>
                    <ListItemIcon>
                      <LocationIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={involvedLocations.length > 1 ? 'Locations' : 'Location'}
                      secondary={
                        involvedLocations.length === 1
                          ? involvedLocations[0]
                          : (
                            <Box component="span" display="flex" flexDirection="column" gap={0.25} mt={0.5}>
                              {involvedLocations.map((name) => (
                                <Typography key={name} variant="body2" component="span" color="text.secondary">
                                  {name}
                                </Typography>
                              ))}
                            </Box>
                          )
                      }
                    />
                  </ListItem>
                )}

                {linkedIncidentIds.length > 0 && (
                  <ListItem>
                    <ListItemIcon>
                      <LinkChainIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Linked Incidents"
                      secondary={
                        <Box component="span" display="flex" flexDirection="column" gap={0.25} mt={0.5}>
                          {linkedIncidentIds.map((incidentId) => (
                            <Link
                              key={incidentId}
                              component={RouterLink}
                              to={`/incidents/${incidentId}`}
                              variant="body2"
                              sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                            >
                              Incident #{incidentId}
                            </Link>
                          ))}
                        </Box>
                      }
                    />
                  </ListItem>
                )}

                {ban.patron_name && patronId && (
                  <ListItem>
                    <ListItemIcon>
                      <PatronIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Patron"
                      secondary={
                        <Link
                          component={RouterLink}
                          to={`/patrons/${patronId}`}
                          variant="body2"
                          sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                        >
                          {ban.patron_name}
                        </Link>
                      }
                    />
                  </ListItem>
                )}

              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <ArchiveBanDialog
        open={archiveDialogOpen}
        ban={ban}
        onClose={() => setArchiveDialogOpen(false)}
        onSuccess={handleDialogSuccess}
      />

<LetterViewerDialog
        open={viewLetterDialogOpen}
        title={`${typeLabel} Letter`}
        content={viewLetterContent}
        onClose={() => setViewLetterDialogOpen(false)}
      />

      <AddBanNoteDialog
        open={addNoteDialogOpen}
        banId={ban.id}
        patronName={ban.patron_name}
        onClose={() => setAddNoteDialogOpen(false)}
        onSuccess={handleDialogSuccess}
      />
    </PageContainer>
  );
};

export default PatronBanDetail;
