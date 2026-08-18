import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Alert,
  Button,
  Chip,
  Link,
  Skeleton,
} from '@mui/material';
import {
  AssignmentOutlined as IncidentCreatedIcon,
  Edit as IncidentUpdatedIcon,
  RateReview as ReviewIcon,
  CheckCircle as ApprovedIcon,
  Cancel as ReturnedIcon,
  AssignmentTurnedIn as ApprovedWithEditsIcon,
  PersonAdd as BanCreatedIcon,
  UpdateOutlined as BanExtendedIcon,
  LockOpen as BanLiftedIcon,
  Archive as BanArchivedIcon,
  Description as LetterIcon,
  StickyNote2Outlined as NoteIcon,
  History as HistoryIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { uploadService } from '@core';
import type { ActivityLogEntry } from '../../types';
import { formatTimestamp, formatBanDate } from '../utils/date-utils';

// --- Types ---

type DotColor = 'grey' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

interface EventConfig {
  label: string;
  icon: React.ReactElement;
  color: DotColor;
}

interface ActivityLogRowProps {
  entry: ActivityLogEntry;
  isLast: boolean;
  showBanLink: boolean;
  showIncidentLink: boolean;
  onViewLetter?: (letterId: number) => void;
}

interface ActivityLogProps {
  entries: ActivityLogEntry[];
  loading?: boolean;
  showBanLink?: boolean;
  showIncidentLink?: boolean;
  onViewLetter?: (letterId: number) => void;
}

interface ActivityLogPaperProps extends ActivityLogProps {
  title?: string;
  error?: string | null;
}

// --- Constants ---

const DOT_SIZE = 28;

const EVENT_CONFIG: Record<string, EventConfig> = {
  'ban.created':                         { label: 'Ban/Trespass Created',     icon: <BanCreatedIcon sx={{ fontSize: 16 }} />,           color: 'error'   },
  'ban.extended':                        { label: 'Ban/Trespass Extended',    icon: <BanExtendedIcon sx={{ fontSize: 16 }} />,          color: 'warning' },
  'ban.lifted':                          { label: 'Ban/Trespass Lifted',      icon: <BanLiftedIcon sx={{ fontSize: 16 }} />,            color: 'success' },
  'ban.archived':                        { label: 'Ban/Trespass Archived',    icon: <BanArchivedIcon sx={{ fontSize: 16 }} />,          color: 'grey'    },
  'ban.updated':                         { label: 'Ban/Trespass Updated',     icon: <IncidentUpdatedIcon sx={{ fontSize: 16 }} />,      color: 'info'    },
  'ban.letter_generated':                { label: 'Letter Generated',         icon: <LetterIcon sx={{ fontSize: 16 }} />,               color: 'primary' },
  'ban.letter_regenerated':              { label: 'Letter Regenerated',       icon: <LetterIcon sx={{ fontSize: 16 }} />,               color: 'primary' },
  'ban.note':                            { label: 'Note Added',              icon: <NoteIcon sx={{ fontSize: 16 }} />,                 color: 'info'    },
  'incident.created':                    { label: 'Incident Report Created', icon: <IncidentCreatedIcon sx={{ fontSize: 16 }} />,      color: 'primary' },
  'incident.updated':                    { label: 'Incident Report Updated', icon: <IncidentUpdatedIcon sx={{ fontSize: 16 }} />,      color: 'grey'    },
  'incident.review.submitted':           { label: 'Review Submitted',    icon: <ReviewIcon sx={{ fontSize: 16 }} />,               color: 'info'    },
  'incident.review.approved':            { label: 'Review Approved',     icon: <ApprovedIcon sx={{ fontSize: 16 }} />,             color: 'success' },
  'incident.review.returned':            { label: 'Review Returned',     icon: <ReturnedIcon sx={{ fontSize: 16 }} />,             color: 'error'   },
  'incident.review.approved_with_edits': { label: 'Approved with Edits', icon: <ApprovedWithEditsIcon sx={{ fontSize: 16 }} />,    color: 'warning' },
};

const DOT_COLOR_MAP: Record<DotColor, string> = {
  grey:      'grey.400',
  primary:   'primary.main',
  secondary: 'secondary.main',
  error:     'error.main',
  info:      'info.main',
  success:   'success.main',
  warning:   'warning.main',
};

const FIELD_LABELS: Record<string, string> = {
  starts_at:              'Start Date',
  lifts_at:               'Lift Date',
  archives_at:            'Archive Date',
  case_number:            'Case #',
  law_enforcement_agency: 'Agency',
  comments:               'Comments',
};

const DATE_FIELDS = new Set(['starts_at', 'lifts_at', 'archives_at']);

// Events whose flat event_data fields are internal metadata, not display values
const SKIP_FLAT_DISPLAY = new Set(['ban.letter_generated', 'ban.letter_regenerated', 'incident.created']);

const footerLinkSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.25,
  cursor: 'pointer',
  textDecoration: 'none',
  color: 'text.disabled',
  '&:hover': { color: 'primary.main' },
} as const;

