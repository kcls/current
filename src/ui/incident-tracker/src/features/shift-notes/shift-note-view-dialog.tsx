import React from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Edit as EditIcon,
  InsertDriveFile as FileIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { uploadService } from '@core/api/upload';
import { formatDisplayDateTime } from '../../shared/utils/date-utils';
import type { ShiftNote, ShiftNoteConductArea } from '../../types';

interface ShiftNoteViewDialogProps {
  open: boolean;
  note: ShiftNote | null;
  conductAreaById: Map<number, ShiftNoteConductArea>;
  onClose: () => void;
  onEdit: (note: ShiftNote) => void;
  onDelete: (note: ShiftNote) => void;
}

const isImage = (mime: string | null) => Boolean(mime?.startsWith('image/'));

/** One labelled line in the metadata block. */
/** True when two timestamps land in the same minute. */
const sameMinute = (a: string, b: string): boolean =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60_000;

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" display="block">
      {label}
    </Typography>
    <Typography variant="body2" component="div">{children}</Typography>
  </Box>
);

/**
 * Read-only view of a single note.
 *
 * The list truncates hard — long notes are unreadable there and
 * attachments show only as a count. This is where the whole entry is
 * legible: full note text, and attachments as real thumbnails for images
 * or a named row with a download for everything else.
 */
const ShiftNoteViewDialog: React.FC<ShiftNoteViewDialogProps> = ({
  open,
  note,
  conductAreaById,
  onClose,
  onEdit,
  onDelete,
}) => {
  if (!note) return null;

  const images = note.attachments.filter(a => isImage(a.file_type));
  const others = note.attachments.filter(a => !isImage(a.file_type));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Chip label={note.type_label} size="small" variant="outlined" />
          <Typography variant="h6" component="span">
            {note.org_unit_name ?? `Unit ${note.org_unit}`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatDisplayDateTime(note.occurred_at)}
          </Typography>
          {/* The database id, for referring to a specific note in a ticket
              or an email. Monospaced and dimmed — it is a lookup handle,
              not something to read past on the way to the content. */}
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontFamily: 'monospace' }}
          >
            #{note.id}
          </Typography>

          {/* Edit and delete live here rather than in the list: an Actions
              column pushed the table past the viewport, and these only
              make sense once you can see what you are acting on. Shown
              only when the server says the caller may mutate this entry. */}
          {note.can_edit && (
            <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => onEdit(note)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton size="small" onClick={() => onDelete(note)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Box
            display="grid"
            gap={2}
            sx={{ gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}
          >
            <Field label="Library">{note.org_unit_name ?? '—'}</Field>
            <Field label="Region">{note.region_name ?? '—'}</Field>
            <Field label="Staff">{note.staff_name ?? `User ${note.created_by}`}</Field>
            <Field label="Type">{note.type_label}</Field>
            {/* Only worth the space when it differs from the occurrence
                time -- filing as it happens is the common case, and
                repeating the same timestamp twice says nothing. */}
            {!sameMinute(note.occurred_at, note.created_at) && (
              <Field label="Filed">{formatDisplayDateTime(note.created_at)}</Field>
            )}
          </Box>

          {(note.patron_name || note.patron_description) && (
            <>
              <Divider />
              <Box display="grid" gap={2} sx={{ gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                <Field label="Patron name">{note.patron_name || '—'}</Field>
                <Field label="Patron description">{note.patron_description || '—'}</Field>
              </Box>
            </>
          )}

          {(note.was_instructed || note.was_warned || note.conduct_areas.length > 0) && (
            <>
              <Divider />
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  Flags
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {note.was_instructed && <Chip label="Instructed" size="small" variant="outlined" />}
                  {note.was_warned && <Chip label="Warned" size="small" variant="outlined" />}
                  {note.conduct_areas.map(id => (
                    <Chip
                      key={id}
                      label={conductAreaById.get(id)?.label ?? `Area ${id}`}
                      size="small"
                      variant="outlined"
                    />
                  ))}
                </Stack>
              </Box>
            </>
          )}

          <Divider />

          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Notes
            </Typography>
            {/* pre-wrap so line breaks the author typed survive, and the
                full text is shown — this dialog exists because the list
                cannot show it. */}
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {note.notes}
            </Typography>
          </Box>

          {note.attachments.length > 0 && (
            <>
              <Divider />
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  Attachments ({note.attachments.length})
                </Typography>

                {images.length > 0 && (
                  <Box display="flex" gap={1.5} flexWrap="wrap" sx={{ mb: others.length ? 2 : 0 }}>
                    {images.map(a => {
                      const url = uploadService.getFileUrl(a.relative_path);
                      return (
                        <Box
                          key={a.file_upload}
                          onClick={() => window.open(url, '_blank')}
                          sx={{
                            position: 'relative',
                            width: 200,
                            height: 160,
                            borderRadius: 1,
                            overflow: 'hidden',
                            border: '1px solid',
                            borderColor: 'divider',
                            cursor: 'pointer',
                            '&:hover': { boxShadow: 3 },
                          }}
                        >
                          <Box
                            component="img"
                            src={url}
                            alt={a.file_name}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                          <Box
                            sx={{
                              position: 'absolute',
                              bottom: 0,
                              left: 0,
                              right: 0,
                              background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
                              color: 'white',
                              px: 1,
                              py: 0.5,
                            }}
                          >
                            <Typography variant="caption" noWrap display="block">
                              {a.file_name}
                            </Typography>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                )}

                {others.map(a => {
                  const url = uploadService.getFileUrl(a.relative_path);
                  return (
                    <Box
                      key={a.file_upload}
                      display="flex"
                      alignItems="center"
                      gap={1}
                      sx={{
                        p: 1,
                        mb: 0.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                      }}
                    >
                      <FileIcon color="action" />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Link
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="body2"
                          noWrap
                          display="block"
                        >
                          {a.file_name}
                        </Link>
                        {a.file_size != null && (
                          <Typography variant="caption" color="text.secondary">
                            {uploadService.formatFileSize(a.file_size)}
                          </Typography>
                        )}
                      </Box>
                      <IconButton
                        size="small"
                        component="a"
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        component="a"
                        href={url}
                        download={a.file_name}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}

          {note.updated_at && (
            <Typography variant="caption" color="text.secondary">
              Edited {formatDisplayDateTime(note.updated_at)}
            </Typography>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained">Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ShiftNoteViewDialog;
