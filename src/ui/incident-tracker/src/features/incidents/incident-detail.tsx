import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../../constants';
import { useAuth } from '../../contexts/auth-context';
import { useLocations } from '../../contexts/location-context';
import { useIncidents } from '../../contexts/incidents-context';
import { useTemplates } from '../../contexts/templates-context';
import {
  Paper,
  Typography,
  Box,
  Button,
  Chip,
  Divider,
  Alert,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  Grid,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Link,
  Avatar,
} from '@mui/material';
import {
  Edit as EditIcon,
  Print as PrintIcon,
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  CalendarToday as CalendarIcon,
  Article as IncidentTemplateIcon,
  Description as DescriptionIcon,
  Delete as DeleteIcon,
  Send as SendIcon,
  RateReview as RateReviewIcon,
  AttachFile as AttachFileIcon,
  PictureAsPdf as PdfIcon,
  InsertDriveFile as FileIcon,
  Download as DownloadIcon,
  SearchOff as SearchOffIcon,
  Group as GroupIcon,
  Gavel as GavelIcon,
} from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { NameAvatar } from '../../shared/components/name-avatar';
import { useToast } from '../../contexts/toast-context';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import EmptyStateCard from '../../shared/components/empty-state-card';
import { Breadcrumbs } from '../../shared/components/breadcrumbs';
import { uploadService } from '@core/api/upload';
import ReviewHistory from './components/review-history';
import { ReviewDialog, type ReviewResult } from './components/review-dialog';
import { useIncidentBans } from './hooks/use-incident-bans';
import { ActivityLogPaper } from '../../shared/components/activity-log';
import { getIncidentActivity } from '../../api/activity';
import type { ActivityLogEntry } from '../../types';
import { incidentApi } from '../../api';
import { bansApi } from '../../api/bans';
import { reviewChainApi } from '../../api/review-chain';
import { LetterViewerDialog } from '../../shared/components/letter-viewer-dialog';
import { getBanStatus } from '../../shared/utils/ban-status';
import {
  canEditIncident,
  canDeleteIncident,
  canResubmitIncident,
  canSubmitForReview,
  getReviewLevelLabel,
} from '../../shared/utils/roles';
import { getIncidentStatus, getStatusColor, getStatusLabel } from '../../shared/utils/incident-status';
import { formatDisplayDateTime } from '../../shared/utils/date-utils';
import type { IncidentTemplate } from '../../types';

const IncidentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showSuccess, showError } = useToast();

  const { currentIncident: incident, isLoading, error, fetchIncident, setCurrentIncident } = useIncidents();
  const { user } = useAuth();
  const { templates } = useTemplates();
  const { locations } = useLocations();

  const [showPhotos, setShowPhotos] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);
  const [isSubmittingForReview, setIsSubmittingForReview] = useState(false);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [hasReviewChain, setHasReviewChain] = useState<boolean | null>(null);
  const [reviewChain, setReviewChain] = useState<any[]>([]);

  type IncidentLetter = {
    id: number;
    banId: number;
    banType: 'ban' | 'trespass';
    location?: string;
    templateName: string;
    patronId: number;
    patronName: string;
    generatedAt: string;
    generatedByName?: string;
  };
  const [incidentLetters, setIncidentLetters] = useState<IncidentLetter[]>([]);
  const [viewLetterTitle, setViewLetterTitle] = useState('');
  const [viewLetterContent, setViewLetterContent] = useState<string | null>(null);
  const [viewLetterOpen, setViewLetterOpen] = useState(false);
  const [activityEntries, setActivityEntries] = useState<ActivityLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // External links are now included in the incidents.get response
  // via the with_external_links option.  Link type label is joined
  // as link_type_label on each link object.
  const externalLinks = incident?.external_links || [];

  useEffect(() => {
    if (id) {
      fetchIncident(parseInt(id));
    }
    return () => {
      setCurrentIncident(null);
    };
  }, [id, fetchIncident, setCurrentIncident]);

  // Fetch the review chain for the incident's org_unit
  useEffect(() => {
    const fetchReviewChain = async () => {
      if (incident?.org_unit) {
        try {
          const chain = await reviewChainApi.list(incident.org_unit);
          setReviewChain(chain);
          setHasReviewChain(chain.length > 0);
        } catch (err) {
          console.error('Failed to fetch review chain:', err);
          setReviewChain([]);
          setHasReviewChain(false);
        }
      }
    };
    fetchReviewChain();
  }, [incident?.org_unit]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    getIncidentActivity(parseInt(id)).then((entries) => {
      if (cancelled) return;
      setActivityEntries(entries);
    }).catch(() => {
      if (cancelled) return;
      setActivityError('Failed to load activity log');
    }).finally(() => {
      if (!cancelled) setActivityLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  // Note: Sub-location data is now joined with the incident fetch,
  // so we don't need to fetch it separately anymore

  const latestReview = reviews.length > 0 ? reviews[0] : null;
  const creatorLevel = incident?.creator_level ?? 0;
  const currentReviewLevel = latestReview?.min_review_level ?? 0;
  const userReviewLevel = incident?.user_review_level ?? null;
  const isFinalReviewer = incident?.is_final_review ?? false;
  const incidentStatus = incident ? getIncidentStatus(incident) : 'active';
  const isPendingReview = !!latestReview && ['submitted', 'approved', 'approved-with-edits'].includes(latestReview.result);
  const isReturned = latestReview?.result === 'returned';
  const isCreator = Boolean(user?.uuid && incident?.created_by === user.uuid);
  const canReopen = Boolean(user && isFinalReviewer);

  const canEdit = useMemo(() => {
    if (!incident) return false;
    return canEditIncident(
      user,
      {
        org_unit: incident.org_unit,
        created_by: incident.created_by,
        creator_level: creatorLevel,
        current_review_level: currentReviewLevel,
        latest_review_result: latestReview?.result,
        user_review_level: userReviewLevel ?? undefined,
        is_final_review: isFinalReviewer,
      },
    );
  }, [user, incident, latestReview, creatorLevel, currentReviewLevel, userReviewLevel, isFinalReviewer]);

  const canResubmit = Boolean(
    latestReview?.result === 'returned' &&
    incidentStatus !== 'resolved' &&
    canResubmitIncident(isCreator, userReviewLevel, creatorLevel, isFinalReviewer)
  );

  const canReview = useMemo(() => {
    if (!incident || !user || incidentStatus === 'resolved') return false;
    if (reviews.length === 0) return false; // Not submitted yet
    if (isReturned && canResubmitIncident(isCreator, userReviewLevel, creatorLevel, isFinalReviewer)) return false;
    if (isFinalReviewer) return true;
    return incident.can_review ?? false;
  }, [incident, user, incidentStatus, reviews.length, isFinalReviewer, isCreator, isReturned, userReviewLevel, creatorLevel]);


  const canDelete = useMemo(() => {
    if (!incident || !user) return false;
    if (reviews.length === 0) return canEdit;

    return canDeleteIncident(
      userReviewLevel,
      currentReviewLevel,
      isReturned,
      creatorLevel,
      isFinalReviewer,
      isCreator
    );
  }, [incident, user, reviews.length, canEdit, userReviewLevel, currentReviewLevel, isReturned, creatorLevel, isFinalReviewer, isCreator]);

  const getEditTooltip = (): string => {
    if (canEdit) {
      return 'Edit incident';
    }
    if (isPendingReview) {
      return `This incident is pending review. Only ${getReviewLevelLabel(currentReviewLevel)} or higher can edit.`;
    }
    if (isReturned) {
      return `This incident was returned. Only the reporter or ${getReviewLevelLabel(creatorLevel)} or higher can edit.`;
    }
    return `You do not have permission to edit this incident. Only the reporter or reviewers can edit.`;
  };

  const getDeleteTooltip = (): string => {
    if (canDelete) {
      return 'Delete incident';
    }
    if (isPendingReview) {
      return `This incident is pending review. Only ${getReviewLevelLabel(currentReviewLevel)} or higher can delete.`;
    }
    if (isReturned) {
      return `This incident was returned. Only the reporter or ${getReviewLevelLabel(creatorLevel)} or higher can delete.`;
    }
    return `You do not have permission to delete this incident. Only the reporter or reviewers can delete.`;
  };

  const formatDate = formatDisplayDateTime;

  const bans = useIncidentBans(incident);

  useEffect(() => {
    if (bans.loading || !incident) return;

    const entries: { banId: number; patronId: number; patronName: string }[] = [];
    bans.patronParties.forEach((party) => {
      const patronId = parseInt(party.patron_id!, 10);
      (bans.bansByPatron.get(patronId) || [])
        .forEach((ban) => entries.push({
          banId: ban.id,
          patronId,
          patronName: party.patron_display?.display_name || `Patron #${patronId}`,
        }));
    });

    if (entries.length === 0) {
      setIncidentLetters([]);
      return;
    }

    Promise.all(
      entries.map(async ({ banId, patronId, patronName }) => {
        try {
          const details = await bansApi.getBanDetails(banId);
          const latest = details.letters.find((letter) => letter.incident === incident.id);
          if (!latest) return [];
          return [{
            id: latest.id,
            banId,
            banType: (details.ban.is_trespass ? 'trespass' : 'ban') as 'ban' | 'trespass',
            location: details.ban.org_unit_name,
            templateName: latest.template_name ?? '',
            patronId,
            patronName,
            generatedAt: latest.generated_at,
            generatedByName: latest.generated_by_name,
          }];
        } catch {
          return [];
        }
      }),
    ).then((results) => {
      setIncidentLetters(
        results.flat().sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()),
      );
    });
  }, [bans.loading, bans.patronParties, bans.bansByPatron, incident?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleViewLetter = async (letterId: number, title: string) => {
    setViewLetterTitle(title);
    setViewLetterContent(null);
    setViewLetterOpen(true);
    try {
      const result = await bansApi.getBanLetter(letterId);
      setViewLetterContent(result?.content ?? null);
    } catch {
      setViewLetterContent(null);
    }
  };

  const [isReopening, setIsReopening] = useState(false);

  const handleReopen = async () => {
    if (!incident || !user) return;

    if (!window.confirm('Are you sure you want to reopen this incident? It will be submitted for review again.')) {
      return;
    }

    setIsReopening(true);
    try {
      await incidentApi.createReview(incident.id, 'reopened', 'Incident reopened for further review');

      showSuccess(`Incident #${incident.id} has been reopened`);
      fetchIncident(incident.id);
    } catch (err: any) {
      showError(`Failed to reopen incident: ${err.message || 'Unknown error'}`);
    } finally {
      setIsReopening(false);
    }
  };

  const handleSubmitForReview = async (isResubmission: boolean = false) => {
    if (!incident || !user) return;

    setIsSubmittingForReview(true);
    try {
      const comments = isResubmission
        ? 'Resubmitted after requested changes'
        : 'Initial submission for review';

      await incidentApi.createReview(incident.id, 'submitted', comments);

      showSuccess(`Incident #${incident.id} ${isResubmission ? 'resubmitted' : 'submitted'} for review`);

      fetchIncident(incident.id);
    } catch (err: any) {
      showError(`Failed to ${isResubmission ? 'resubmit' : 'submit'} incident for review: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSubmittingForReview(false);
    }
  };

  const handleReviewSubmit = async (result: ReviewResult, comments: string) => {
    if (!incident) return;

    try {
      await incidentApi.createReview(incident.id, result, comments || undefined);

      const resultText = {
        'submitted': 'submitted for review',
        'approved': 'approved and forwarded',
        'approved-with-edits': 'approved with edits',
        'returned': 'returned for changes',
        'deleted': 'deleted',
        'resolved': 'review completed'
      }[result] || result;

      showSuccess(`Incident #${incident.id} ${resultText}`);
      setShowReviewDialog(false);

      fetchIncident(incident.id);
    } catch (err: any) {
      const errorMessage = err.message || 'Unknown error';

      if (errorMessage.includes('notification') || errorMessage.includes('capability')) {
        showSuccess(`Review submitted, but notification could not be sent. The review has been recorded.`);
        setShowReviewDialog(false);
        fetchIncident(incident.id);
      } else if (errorMessage.includes('UNAUTHORIZED') || errorMessage.includes('Required roles')) {
        showError(`You do not have permission to perform this review action.`);
        throw err;
      } else {
        showError(`Failed to review incident: ${errorMessage}`);
        throw err;
      }
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDelete = async () => {
    if (!incident || !user) return;

    if (window.confirm('Are you sure you want to delete this incident? This action cannot be undone.')) {
      try {
        await incidentApi.createReview(incident.id, 'deleted', 'Incident deleted');

        showSuccess(`Incident #${incident.id} deleted`);

        navigate(ROUTES.INCIDENTS);
      } catch (err: any) {
        showError(`Failed to delete incident: ${err.message || 'Unknown error'}`);
      }
    }
  };

  if (isLoading) {
    return (
      <PageContainer maxWidth="lg">
        <LoadingSkeleton variant="card" rows={8} />
      </PageContainer>
    );
  }

  if (error || !incident) {
    const isNotFound = error?.includes('NOT_FOUND') || error?.includes('not found');

    return (
      <PageContainer maxWidth="lg">
        <EmptyStateCard
          icon={SearchOffIcon}
          iconColor={isNotFound ? 'disabled' : 'error'}
          title={isNotFound ? 'Incident Not Found' : 'Error Loading Incident'}
          description={
            isNotFound
              ? `The incident you're looking for (ID: ${id}) doesn't exist or may have been deleted.`
              : error || 'An unexpected error occurred while loading the incident.'
          }
          actionLabel="Back to Incidents"
          onAction={() => navigate(ROUTES.INCIDENTS)}
        />
      </PageContainer>
    );
  }

  const incidentTemplates = incident.template_ids
    ? incident.template_ids.map(tid => templates.find(t => t.id === tid)).filter((t): t is IncidentTemplate => t !== undefined)
    : [];
  const locationInfo = locations.find(l => l.uuid === incident.org_unit);

  return (
    <PageContainer maxWidth="lg">
      {/* Success/Error Messages from navigation state */}
      {location.state?.message && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => {}}>
          {location.state.message}
        </Alert>
      )}

      {/* Header Actions */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Breadcrumbs
          items={[
            { label: 'Incidents', href: ROUTES.INCIDENTS },
            { label: `Incident #${id}` },
          ]}
          noMargin
        />
        <Box display="flex" gap={1}>
          <Tooltip title="Create ban / trespass">
            <IconButton onClick={() => navigate(`/incidents/${id}/create-ban`)}>
              <GavelIcon />
            </IconButton>
          </Tooltip>

          <Tooltip title="Print incident report">
            <IconButton onClick={handlePrint}>
              <PrintIcon />
            </IconButton>
          </Tooltip>

          <Tooltip title={getEditTooltip()}>
            <span>
              <IconButton
                component={RouterLink}
                to={`/incidents/${id}/edit`}
                disabled={!canEdit}
              >
                <EditIcon />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title={getDeleteTooltip()}>
            <span>
              <IconButton
                color="error"
                onClick={handleDelete}
                disabled={!canDelete}
              >
                <DeleteIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* Main Content */}
      <Grid container spacing={3}>
        {/* Left Column - Main Details */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ p: 3, mb: 3 }}>
            {/* Header */}
            <Box display="flex" alignItems="center" gap={1} mb={1} flexWrap="wrap">
              <Typography variant="h4" component="h1">
                Incident #{incident.id}
              </Typography>
              <Chip
                label={getStatusLabel(incidentStatus)}
                color={getStatusColor(incidentStatus) as any}
                size="small"
              />
              {incident.called_emergency && (
                <Chip label="Called 911/988" color="info" variant="outlined" size="small" />
              )}
            </Box>
            <Typography variant="h6" color="text.secondary" sx={{ mb: 3 }}>
              {incident.title || 'Untitled Incident'}
            </Typography>

            <Divider sx={{ mb: 3 }} />

            {/* Description */}
            <Box mb={3}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Description
              </Typography>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                {incident.description}
              </Typography>
            </Box>

            {/* Custom Fields from Template */}
            {incident.metadata && Object.keys(incident.metadata).length > 0 && (
              <>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Additional Details
                </Typography>
                <Box sx={{ pl: 2 }}>
                  {Object.entries(incident.metadata).filter(([key]) =>
                    // Filter out internal metadata fields and patron fields (now shown in Patron Details)
                    !['attachments', 'external_links', 'quick_resolved',
                     'resolved_by_name', 'reopened', 'reopened_at', 'reopened_by',
                     'patron_name', 'patron_library_card', 'patron_notes', 'patron_details',
                     'pending_bans'].includes(key)
                  ).map(([key, value]) => {
                    // Handle template_fields specially
                    if (key === 'template_fields' && typeof value === 'object' && value !== null) {
                      return (
                        <Box key={key} mb={2}>
                          <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                            Template Fields:
                          </Typography>
                          <Box sx={{ pl: 2 }}>
                            {Object.entries(value as Record<string, any>).map(([fieldKey, fieldValue]) => (
                              <Box key={fieldKey} display="flex" mb={0.5}>
                                <Typography variant="body2" sx={{ fontWeight: 'medium', mr: 1 }}>
                                  {fieldKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}:
                                </Typography>
                                <Typography variant="body2">
                                  {typeof fieldValue === 'boolean' ? (fieldValue ? 'Yes' : 'No') : 
                                   fieldValue === null || fieldValue === undefined ? 'N/A' :
                                   String(fieldValue)}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      );
                    }
                    
                    // Skip objects that would display as [object Object]
                    if (typeof value === 'object' && value !== null) {
                      return null;
                    }
                    
                    return (
                      <Box key={key} display="flex" mb={1}>
                        <Typography variant="body2" sx={{ fontWeight: 'bold', mr: 1 }}>
                          {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}:
                        </Typography>
                        <Typography variant="body2">
                          {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </>
            )}

            {/* Attachments - Photos, Documents, Videos */}
            {(() => {
              // `incident/get` decorates these from odo-asset when
              // `options.with_attachments` is set; we always request it
              // for the detail page (see incidentApi.get).
              const attachments = incident.attachments || [];
              if (attachments.length === 0) return null;

              const photoAttachments = attachments.filter((a: any) => a.category === 'photo');
              const documentAttachments = attachments.filter((a: any) => a.category === 'document');
              const videoAttachments = attachments.filter((a: any) => a.category === 'video');

              return (
                <Box>
                  <Box display="flex" alignItems="center" mb={2}>
                    <AttachFileIcon sx={{ mr: 1 }} />
                    <Typography variant="subtitle2">
                      Attachments ({attachments.length})
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => setShowPhotos(!showPhotos)}
                      sx={{ ml: 'auto' }}
                    >
                      {showPhotos ? 'Hide' : 'Show'}
                    </Button>
                  </Box>
                  {showPhotos && (
                    <Box>
                      {/* Photos Gallery */}
                      {photoAttachments.length > 0 && (
                        <Box mb={3}>
                          <Typography variant="caption" fontWeight="bold" display="block" mb={1}>
                            Photos ({photoAttachments.length})
                          </Typography>
                          <Box display="flex" gap={2} flexWrap="wrap">
                            {photoAttachments.map((photo: any) => (
                              <Box
                                key={`photo-${photo.id}`}
                                sx={{
                                  position: 'relative',
                                  width: 250,
                                  height: 200,
                                  borderRadius: 1,
                                  overflow: 'hidden',
                                  border: '1px solid',
                                  borderColor: 'divider',
                                  cursor: 'pointer',
                                  '&:hover': {
                                    boxShadow: 3,
                                  },
                                }}
                                onClick={() => window.open(uploadService.getFileUrl(photo.relative_path), '_blank')}
                              >
                                <Box
                                  component="img"
                                  src={uploadService.getFileUrl(photo.relative_path)}
                                  alt={photo.original_name}
                                  sx={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                  }}
                                />
                                <Box
                                  sx={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
                                    color: 'white',
                                    p: 1,
                                  }}
                                >
                                  <Typography variant="caption" sx={{ fontSize: '11px' }}>
                                    {photo.original_name}
                                  </Typography>
                                </Box>
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      )}

                      {/* Videos */}
                      {videoAttachments.length > 0 && (
                        <Box mb={3}>
                          <Typography variant="caption" fontWeight="bold" display="block" mb={1}>
                            Videos ({videoAttachments.length})
                          </Typography>
                          <Box display="flex" gap={2} flexWrap="wrap">
                            {videoAttachments.map((video: any) => (
                              <Box key={`video-${video.id}`} sx={{ maxWidth: 400 }}>
                                <Box
                                  component="video"
                                  width="100%"
                                  sx={{ borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                                  controls
                                  src={uploadService.getFileUrl(video.relative_path)}
                                >
                                  Your browser does not support the video tag.
                                </Box>
                                <Typography variant="caption" display="block" mt={0.5}>
                                  {video.original_name} • {uploadService.formatFileSize(video.size)}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      )}

                      {/* Documents */}
                      {documentAttachments.length > 0 && (
                        <Box mb={3}>
                          <Typography variant="caption" fontWeight="bold" display="block" mb={1}>
                            Documents ({documentAttachments.length})
                          </Typography>
                          <Box display="flex" flexDirection="column" gap={1}>
                            {documentAttachments.map((doc: any) => {
                              const getIcon = () => {
                                if (doc.mime_type?.includes('pdf')) return <PdfIcon color="error" />;
                                return <FileIcon />;
                              };

                              return (
                                <Box
                                  key={`doc-${doc.id}`}
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    p: 1.5,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    borderRadius: 1,
                                    bgcolor: 'background.paper',
                                    '&:hover': {
                                      bgcolor: 'action.hover',
                                    },
                                  }}
                                >
                                  {getIcon()}
                                  <Box sx={{ flex: 1 }}>
                                    <Typography variant="body2">{doc.original_name}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {uploadService.formatFileSize(doc.size)}
                                    </Typography>
                                  </Box>
                                  <IconButton
                                    size="small"
                                    component="a"
                                    href={uploadService.getFileUrl(doc.relative_path)}
                                    target="_blank"
                                    download={doc.original_name}
                                  >
                                    <DownloadIcon fontSize="small" />
                                  </IconButton>
                                </Box>
                              );
                            })}
                          </Box>
                        </Box>
                      )}

                    </Box>
                  )}
                </Box>
              );
            })()}

            {/* External Links */}
            {externalLinks.length > 0 && (
              <>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  External Links
                </Typography>
                <Box sx={{ pl: 2 }}>
                  {externalLinks.map((link: any) => {
                    // link_type_label is joined by the backend
                    const linkTypeLabel = link.link_type_label;
                    const formatLabel = (label: string) => {
                      return label.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
                    };

                    return (
                      <Box key={`link-${link.id}`} mb={2}>
                        <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                            {link.title}
                          </Typography>
                          {linkTypeLabel && (
                            <Chip
                              label={formatLabel(linkTypeLabel)}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20 }}
                            />
                          )}
                        </Box>
                        <Box sx={{ mb: link.description ? 0.5 : 0 }}>
                          <Typography
                            variant="body2"
                            component="a"
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: 'primary.main',
                              textDecoration: 'none',
                              wordBreak: 'break-all',
                              '&:hover': {
                                textDecoration: 'underline',
                              },
                            }}
                          >
                            {link.url}
                          </Typography>
                        </Box>
                        {link.description && (
                          <Typography variant="body2" color="text.secondary">
                            {link.description}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              </>
            )}

            <Box mt={3} display="flex" gap={2}>
              {incident && user && reviews.length === 0 &&
                incidentStatus !== 'resolved' &&
                canSubmitForReview(user, isCreator, userReviewLevel) && (
                <Tooltip
                  title={hasReviewChain === false
                    ? "This location has no review process configured. Contact an administrator to set up the review process."
                    : ""}
                >
                  <span>
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={<SendIcon />}
                      onClick={() => handleSubmitForReview(false)}
                      disabled={isSubmittingForReview || hasReviewChain !== true}
                    >
                      {isSubmittingForReview ? 'Submitting...' : 'Submit for Review'}
                    </Button>
                  </span>
                </Tooltip>
              )}

              {canResubmit && (
                <Tooltip
                  title={hasReviewChain === false
                    ? "This location has no review process configured. Contact an administrator to set up the review process."
                    : ""}
                >
                  <span>
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={<SendIcon />}
                      onClick={() => handleSubmitForReview(true)}
                      disabled={isSubmittingForReview || hasReviewChain !== true}
                    >
                      {isSubmittingForReview ? 'Resubmitting...' : 'Resubmit for Review'}
                    </Button>
                  </span>
                </Tooltip>
              )}

              {canReview && (
                <Button
                  variant="contained"
                  color={isFinalReviewer ? 'success' : 'primary'}
                  startIcon={<RateReviewIcon />}
                  onClick={() => setShowReviewDialog(true)}
                >
                  {isFinalReviewer ? 'Complete Review' : 'Review'}
                </Button>
              )}

              {canReopen && incidentStatus === 'resolved' && (
                <Button
                  variant="contained"
                  color="warning"
                  startIcon={<RefreshIcon />}
                  onClick={handleReopen}
                  disabled={isReopening}
                >
                  {isReopening ? 'Reopening...' : 'Reopen Incident'}
                </Button>
              )}
            </Box>
          </Paper>

          {/* Involved Parties */}
          {bans.parties.length > 0 && (
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <GroupIcon fontSize="small" sx={{ mr: 1 }} />
                Involved Parties
              </Typography>
              <List>
                {bans.parties.map((party, index) => (
                  <ListItem key={index} sx={{ alignItems: 'center', gap: 1 }}>
                    <ListItemIcon sx={{ minWidth: 'auto' }}>
                      {(() => {
                        if (party.patron_id) {
                          const pid = parseInt(party.patron_id, 10);
                          const photoPath = bans.patronPhotos.get(pid);
                          const photoUrl = photoPath ? uploadService.getFileUrl(photoPath) : undefined;
                          return (
                            <Avatar src={photoUrl} sx={{ width: 32, height: 32 }}>
                              <PersonIcon fontSize="small" />
                            </Avatar>
                          );
                        }
                        return <NameAvatar name={party.non_patron_name || '?'} />;
                      })()}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                          {party.patron_id ? (
                            <Link
                              component={RouterLink}
                              to={`/patrons/${party.patron_id}`}
                              variant="body2"
                              sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                            >
                              {party.patron_display?.display_name || party.patron_id}
                            </Link>
                          ) : (
                            <Typography variant="body2" component="span">
                              {party.non_patron_name || 'Unknown'}
                            </Typography>
                          )}
                          {party.patron_id && (() => {
                            const pid = parseInt(party.patron_id!, 10);
                            const patronBans = bans.bansByPatron.get(pid) || [];
                            const isRelevant = (b: typeof patronBans[0]) => {
                              const s = getBanStatus(b);
                              return s.color === 'error' || s.color === 'warning';
                            };
                            const displayBan =
                              patronBans.find((b) => b.is_trespass && isRelevant(b)) ??
                              patronBans.find((b) => !b.is_trespass && isRelevant(b));
                            if (!displayBan) return null;
                            const status = getBanStatus(displayBan);
                            const parenthetical = status.label.match(/\((.+)\)/)?.[1];
                            const daysLabel = parenthetical ? ` (${parenthetical})` : '';
                            const label = displayBan.is_trespass
                              ? `Trespass${daysLabel}`
                              : `Ban${daysLabel}`;
                            return (
                              <Chip
                                label={label}
                                size="small"
                                color={status.color}
                                sx={{ height: 20 }}
                              />
                            );
                          })()}
                        </Box>
                      }
                      secondary={party.notes || undefined}
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}

          {/* Ban/Trespass Letters — all ban/trespass letters generated from this incident */}
          {incidentLetters.length > 0 && (
            <Paper sx={{ p: 3 }}>
              <Box display="flex" alignItems="center" gap={1}>
                <DescriptionIcon fontSize="small" sx={{ display: 'flex' }} />
                <Typography variant="h6" sx={{ lineHeight: 1 }}>Ban/Trespass Letters</Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 2.5, pl: 2.5 }}>
                {incidentLetters.map((letter) => (
                  <Box key={letter.id} display="flex" alignItems="center" justifyContent="space-between">
                    <Box>
                      <Typography variant="body2">{letter.templateName}</Typography>
                      <Typography variant="caption" color="text.secondary">{letter.patronName}</Typography>
                    </Box>
                    <Box display="flex" gap={1} flexShrink={0}>
                      <Button
                        size="small"
                        variant="contained"
                        disableElevation
                        onClick={() => handleViewLetter(
                          letter.id,
                          `${letter.banType === 'trespass' ? 'Trespass' : 'Ban'} Letter — ${letter.patronName}`,
                        )}
                      >
                        View Letter
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        component={RouterLink}
                        to={`/bans/${letter.banId}`}
                      >
                        Detail
                      </Button>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Paper>
          )}

          {/* Activity Logs — excludes review events (shown in Review History) */}
          <ActivityLogPaper
            title="Incident History"
            entries={activityEntries.filter((e) => !e.event_type.startsWith('incident.review'))}
            loading={activityLoading}
            error={activityError}
            showBanLink
          />
        </Grid>

        {/* Right Column - Metadata */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Incident Information
              </Typography>
              
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <CalendarIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Occurred"
                    secondary={formatDate(incident.occurred_at)}
                  />
                </ListItem>

                <ListItem>
                  <ListItemIcon>
                    <PersonIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Reporter"
                    secondary={incident.created_by_name || 'Unknown'}
                  />
                </ListItem>
                
                <ListItem>
                  <ListItemIcon>
                    <LocationIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Location"
                    secondary={
                      <>
                        {locationInfo?.label || incident.org_unit_name || 'Unknown'}
                        {incident.sub_location && (
                          <Typography variant="caption" display="block">
                            Sub-location: {incident.sub_location_name || incident.metadata?.sub_location_name || `ID: ${incident.sub_location}`}
                          </Typography>
                        )}
                      </>
                    }
                  />
                </ListItem>


                <ListItem>
                  <ListItemIcon>
                    <IncidentTemplateIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={incidentTemplates.length > 1 ? 'Templates' : 'Template'}
                    secondary={
                      incidentTemplates.length > 0
                        ? incidentTemplates.map(t => t.name).join(', ')
                        : 'General Incident'
                    }
                  />
                </ListItem>
                
                {incident.resolved_at && (
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircleIcon fontSize="small" color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Review Complete"
                      secondary={formatDate(incident.resolved_at)}
                    />
                  </ListItem>
                )}
              </List>
            </CardContent>
          </Card>

          {/* Notes */}
          {incident.notes && (
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  <DescriptionIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Notes
                </Typography>
                <Typography variant="body2">
                  {incident.notes}
                </Typography>
              </CardContent>
            </Card>
          )}

          {/* Review History */}
          <Box mt={3}>
            <ReviewHistory
              incidentId={incident.id}
              incidentStatus={incidentStatus as 'draft' | 'pending' | 'resolved' | 'deleted'}
              reviewChain={reviewChain.map(c => ({
                review_level: c.review_level,
                is_final: c.is_final,
                reviewer_group: c.reviewer_group,
                reviewer_ids: c.reviewer_ids,
                reviewer_names: c.reviewer_names,
                require_peer_review: c.require_peer_review,
              }))}
              onReviewsLoaded={(loadedReviews) => setReviews(loadedReviews)}
              createdBy={incident.created_by}
            />
          </Box>
        </Grid>
      </Grid>

      <LetterViewerDialog
        open={viewLetterOpen}
        title={viewLetterTitle}
        content={viewLetterContent}
        onClose={() => setViewLetterOpen(false)}
      />

      {/* Review Dialog */}
      <ReviewDialog
        incident={showReviewDialog ? incident : null}
        action="approve"
        reviewLevel={userReviewLevel}
        isFinalReview={incident?.is_final_review ?? false}
        reviewCount={reviews.length}
        latestReviewResult={latestReview?.result}
        onClose={() => setShowReviewDialog(false)}
        onConfirm={handleReviewSubmit}
      />
    </PageContainer>
  );
};

export default IncidentDetail;
