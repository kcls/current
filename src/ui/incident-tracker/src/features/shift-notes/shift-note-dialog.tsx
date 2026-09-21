import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { AttachFile as AttachFileIcon } from '@mui/icons-material';
import { uploadService, type FileUploadResponse } from '@core/api/upload';
import LocationSelector from '../../shared/components/location-selector';
import { useToast } from '../../contexts/toast-context';
import { shiftNotesApi } from '../../api/shift-notes';
import {
  getLibraryToday,
  getLibraryNowTime,
  localDateTimeToUtc,
  utcToLocalDateTime,
} from '../../shared/utils/date-utils';
import type { ShiftNote, ShiftNoteConductArea, ShiftNoteType } from '../../types';

/** Keep quick entry quick — a shift note is not a document repository. */
const MAX_ATTACHMENTS = 5;

/** Mirror the server's caps so the limit is visible while typing rather
 *  than arriving as an error on save. */
const MAX_NOTES_LEN = 10_000;
const MAX_PATRON_NAME_LEN = 200;
const MAX_PATRON_DESCRIPTION_LEN = 1_000;

/**
 * One row in the attachment list.
 *
 * Files reach this dialog two ways with different shapes: already saved on
 * the note (`ShiftNoteAttachment`, numeric id, `file_name`) or just
 * uploaded this session (`FileUploadResponse`, string id, `original_name`).
 * Both normalize to this so the list renders and submits uniformly.
 */
interface PendingAttachment {
  /** The numeric asset id the shift-note API stores. */
  /** `asset.file_upload` uuid — the reference `current` APIs take. */
  fileUpload: string;
  name: string;
  size: number | null;
}

