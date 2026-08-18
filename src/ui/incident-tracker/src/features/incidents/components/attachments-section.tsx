import React from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  CircularProgress,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  AttachFile as AttachFileIcon,
  InsertDriveFile as FileIcon,
  PictureAsPdf as PdfIcon,
  VideoFile as VideoIcon,
  Description as DocIcon,
} from '@mui/icons-material';
import { uploadService } from '@core/api/upload';
import type { AttachmentProps } from './incident-form-step-report';

const getFileIcon = (mimeType: string) => {
  if (mimeType.includes('pdf')) return <PdfIcon color="error" />;
  if (mimeType.includes('video')) return <VideoIcon color="primary" />;
  if (mimeType.includes('word')) return <DocIcon color="info" />;
  return <FileIcon />;
};

export const AttachmentsSection: React.FC<{ attachment: AttachmentProps }> = ({ attachment }) => {
  const photos = attachment.files.filter((f) => f.category === 'photo');
  const nonPhotos = attachment.files.filter((f) => f.category !== 'photo');

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Attachments
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Upload photos, documents (.pdf, .docx, .txt), or videos related to this incident
      </Typography>

      {/* Photo Gallery */}
      {photos.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" fontWeight="bold" display="block" sx={{ mb: 1 }}>
            Photos ({photos.length})
          </Typography>
          <Box display="flex" gap={1} flexWrap="wrap">
            {attachment.files.map((file, index) => {
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
                    onClick={() => attachment.onRemove(index)}
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

      {/* Document & Video List */}
      {nonPhotos.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" fontWeight="bold" display="block" sx={{ mb: 1 }}>
            Documents & Videos ({nonPhotos.length})
          </Typography>
          {attachment.files.map((file, index) => {
            if (file.category === 'photo') return null;
            const isVideo = file.mime_type.includes('video');

            return (
              <Box key={`file-${index}`} sx={{ mb: 1.5 }}>
                {isVideo && (
                  <Box sx={{ mb: 1 }}>
                    <video
                      width="100%"
                      style={{ maxWidth: 400, height: 'auto', borderRadius: 4 }}
                      controls
                      src={uploadService.getFileUrl(file.relative_path)}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </Box>
                )}
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
                  {getFileIcon(file.mime_type)}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" noWrap>
                      {file.original_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {uploadService.formatFileSize(file.size)} • {file.category}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    component="a"
                    href={uploadService.getFileUrl(file.relative_path)}
                    target="_blank"
                    download={file.original_name}
                  >
                    <FileIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => attachment.onRemove(index)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Upload Button */}
      <Box display="flex" gap={1} flexWrap="wrap">
        <Button
          variant="outlined"
          component="label"
          startIcon={
            attachment.isUploading ? <CircularProgress size={20} /> : <AttachFileIcon />
          }
          disabled={attachment.isUploading || attachment.files.length >= attachment.maxFiles}
        >
          {attachment.isUploading
            ? 'Uploading...'
            : `Add Files (${attachment.files.length}/${attachment.maxFiles})`}
          <input
            type="file"
            hidden
            accept="*"
            multiple
            onChange={attachment.onUpload}
            disabled={attachment.isUploading}
          />
        </Button>
      </Box>

      {attachment.files.length > 0 && (
        <Typography variant="caption" color="success.main" display="block" sx={{ mt: 1 }}>
          ✓ {attachment.files.length} file(s) uploaded
        </Typography>
      )}
      {Object.keys(attachment.progress).length > 0 && (
        <Box sx={{ mt: 1 }}>
          {Object.entries(attachment.progress).map(([fileId, progress]) => (
            <Box key={fileId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress variant="determinate" value={progress} size={16} />
              <Typography variant="caption">{progress}%</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