// --- Helpers ---

function getEventConfig(eventType: string): EventConfig {
  return EVENT_CONFIG[eventType] ?? {
    label: eventType,
    icon: <HistoryIcon sx={{ fontSize: 16 }} />,
    color: 'grey',
  };
}

function formatFieldValue(field: string, val: string): string {
  return DATE_FIELDS.has(field) ? formatBanDate(val) : val;
}

// --- Components ---

const ActivityLogRow: React.FC<ActivityLogRowProps> = ({
  entry,
  isLast,
  showBanLink,
  showIncidentLink,
  onViewLetter,
}) => {
  const { label, icon, color } = getEventConfig(entry.event_type);
  const data = entry.event_data ?? {};

  const metaItems: { label: string; value: React.ReactNode }[] = [];

  if (data.changes && typeof data.changes === 'object') {
    // Structured diff: { field: { from, to } }
    for (const [field, diff] of Object.entries(data.changes as Record<string, { from?: string | null; to: string }>)) {
      const fieldLabel = FIELD_LABELS[field] ?? field;
      const toVal = formatFieldValue(field, diff.to);
      const fromVal = diff.from ? formatFieldValue(field, diff.from) : null;
      metaItems.push({
        label: fieldLabel,
        value: fromVal ? (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <Box component="s" sx={{ color: 'text.disabled', mr: 1 }}>{fromVal}</Box>
            <Box component="span" sx={{ mr: 1 }}>{'→'}</Box>
            {toVal}
          </Box>
        ) : toVal,
      });
    }
  } else if (!SKIP_FLAT_DISPLAY.has(entry.event_type)) {
    for (const [field, fieldLabel] of Object.entries(FIELD_LABELS)) {
      if (data[field]) {
        metaItems.push({ label: fieldLabel, value: formatFieldValue(field, String(data[field])) });
      }
    }
  }

  const hasAttachments = (entry.attachments?.length ?? 0) > 0;
  const hasLinks = (entry.external_links?.length ?? 0) > 0;
  const showFooterLinks = (showBanLink && entry.ban_id) || (showIncidentLink && entry.incident_id);

  return (
    <Box display="flex">
      <Box sx={{ width: 100, flexShrink: 0, textAlign: 'right', pr: 2, mt: '-2px' }}>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {formatTimestamp(entry.created_at, 'MMM dd, yyyy')}
        </Typography>
        <Typography variant="caption" color="text.disabled" display="block" sx={{ whiteSpace: 'nowrap' }}>
          {formatTimestamp(entry.created_at, 'h:mm a')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, mt: '3px' }}>
        <Box
          sx={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: '50%',
            bgcolor: DOT_COLOR_MAP[color],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        {!isLast && <Box sx={{ width: 2, flex: 1, bgcolor: 'divider', minHeight: 16 }} />}
      </Box>

      <Box sx={{ flex: 1, pl: 2, pb: isLast ? 0 : 3 }}>
        <Typography variant="body2" fontWeight={600}>{label}</Typography>

        {entry.actor_name && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            by {entry.actor_name}
          </Typography>
        )}

        {metaItems.length > 0 && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '2px 12px',
              mt: 0.75,
              bgcolor: 'action.hover',
              borderRadius: 0.5,
              px: 1,
              py: 0.5,
            }}
          >
            {metaItems.map((item) => (
              <React.Fragment key={item.label}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
                  {item.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'break-word', minWidth: 0 }}>
                  {item.value}
                </Typography>
              </React.Fragment>
            ))}
          </Box>
        )}

        {hasAttachments && (() => {
          const photoFiles = entry.attachments!.filter((f) => (f as any).category === 'photo');
          const otherFiles = entry.attachments!.filter((f) => (f as any).category !== 'photo');
          return (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                Attachments ({entry.attachments!.length})
              </Typography>
              {photoFiles.length > 0 && (
                <Box display="flex" gap={1.5} flexWrap="wrap" mb={otherFiles.length > 0 ? 1 : 0}>
                  {photoFiles.map((file, i) => (
                    <Box
                      key={`photo-${i}`}
                      sx={{
                        width: 180,
                        height: 140,
                        borderRadius: 1,
                        overflow: 'hidden',
                        border: '1px solid',
                        borderColor: 'divider',
                        cursor: 'pointer',
                        '&:hover': { boxShadow: 3 },
                      }}
                      onClick={() => window.open(uploadService.getFileUrl((file as any).relative_path), '_blank')}
                    >
                      <Box
                        component="img"
                        src={uploadService.getFileUrl((file as any).relative_path)}
                        alt={(file as any).original_name}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </Box>
                  ))}
                </Box>
              )}
              {otherFiles.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {otherFiles.map((file, i) => (
                    <Box
                      key={`file-${i}`}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75, bgcolor: 'action.hover', borderRadius: 0.5 }}
                    >
                      <Chip label={(file as any).category} size="small" />
                      <Link href={uploadService.getFileUrl((file as any).relative_path)} target="_blank" rel="noopener noreferrer" variant="caption">
                        {(file as any).original_name}
                      </Link>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          );
        })()}

        {hasLinks && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
              External Links ({entry.external_links!.length})
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {entry.external_links!.map((link, i) => (
                <Box key={i} sx={{ p: 0.75, bgcolor: 'action.hover', borderRadius: 0.5 }}>
                  <Link href={link.url} target="_blank" rel="noopener noreferrer" variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.25 }}>
                    {link.title}
                  </Link>
                  {link.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {link.description}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {entry.letter && (
          onViewLetter ? (
            <Button
              size="small"
              variant="outlined"
              onClick={() => onViewLetter(entry.letter!.id)}
              sx={{ mt: 0.75, textTransform: 'none', fontSize: '0.75rem', py: 0.25, px: 1 }}
            >
              View Letter
            </Button>
          ) : (
            <Button
              size="small"
              variant="outlined"
              component={RouterLink}
              to={`/bans/${entry.ban_id}`}
              sx={{ mt: 0.75, textTransform: 'none', fontSize: '0.75rem', py: 0.25, px: 1 }}
            >
              View Letter
            </Button>
          )
        )}

        {showFooterLinks && (
          <Box display="flex" gap={1.5} mt={0.5} flexWrap="wrap" alignItems="center">
            {showBanLink && entry.ban_id && (
              <Link component={RouterLink} to={`/bans/${entry.ban_id}`} variant="caption" sx={footerLinkSx}>
                Ban #{entry.ban_id} <OpenInNewIcon sx={{ fontSize: 11 }} />
              </Link>
            )}
            {showIncidentLink && entry.incident_id && (
              <Link component={RouterLink} to={`/incidents/${entry.incident_id}`} variant="caption" sx={footerLinkSx}>
                Incident #{entry.incident_id} <OpenInNewIcon sx={{ fontSize: 11 }} />
              </Link>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export const ActivityLog: React.FC<ActivityLogProps> = ({
  entries,
  loading = false,
  showBanLink = false,
  showIncidentLink = false,
  onViewLetter,
}) => {
  if (loading) {
    return (
      <Box>
        <Skeleton variant="rounded" height={64} sx={{ mb: 1 }} />
        <Skeleton variant="rounded" height={64} sx={{ mb: 1 }} />
        <Skeleton variant="rounded" height={64} />
      </Box>
    );
  }

  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No activity recorded yet.
      </Typography>
    );
  }

  return (
    <Box>
      {entries.map((entry, idx) => (
        <ActivityLogRow
          key={entry.id}
          entry={entry}
          isLast={idx === entries.length - 1}
          showBanLink={showBanLink}
          showIncidentLink={showIncidentLink}
          onViewLetter={onViewLetter}
        />
      ))}
    </Box>
  );
};

export const ActivityLogPaper: React.FC<ActivityLogPaperProps> = ({
  title = 'Activity Log',
  error,
  ...rest
}) => (
  <Paper sx={{ p: 3, mt: 3 }}>
    <Box display="flex" alignItems="center" gap={1} mb={2.5}>
      <HistoryIcon fontSize="small" sx={{ display: 'flex' }} />
      <Typography variant="h6" sx={{ lineHeight: 1 }}>{title}</Typography>
    </Box>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Box sx={{ pl: 2 }}>
      <ActivityLog {...rest} />
    </Box>
  </Paper>
);

export default ActivityLog;