function categorizeFile(file: File): 'photo' | 'document' | 'video' {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'].includes(ext)) return 'photo';
  if (['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) return 'video';
  return 'document';
}

interface ShiftNoteDialogProps {
  open: boolean;
  /** Editing an existing note, or null to create a new one. */
  note: ShiftNote | null;
  types: ShiftNoteType[];
  conductAreas: ShiftNoteConductArea[];
  /** Pre-selected location for a new note — the user's working location. */
  defaultOrgUnitId: string | null;
  defaultOrgUnitCode: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create/edit a shift note.
 *
 * Optimized for speed of entry: only type and notes are required, and the
 * location is pre-filled with where the user is working. Location is fixed
 * once a note exists — a note stays filed where it happened.
 */
const ShiftNoteDialog: React.FC<ShiftNoteDialogProps> = ({
  open,
  note,
  types,
  conductAreas,
  defaultOrgUnitId,
  defaultOrgUnitCode,
  onClose,
  onSaved,
}) => {
  const { showSuccess, showError } = useToast();
  const isEdit = note !== null;

  const [orgUnitId, setOrgUnitId] = useState<string | null>(null);
  const [orgUnitCode, setOrgUnitCode] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [patronName, setPatronName] = useState('');
  const [patronDescription, setPatronDescription] = useState('');
  const [wasInstructed, setWasInstructed] = useState(false);
  const [wasWarned, setWasWarned] = useState(false);
  // Occurrence date/time, as two fields in the library's timezone --
  // the same shape the ban forms use, rather than a datetime-local
  // input that would silently use the browser's zone.
  const [occurredDate, setOccurredDate] = useState('');
  const [occurredTime, setOccurredTime] = useState('');
  const [areas, setAreas] = useState<number[]>([]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (note) {
      setOrgUnitId(note.org_unit);
      setOrgUnitCode(null);
      setTypeId(note.type);
      setNotes(note.notes);
      setPatronName(note.patron_name ?? '');
      setPatronDescription(note.patron_description ?? '');
      setWasInstructed(note.was_instructed);
      setWasWarned(note.was_warned);
      {
        const { date, time } = utcToLocalDateTime(note.occurred_at);
        setOccurredDate(date);
        setOccurredTime(time);
      }
      setAreas(note.conduct_areas);
      setAttachments(note.attachments.map(a => ({
        fileUpload: a.file_upload,
        name: a.file_name,
        size: a.file_size,
      })));
    } else {
      setOrgUnitId(defaultOrgUnitId);
      setOrgUnitCode(defaultOrgUnitCode);
      setTypeId(types[0]?.id ?? '');
      setNotes('');
      setPatronName('');
      setPatronDescription('');
      setWasInstructed(false);
      setOccurredDate(getLibraryToday());
      setOccurredTime(getLibraryNowTime());
      setWasWarned(false);
      setAreas([]);
      setAttachments([]);
    }
  }, [open, note, defaultOrgUnitId, defaultOrgUnitCode, types]);

  const toggleArea = (id: number) => {
    setAreas(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id],
    );
  };

  /**
   * Upload straight to odo-asset, then hold the returned id until save.
   *
   * Files land in the shared `current` directory as entity_type 'incident'
   * — odo-asset only routes 'incident' and 'patron', and the shift-note
   * schema deliberately reuses that directory rather than adding one.
   *
   * A file uploaded here but never saved (user cancels) is an orphan in
   * asset storage. That matches how incident and ban-note attachments
   * already behave; cleaning them up is a storage-wide concern, not
   * something to solve only for shift notes.
   */
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;

    if (attachments.length + picked.length > MAX_ATTACHMENTS) {
      showError(`Maximum ${MAX_ATTACHMENTS} attachments per note`);
      return;
    }

    const valid: File[] = [];
    for (const file of picked) {
      const problem = uploadService.validateFile(file, categorizeFile(file));
      if (problem) {
        showError(`${file.name}: ${problem}`);
      } else {
        valid.push(file);
      }
    }
    if (valid.length === 0) return;

    setUploading(true);
    try {
      const results = await Promise.all(
        valid.map(async (file): Promise<FileUploadResponse | null> => {
          try {
            return await uploadService.uploadFile(file, {
              category: categorizeFile(file),
              entity_type: 'incident',
              entity_id: 'shift-note',
            });
          } catch (err) {
            showError(
              `Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
            );
            return null;
          }
        }),
      );

      const added = results
        .filter((r): r is FileUploadResponse => r !== null)
        .map(r => ({
          fileUpload: r.uuid,
          name: r.original_name,
          size: r.size,
        }));

      if (added.length > 0) {
        setAttachments(prev => [...prev, ...added]);
      }
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (fileUpload: string) => {
    setAttachments(prev => prev.filter(a => a.fileUpload !== fileUpload));
  };

  const canSave =
    notes.trim().length > 0 && typeId !== '' && (isEdit || orgUnitId !== null) && !uploading;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        type: typeId as number,
        notes: notes.trim(),
        patron_name: patronName.trim() || null,
        patron_description: patronDescription.trim() || null,
        was_instructed: wasInstructed,
        was_warned: wasWarned,
        occurred_at:
          occurredDate && occurredTime
            ? localDateTimeToUtc(occurredDate, occurredTime)
            : undefined,
        conduct_areas: areas,
        // update replaces the set wholesale, so this must carry every
        // attachment the note should end up with, not just the new ones.
        attachments: attachments.map(a => a.fileUpload),
      };

      if (isEdit && note) {
        await shiftNotesApi.update(note.id, payload);
        showSuccess('Entry updated');
      } else {
        await shiftNotesApi.create({ ...payload, org_unit: orgUnitId as string });
        showSuccess('Entry added');
      }
      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save entry';
      setError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit Entry' : 'New Entry'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {isEdit ? (
            <TextField
              label="Location"
              value={note?.org_unit_name ?? '—'}
              size="small"
              disabled
              helperText="An entry stays filed where it happened"
            />
          ) : (
            /* Entries record where something happened, so they can only
               be filed at a staffed location. Regions and Root stay
               visible but unselectable. */
            <LocationSelector
              value={orgUnitCode}
              onChange={setOrgUnitCode}
              onIdChange={setOrgUnitId}
              label="Location"
              autoSetDefault={false}
              disableClearable
              staffedOnly
            />
          )}

          <FormControl size="small" fullWidth>
            <InputLabel id="shift-note-type-label">Type</InputLabel>
            <Select
              labelId="shift-note-type-label"
              label="Type"
              value={typeId}
              onChange={e => setTypeId(Number(e.target.value))}
            >
              {types.map(t => (
                <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box display="flex" gap={2}>
            <TextField
              label="Date occurred"
              type="date"
              value={occurredDate}
              onChange={e => setOccurredDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="Time"
              type="time"
              value={occurredTime}
              onChange={e => setOccurredTime(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Box>

          <TextField
            label="Notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            multiline
            minRows={3}
            required
            fullWidth
            placeholder="What happened?"
            slotProps={{ htmlInput: { maxLength: MAX_NOTES_LEN } }}
            helperText={
              notes.length > MAX_NOTES_LEN * 0.9
                ? `${notes.length} / ${MAX_NOTES_LEN}`
                : undefined
            }
          />

          <Box display="flex" gap={2}>
            <TextField
              label="Patron name"
              value={patronName}
              onChange={e => setPatronName(e.target.value)}
              size="small"
              fullWidth
              helperText="If known — free text"
              slotProps={{ htmlInput: { maxLength: MAX_PATRON_NAME_LEN } }}
            />
            <TextField
              label="Patron description"
              value={patronDescription}
              onChange={e => setPatronDescription(e.target.value)}
              size="small"
              fullWidth
              helperText="If applicable"
              slotProps={{ htmlInput: { maxLength: MAX_PATRON_DESCRIPTION_LEN } }}
            />
          </Box>

          <FormGroup row>
            <FormControlLabel
              control={
                <Checkbox
                  checked={wasInstructed}
                  onChange={e => setWasInstructed(e.target.checked)}
                />
              }
              label="Instructed"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={wasWarned}
                  onChange={e => setWasWarned(e.target.checked)}
                />
              }
              label="Warned"
            />
          </FormGroup>

          {conductAreas.length > 0 && (
            <FormControl component="fieldset">
              <FormLabel component="legend" sx={{ fontSize: '0.875rem' }}>
                Code of Conduct
              </FormLabel>
              <FormGroup>
                {conductAreas.map(area => (
                  <FormControlLabel
                    key={area.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={areas.includes(area.id)}
                        onChange={() => toggleArea(area.id)}
                      />
                    }
                    label={area.label}
                  />
                ))}
              </FormGroup>
            </FormControl>
          )}
          <Box>
            <FormLabel component="legend" sx={{ fontSize: '0.875rem', display: 'block', mb: 1 }}>
              Attachments
            </FormLabel>
            <Button
              variant="outlined"
              size="small"
              component="label"
              startIcon={<AttachFileIcon />}
              disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
            >
              <input
                type="file"
                hidden
                multiple
                onChange={handleFileUpload}
                disabled={uploading}
              />
              {uploading
                ? 'Uploading…'
                : `Add files (${attachments.length}/${MAX_ATTACHMENTS})`}
            </Button>

            {uploading && <LinearProgress sx={{ mt: 1 }} />}

            {attachments.length > 0 && (
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
                {attachments.map(a => (
                  <Chip
                    key={a.fileUpload}
                    icon={<AttachFileIcon />}
                    label={
                      a.size != null
                        ? `${a.name} (${uploadService.formatFileSize(a.size)})`
                        : a.name
                    }
                    size="small"
                    variant="outlined"
                    onDelete={() => removeAttachment(a.fileUpload)}
                    disabled={uploading}
                  />
                ))}
              </Stack>
            )}

            {attachments.length === 0 && !uploading && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Photos, documents, or video — up to {MAX_ATTACHMENTS}.
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving || uploading}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!canSave || saving}
        >
          {saving ? 'Saving…' : isEdit ? 'Save' : 'Add Note'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ShiftNoteDialog;
