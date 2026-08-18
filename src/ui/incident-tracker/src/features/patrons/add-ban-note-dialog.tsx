import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Alert,
} from '@mui/material';
import {
  AttachFile as AttachFileIcon,
  Delete as DeleteIcon,
  Link as LinkIcon,
  PictureAsPdf as PdfIcon,
  Videocam as VideoIcon,
  Description as DocIcon,
  InsertDriveFile as FileIcon,
} from '@mui/icons-material';
import { uploadService, type FileUploadResponse } from '@core/api/upload';
import { bansApi } from '../../api/bans';
import { useToast } from '../../contexts/toast-context';
import ExternalLinkDialog, { type ExternalLinkFormData } from '../incidents/components/external-link-dialog';

interface AddBanNoteDialogProps {
  open: boolean;
  banId: number;
  patronName?: string;
  onClose: () => void;
  onSuccess: () => void;
  onExited?: () => void;
}

const MAX_ATTACHMENTS = 5;

export const AddBanNoteDialog: React.FC<AddBanNoteDialogProps> = ({
  open,
  banId,
  patronName,
  onClose,
  onSuccess,
  onExited,
}) => {
  const { showSuccess, showError } = useToast();

  const [comments, setComments] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<FileUploadResponse[]>([]);
  const [externalLinks, setExternalLinks] = useState<ExternalLinkFormData[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const isValid = comments.trim().length > 0 || uploadedFiles.length > 0 || externalLinks.length > 0;

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newFiles = Array.from(files);
    const totalFiles = uploadedFiles.length + newFiles.length;

    if (totalFiles > MAX_ATTACHMENTS) {
      showError(`Maximum ${MAX_ATTACHMENTS} files allowed`);
      return;
    }

    const categorizeFile = (file: File): 'photo' | 'document' | 'video' => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      const photoExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'];
      const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];

      if (photoExts.includes(ext)) return 'photo';
      if (videoExts.includes(ext)) return 'video';
      return 'document';
    };

    setIsUploadingFiles(true);

    try {
      const uploadPromises = newFiles.map(async (file) => {
        const fileId = Math.random().toString();
        const category = categorizeFile(file);

        const validation = uploadService.validateFile(file, category);
        if (validation) {
          showError(`${file.name}: ${validation}`);
          return null;
        }

        try {
          const response = await uploadService.uploadFile(file, {
            category,
            // A ban is always linked to an incident, so ban-note
            // attachments are stored as incident files (odo-asset has no
            // dedicated 'ban' directory).
            entity_type: 'incident',
            entity_id: String(banId),
            onProgress: (progress) => {
              setUploadProgress((prev) => ({ ...prev, [fileId]: progress }));
            },
          });
          return response;
        } catch (error: any) {
          console.error('Failed to upload file:', error);
          const errorMessage = error?.message || 'Upload failed';
          showError(`${file.name}: ${errorMessage}`);
          return null;
        }
      });

      const uploadedResponses = await Promise.all(uploadPromises);
      const successfulUploads = uploadedResponses.filter((r): r is FileUploadResponse => r !== null);

      setUploadedFiles((prev) => [...prev, ...successfulUploads]);
      setUploadProgress({});
    } catch (error: any) {
      showError(error.message || 'Failed to upload files');
    } finally {
      setIsUploadingFiles(false);
      event.target.value = '';
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleAddLink = (link: ExternalLinkFormData) => {
    setExternalLinks((prev) => [...prev, link]);
    setLinkDialogOpen(false);
  };

  const handleRemoveLink = (index: number) => {
    setExternalLinks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!isValid) {
      showError('Please provide at least one of: comments, attachments, or external links');
      return;
    }

    setSubmitting(true);
    try {
      await bansApi.addToBan({
        ban_id: banId,
        comments: comments.trim() || undefined,
        attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined,
        external_links: externalLinks.length > 0 ? externalLinks : undefined,
      });

      showSuccess('Information added to ban successfully');
      onSuccess();
      resetState();
      onClose();
    } catch (error: any) {
      showError(error.message || 'Failed to add information to ban');
    } finally {
      setSubmitting(false);
    }
  };

  const resetState = () => {
    setComments('');
    setUploadedFiles([]);
    setExternalLinks([]);
    setUploadProgress({});
  };

  const handleExited = () => {
    resetState();
    onExited?.();
  };

  return (
    <>
      <Dialog open={open} onClose={submitting || isUploadingFiles ? undefined : onClose} maxWidth="sm" fullWidth TransitionProps={{ onExited: handleExited }}>
        <DialogTitle sx={{ pb: 1 }}>
          Attach / Note
          {patronName && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              for {patronName}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          {!isValid && (
            <Alert severity="info" sx={{ mb: 2 }}>
              At least one field is required: comments, attachments, or external links
            </Alert>
          )}

          <TextField
            label="Internal Comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            size="small"
            fullWidth
            multiline
            rows={3}
            placeholder="Add notes or comments about this ban..."
            sx={{ mb: 2.5 }}
          />

          <Box sx={{ mb: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AttachFileIcon fontSize="small" />
              Attachments
            </Typography>

            <Button
              variant="outlined"
              size="small"
              component="label"
              startIcon={<AttachFileIcon />}
              disabled={isUploadingFiles || uploadedFiles.length >= MAX_ATTACHMENTS}
            >
              <input
                type="file"
                hidden
                accept="*"
                multiple
                onChange={handleFileUpload}
                disabled={isUploadingFiles}
              />
              {isUploadingFiles ? 'Uploading...' : `Add Files (${uploadedFiles.length}/${MAX_ATTACHMENTS})`}
            </Button>

            {uploadedFiles.filter((f) => f.category === 'photo').length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" fontWeight="bold" display="block" sx={{ mb: 1 }}>
                  Photos ({uploadedFiles.filter((f) => f.category === 'photo').length})
                </Typography>
                <Box display="flex" gap={1} flexWrap="wrap">
                  {uploadedFiles.map((file, index) => {
                    if (file.category !== 'photo') return null;
                    return (
                      <Box key={`photo-${index}`} position="relative">
                        <Box
                          component="img"
                          src={uploadService.getFileUrl(file.relative_path)}
                          alt={file.original_name}
                          sx={{
                            width: 120,
                            height: 120,
                            objectFit: 'cover',
                            borderRadius: 1,
                            border: '2px solid',
                            borderColor: 'success.main',
                          }}
                        />
                        <IconButton
                          size="small"
                          onClick={() => handleRemoveFile(file.id)}
                          sx={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            bgcolor: 'background.paper',
                            boxShadow: 1,
                            '&:hover': { bgcolor: 'grey.300' },
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}

            {uploadedFiles.filter((f) => f.category !== 'photo').length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" fontWeight="bold" display="block" sx={{ mb: 1 }}>
                  Documents & Videos ({uploadedFiles.filter((f) => f.category !== 'photo').length})
                </Typography>
                {uploadedFiles.map((file, index) => {
                  if (file.category === 'photo') return null;

                  const getFileIcon = () => {
                    if (file.mime_type.includes('pdf')) return <PdfIcon color="error" />;
                    if (file.mime_type.includes('video')) return <VideoIcon color="primary" />;
                    if (file.mime_type.includes('word')) return <DocIcon color="info" />;
                    return <FileIcon />;
                  };

                  return (
                    <Box key={`file-${index}`} sx={{ mb: 1 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          p: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          bgcolor: 'background.paper',
                        }}
                      >
                        {getFileIcon()}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {file.original_name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {uploadService.formatFileSize(file.size)} • {file.category}
                          </Typography>
                        </Box>
                        <IconButton size="small" onClick={() => handleRemoveFile(file.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LinkIcon fontSize="small" />
              External Links
            </Typography>

            <Button
              variant="outlined"
              size="small"
              startIcon={<LinkIcon />}
              onClick={() => setLinkDialogOpen(true)}
            >
              Add Link
            </Button>

            {externalLinks.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                {externalLinks.map((link, index) => (
                  <Box
                    key={index}
                    sx={{
                      p: 1.5,
                      mb: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight="medium">
                        {link.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                        {link.url}
                      </Typography>
                      {link.description && (
                        <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                          {link.description}
                        </Typography>
                      )}
                    </Box>
                    <IconButton size="small" onClick={() => handleRemoveLink(index)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={submitting || !isValid}
            startIcon={submitting ? <CircularProgress size={16} /> : undefined}
          >
            Add to Ban
          </Button>
        </DialogActions>
      </Dialog>

      <ExternalLinkDialog
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        onAdd={handleAddLink}
        existingUrls={externalLinks.map((link) => link.url)}
      />
    </>
  );
};

export default AddBanNoteDialog;
