import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
  Button,
  IconButton,
  Avatar,
  Tooltip,
  Grid,
  ImageList,
  ImageListItem,
  ImageListItemBar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Person as PersonIcon,
  ReportProblem as RelatedIncidentIcon,
  PhotoCamera as PhotoCameraIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  Add as AddIcon,
  Edit as EditIcon,
  MergeType as MergeIcon,
  Print as PrintIcon,
  SearchOff as SearchOffIcon,
  Gavel as GavelIcon,
} from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { Breadcrumbs } from '../../shared/components/breadcrumbs';
import { PaginatedTableContainer } from '../../shared/components/paginated-table-container';
import { ROUTES } from '../../constants';
import { PatronBanSummaryCard } from './patron-ban-summary-card';
import { PatronInfoForm } from './components/patron-info-form';
import { PatronMergeWizard } from './components/patron-merge-wizard';
import { patronApi } from '../../api/patrons';
import { incidentApi } from '../../api/incidents';
import { Patron, Incident, PatronBan } from '../../types';
import { useToast } from '../../contexts/toast-context';
import { useAuth } from '../../contexts/auth-context';
import { useLocations } from '../../contexts/location-context';
import { uploadService, authApi as coreAuthApi } from '@core';
import { getIncidentStatus, getStatusColor as getIncidentStatusColor } from '../../shared/utils/incident-status';
import { COORDINATOR_ROLES, hasAnyRole } from '../../shared/utils/roles';
import { LinkTableRow, LinkTableCell } from '../../shared/components/link-table-row';
import { printHtmlContent } from '../../shared/utils/print-service';
import { formatDisplayTime } from '../../shared/utils/date-utils';
import { generatePatronReportHtml, getPatronReportStyles } from '../../shared/utils/print-templates';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import EmptyStateCard from '../../shared/components/empty-state-card';

const PatronDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const { user } = useAuth();
  const canSeeSummary = useMemo(() => hasAnyRole(user, COORDINATOR_ROLES), [user]);
  const { locations } = useLocations();
  const locationLabel = useMemo(() => {
    const orgUnitId = coreAuthApi.getOrgUnit();
    if (!orgUnitId || locations.length === 0) return '';
    const location = locations.find(loc => loc.uuid === orgUnitId);
    return location?.display_label || location?.label || '';
  }, [locations]);

  const sectionLocationSuffix = canSeeSummary ? ' — All Branches' : locationLabel ? ` (at ${locationLabel})` : '';

  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.only('xs'));
  const isSm = useMediaQuery(theme.breakpoints.only('sm'));
  const isMd = useMediaQuery(theme.breakpoints.only('md'));
  const photoColumns = isXs ? 1 : isSm ? 2 : isMd ? 3 : 4;

  const [patron, setPatron] = useState<Patron | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentsTotal, setIncidentsTotal] = useState(0);
  // Local pagination state for patron detail (no need for URL state)
  const [incidentsPage, setIncidentsPage] = useState(0);
  const [incidentsRowsPerPage, setIncidentsRowsPerPage] = useState(10);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [activeBansTrespassesCount, setActiveBansTrespassesCount] = useState(0);
  const [activeBanOnlyCount, setActiveBanOnlyCount] = useState(0);
  const [activeTrespassCount, setActiveTrespassCount] = useState(0);
  const [visibleBansTrespassesCount, setVisibleBansTrespassesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingPatronInfo, setIsEditingPatronInfo] = useState(false);
  const [mergeWizardOpen, setMergeWizardOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Bans state
  interface BanWithDetails extends PatronBan {
    incident_id?: number;
    org_unit_id?: string;
    org_unit_name?: string;
  }
  const [bans, setBans] = useState<BanWithDetails[]>([]);
  const [bansLoading, setBansLoading] = useState(true);
  const [bansError, setBansError] = useState<string | null>(null);

  // Photo state
  interface PatronPhotoWithFileData {
    id: number;
    patron: number;
    file_upload: string;
    is_primary: boolean;
    file_upload_data?: {
      id: string;
      file_name: string;
      file_type: string | null;
      file_size: number | null;
      relative_path: string;
    };
  }
  const [photos, setPhotos] = useState<PatronPhotoWithFileData[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Load incidents separately from other patron data
  const loadIncidents = useCallback(async () => {
    if (!id) return;

    setIncidentsLoading(true);
    try {
      const sessionData = coreAuthApi.getSessionData();
      const userOrgUnit = sessionData?.org_unit;

      const searchParams: any = {
        patron: Number(id),
        sort_incident_date: true,
        sort_dir: 'desc',
        page: incidentsPage + 1,
        limit: incidentsRowsPerPage
      };

      // If user is not allowed to see summary, limit to their org_unit (and descendants)
      if (!canSeeSummary && userOrgUnit) {
        searchParams.org_unit = userOrgUnit;
      }

      const response = await incidentApi.searchV2(searchParams);
      setIncidents(response.items);
      setIncidentsTotal(response.total);
    } catch (err) {
      console.error('Failed to load incidents:', err);
      setIncidents([]);
      setIncidentsTotal(0);
    } finally {
      setIncidentsLoading(false);
    }
  }, [id, incidentsPage, incidentsRowsPerPage, canSeeSummary]);

  // Load patron data (without incidents)
  const loadPatronData = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const sessionData = coreAuthApi.getSessionData();
      const userOrgUnit = sessionData?.org_unit;

      // If user cannot see summary across all branches, filter statistics by org_unit
      const orgUnitParam = !canSeeSummary && userOrgUnit ? userOrgUnit : undefined;

      const summary = await patronApi.getDetailSummary(id, orgUnitParam);
      const patronNoteText = Array.isArray(summary.patron.notes)
        ? summary.patron.notes.map((n: any) => n.note).join('\n')
        : summary.patron.notes || '';

      setPatron({
        ...summary.patron,
        id: Number(summary.patron.id),
        notes: patronNoteText,
      });
      setActiveBansTrespassesCount(summary.statistics.active_bans_count);
      setActiveBanOnlyCount(summary.statistics.active_ban_only_count);
      setActiveTrespassCount(summary.statistics.active_trespass_count);
      setVisibleBansTrespassesCount(summary.statistics.visible_bans_count);
      setPhotos(summary.photos);
      setIncidentsLoading(true);
      try {
        const searchParams: any = {
          patron: Number(id),
          sort_incident_date: true,
          sort_dir: 'desc',
          page: 1,
          limit: 10
        };
        if (!canSeeSummary && userOrgUnit) {
          searchParams.org_unit = userOrgUnit;
        }
        const response = await incidentApi.searchV2(searchParams);
        setIncidents(response.items);
        setIncidentsTotal(response.total);
      } catch (err) {
        console.error('Failed to load incidents:', err);
        setIncidents([]);
        setIncidentsTotal(0);
      } finally {
        setIncidentsLoading(false);
      }
    } catch (err: any) {
      console.error('Error loading patron:', err);
      const msg = err.message || String(err);
      if (err.response?.status === 404 || msg.includes('Value code=')) {
        setError('Patron not found');
      } else {
        setError(msg || 'Failed to load patron details');
      }
    } finally {
      setLoading(false);
    }
  }, [id, canSeeSummary]);

  // Load patron data on mount or when id changes
  useEffect(() => {
    loadPatronData();
  }, [loadPatronData]);

  // Load incidents when pagination changes (but not on initial load)
  useEffect(() => {
    // Only run if patron is already loaded (not initial load)
    if (patron) {
      loadIncidents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentsPage, incidentsRowsPerPage]);

  const loadBans = useCallback(async () => {
    if (!id) return;

    try {
      setBansLoading(true);
      setBansError(null);

      const sessionData = coreAuthApi.getSessionData();
      const userOrgUnit = sessionData?.org_unit;

      const params: any = {
        patronId: Number(id),
        limit: 100,
      };

      if (!canSeeSummary && userOrgUnit) {
        params.orgUnit = userOrgUnit;
      }

      const result = await patronApi.getPatronBans(params);
      setBans(result);
    } catch (err) {
      console.error('Failed to load bans:', err);
      setBansError('Failed to load patron bans/trespasses');
    } finally {
      setBansLoading(false);
    }
  }, [id, canSeeSummary]);

  useEffect(() => {
    if (patron) {
      loadBans();
    }
  }, [patron, loadBans]);

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!id || !event.target.files || event.target.files.length === 0) return;

    const file = event.target.files[0]!;
    const validationError = uploadService.validateFile(file, 'photo');

    if (validationError) {
      showError(validationError);
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Upload file to storage
      const uploadResult = await uploadService.uploadFile(file, {
        category: 'photo',
        entity_type: 'patron',
        entity_id: id,
        onProgress: (progress) => setUploadProgress(progress)
      });

      console.log('UPLOAD', uploadResult);

      // Create patron_photo record. uploadResult.uuid is the file_upload
      // uuid that odo-asset returned from the upload call above.
      const hasPrimary = photos.some(p => p.is_primary);
      await patronApi.createPhoto(
        Number(id),
        uploadResult.uuid,
        !hasPrimary
      );

      showSuccess('Photo uploaded successfully');
      await loadPatronData();
    } catch (err: any) {
      console.error('Photo upload failed:', err);
      showError(err.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      // Reset file input
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleSetPrimaryPhoto = async (photoId: number) => {
    if (!id) return;

    try {
      await patronApi.setPrimaryPhoto(Number(id), photoId);

      showSuccess('Primary photo updated');
      await loadPatronData();
    } catch (err: any) {
      showError('Failed to set primary photo');
    }
  };

  const handleDeletePhoto = async (photoId: number) => {
    if (!id || !window.confirm('Are you sure you want to delete this photo?')) return;

    try {
      await patronApi.deletePhoto(photoId);

      showSuccess('Photo deleted');
      await loadPatronData();
    } catch (err: any) {
      showError('Failed to delete photo');
    }
  };



  const handleDeletePatron = async () => {
    if (!id) return;

    setDeleting(true);
    try {
      const result = await patronApi.delete(id);
      const msg = result.bans_lifted > 0
        ? `Patron deleted (${result.bans_lifted} ban/trespass(es) lifted)`
        : 'Patron deleted';
      showSuccess(msg);
      navigate(ROUTES.PATRONS);
    } catch (err: any) {
      showError(err.message || 'Failed to delete patron');
    } finally {
      setDeleting(false);
    }
  };

  const handlePrint = () => {
    if (!patron) return;

    const primaryPhoto = photos.find(p => p.is_primary);
    const photoUrl = primaryPhoto?.file_upload_data
      ? uploadService.getFileUrl(primaryPhoto.file_upload_data.relative_path)
      : null;

    const content = generatePatronReportHtml({
      patron,
      photoUrl,
      incidents,
      incidentsTotal,
      activeBanOnlyCount,
      activeTrespassCount,
    });

    printHtmlContent(content, {
      title: `Patron Report - ${patron.display_name}`,
      styles: getPatronReportStyles(),
    });
  };

  if (loading) {
    return (
      <PageContainer maxWidth="lg">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      </PageContainer>
    );
  }

  if (error || !patron || patron.deleted_at) {
    const isNotFound = (!error && (!patron || patron.deleted_at))
      || error?.includes('NOT_FOUND') || error?.includes('not found');

    return (
      <PageContainer maxWidth="lg">
        <EmptyStateCard
          icon={SearchOffIcon}
          iconColor={isNotFound ? 'disabled' : 'error'}
          title={isNotFound ? 'Patron Not Found' : 'Error Loading Patron'}
          description={
            isNotFound
              ? `The patron you're looking for (ID: ${id}) doesn't exist or may have been deleted.`
              : error || 'An unexpected error occurred while loading the patron.'
          }
          actionLabel="Back to Patrons"
          onAction={() => navigate(ROUTES.PATRONS)}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="lg">
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Breadcrumbs
          items={[
            { label: 'Patrons', href: ROUTES.PATRONS },
            { label: patron.display_name || `Patron #${id}` },
          ]}
          noMargin
        />
        <Box display="flex" gap={0.5} alignItems="center">
          <Tooltip title="Print">
            <IconButton onClick={handlePrint}>
              <PrintIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Report Incident">
            <IconButton onClick={() => navigate(`/incidents/new?patron_id=${id}`)}>
              <AddIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Merge">
            <IconButton onClick={() => setMergeWizardOpen(true)}>
              <MergeIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete Patron">
            <IconButton onClick={() => setDeleteDialogOpen(true)} sx={{ color: 'error.main' }}>
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Statistics Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 'auto' }}>
              <Box sx={{ position: 'relative', display: 'inline-block' }}>
                {photos.find(p => p.is_primary)?.file_upload_data ? (
                  <Avatar
                    src={uploadService.getFileUrl(photos.find(p => p.is_primary)!.file_upload_data!.relative_path)}
                    sx={{ width: 120, height: 120 }}
                  >
                    <PersonIcon sx={{ width: 60, height: 60 }} />
                  </Avatar>
                ) : (
                  <Avatar
                    sx={{ width: 120, height: 120, bgcolor: 'action.disabledBackground' }}
                  >
                    <PersonIcon sx={{ width: 60, height: 60 }} />
                  </Avatar>
                )}
                <input
                  accept="image/*"
                  style={{ display: 'none' }}
                  id="photo-upload-input"
                  type="file"
                  onChange={handlePhotoUpload}
                  disabled={uploading}
                />
                <label htmlFor="photo-upload-input">
                  <IconButton
                    component="span"
                    sx={{
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      bgcolor: 'background.paper',
                      '&:hover': { bgcolor: 'background.default' }
                    }}
                    disabled={uploading}
                    size="small"
                  >
                    <PhotoCameraIcon fontSize="small" />
                  </IconButton>
                </label>
                {uploading && (
                  <CircularProgress
                    variant="determinate"
                    value={uploadProgress}
                    size={120}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0
                    }}
                  />
                )}
              </Box>
            </Grid>

            <Grid size={{ xs: 12, md: 8 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {patron.is_unknown && (
                  <Chip
                    label="Unknown Patron"
                    color="warning"
                    size="small"
                  />
                )}
                {activeBansTrespassesCount > 0 && (
                  <Chip
                    label="Active Ban/Trespass"
                    color="error"
                    size="small"
                  />
                )}
              </Box>
              <Typography variant="h5" gutterBottom>
                {patron.display_name}
              </Typography>
              <Box sx={{ display: 'flex', gap: 6, mt: 2 }}>
                <Box>
                  <Typography variant="h6" color="primary">
                    {incidentsTotal}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Total Incidents
                    <br />
                    {canSeeSummary ? '(All Branches)' : locationLabel ? `(at ${locationLabel})` : '(Your Working Location)'}
                  </Typography>
                </Box>
                {canSeeSummary && (
                  <>
                    <Box>
                      <Typography variant="h6" color={activeBansTrespassesCount > 0 ? 'error' : 'text.primary'}>
                        {activeBansTrespassesCount}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Active Bans/Trespasses
                        <br />
                        (All Branches)
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="h6">
                        {visibleBansTrespassesCount}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Unarchived Bans/Trespasses
                        <br />
                        (All Branches)
                      </Typography>
                    </Box>
                  </>
                )}
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Patron Information */}
      <Box sx={{ mb: 3 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center" gap={1}>
            <InfoIcon />
            <Typography variant="h6">Patron Information</Typography>
          </Box>
          {!isEditingPatronInfo && (
            <Tooltip title="Edit patron information">
              <IconButton
                onClick={() => setIsEditingPatronInfo(true)}
                size="small"
              >
                <EditIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Paper sx={{ p: 3 }}>
          <PatronInfoForm
            patron={patron}
            onUpdate={loadPatronData}
            onError={showError}
            onSuccess={showSuccess}
            isEditing={isEditingPatronInfo}
            onEditStart={() => setIsEditingPatronInfo(true)}
            onEditCancel={() => setIsEditingPatronInfo(false)}
          />
        </Paper>
      </Box>

      {/* Photos Section */}
      {photos.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <PhotoCameraIcon sx={{ verticalAlign: 'middle' }} />
            Photos
          </Typography>
          <Paper sx={{ p: 3 }}>
            <ImageList
              cols={photoColumns}
              gap={8}
              sx={{
                // Prevent squished images on mobile
                gridAutoFlow: 'row'
              }}
            >
            {photos.map((photo) => (
              <ImageListItem key={photo.id}>
                <img
                  src={uploadService.getFileUrl(photo.file_upload_data!.relative_path)}
                  alt={photo.file_upload_data!.file_name}
                  loading="lazy"
                  style={{ height: 200, objectFit: 'cover' }}
                />
                <ImageListItemBar
                  title={photo.is_primary ? 'Primary Photo' : ''}
                  actionIcon={
                    <Box>
                      {!photo.is_primary && (
                        <Tooltip title="Set as primary">
                          <IconButton
                            sx={{ color: 'white', '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.2)' } }}
                            onClick={() => handleSetPrimaryPhoto(photo.id)}
                            size="small"
                          >
                            <CheckCircleIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Delete photo">
                        <IconButton
                          sx={{ color: 'white', '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.2)' } }}
                          onClick={() => handleDeletePhoto(photo.id)}
                          size="small"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                />
              </ImageListItem>
            ))}
          </ImageList>
          </Paper>
        </Box>
      )}

      {/* Incident History */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <RelatedIncidentIcon sx={{ verticalAlign: 'middle' }} />
          Related Incidents{sectionLocationSuffix}
        </Typography>
        <Paper sx={{ p: 3 }}>
          {incidentsTotal === 0 && !incidentsLoading ? (
            <Typography color="text.secondary">No incidents involving this patron</Typography>
          ) : (
            <Box sx={{ position: 'relative' }}>
            {incidentsLoading && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: (theme) => theme.palette.mode === 'dark'
                    ? 'rgba(0, 0, 0, 0.7)'
                    : 'rgba(255, 255, 255, 0.7)',
                  zIndex: 1
                }}
              >
                <CircularProgress size={40} />
              </Box>
            )}
            <PaginatedTableContainer
              count={incidentsTotal}
              page={incidentsPage}
              rowsPerPage={incidentsRowsPerPage}
              onPageChange={(newPage) => setIncidentsPage(newPage)}
              onRowsPerPageChange={(newRowsPerPage) => {
                setIncidentsRowsPerPage(newRowsPerPage);
                setIncidentsPage(0);
              }}
              minWidth={700}
              noPaper
            >
              <Table sx={{ tableLayout: 'fixed', opacity: incidentsLoading ? 0.4 : 1 }}>
                <TableHead>
                  <TableRow>
                    <TableCell width="70px">ID</TableCell>
                    <TableCell width="280px">Title</TableCell>
                    <TableCell width="120px">Status</TableCell>
                    <TableCell width="180px">Location</TableCell>
                    <TableCell width="150px">Occurred</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {incidents.map((incident) => (
                    <LinkTableRow
                      key={incident.id}
                      to={`/incidents/${incident.id}`}
                      hover
                    >
                      <LinkTableCell>
                        <Typography variant="body2" fontWeight="medium">
                          #{incident.id}
                        </Typography>
                      </LinkTableCell>
                      <LinkTableCell>
                        <Typography variant="body2">
                          {incident.title || incident.description?.substring(0, 50) || 'Untitled Incident'}
                        </Typography>
                      </LinkTableCell>
                      <LinkTableCell>
                        <Chip
                          label={getIncidentStatus(incident)}
                          size="small"
                          color={getIncidentStatusColor(getIncidentStatus(incident))}
                        />
                      </LinkTableCell>
                      <LinkTableCell>
                        <Typography variant="body2">
                          {incident.org_unit_name || 'Unknown'}
                        </Typography>
                      </LinkTableCell>
                      <LinkTableCell>
                        <Typography variant="body2">
                          {new Date(incident.occurred_at).toLocaleDateString()}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDisplayTime(incident.occurred_at)}
                        </Typography>
                      </LinkTableCell>
                    </LinkTableRow>
                  ))}
                </TableBody>
              </Table>
            </PaginatedTableContainer>
            </Box>
          )}
        </Paper>
      </Box>

      {/* Unarchived Bans & Trespasses */}
      <Box>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <GavelIcon fontSize="small" />
          <Typography variant="h6">Bans & Trespasses{sectionLocationSuffix}</Typography>
        </Box>

        {bansLoading ? (
          <Paper sx={{ p: 3 }}>
            <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
              <CircularProgress />
            </Box>
          </Paper>
        ) : bansError ? (
          <Paper sx={{ p: 3 }}>
            <Alert severity="error">{bansError}</Alert>
          </Paper>
        ) : bans.length === 0 ? (
          <Paper sx={{ p: 3 }}>
            <Alert severity="info">No bans or trespasses found</Alert>
          </Paper>
        ) : (
          <Box>
            {bans.map((ban) => (
              <PatronBanSummaryCard
                key={ban.id}
                ban={ban}
                patronId={ban.patron_id}
                patronName={ban.patron_name}
                orgUnitName={ban.org_unit_name}
              />
            ))}
          </Box>
        )}
      </Box>

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Delete Patron"
        confirmLabel="Delete"
        confirmColor="error"
        loading={deleting}
        onConfirm={handleDeletePatron}
        onCancel={() => setDeleteDialogOpen(false)}
      >
        <Typography>
          Are you sure you want to delete <strong>{patron.display_name}</strong>?
          This action cannot be undone. All active bans/trespasses will be lifted automatically.
        </Typography>
        {incidentsTotal > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            This patron is involved in {incidentsTotal} incident(s).
            The incidents will remain but will reference a deleted patron.
          </Alert>
        )}
      </ConfirmDialog>

      {/* Merge Patron Wizard */}
      {patron && (
        <PatronMergeWizard
          open={mergeWizardOpen}
          onClose={() => {
            setMergeWizardOpen(false);
          }}
          onSuccess={loadPatronData}
          primaryPatron={{
            id: String(patron.id),
            display_name: patron.display_name,
            library_card: patron.library_card || undefined,
            status: 'active' as const,
            is_unknown: patron.is_unknown,
            incident_count: incidentsTotal,
            last_incident: incidents[0]?.occurred_at,
            primary_photo_url: photos.find(p => p.is_primary)?.file_upload_data?.relative_path,
            active_ban_count: activeBanOnlyCount,
            active_trespass_count: activeTrespassCount,
          }}
        />
      )}
    </PageContainer>
  );
};

export default PatronDetail;
