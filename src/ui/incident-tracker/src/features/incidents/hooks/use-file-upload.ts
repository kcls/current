import { useState } from 'react';
import { uploadService, type FileUploadResponse } from '@core/api/upload';

const MAX_FILES_DEFAULT = 100;

interface UseFileUploadOptions {
  maxFiles?: number;
  entityType?: 'incident' | 'patron';
  entityId?: string;
  showError: (msg: string) => void;
  showSuccess: (msg: string) => void;
}

function categorizeFile(file: File): 'photo' | 'document' | 'video' {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const photoExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'];
  const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
  if (photoExts.includes(ext)) return 'photo';
  if (videoExts.includes(ext)) return 'video';
  return 'document';
}

export function useFileUpload(options: UseFileUploadOptions) {
  const {
    maxFiles = MAX_FILES_DEFAULT,
    entityType = 'incident',
    entityId = 'pending',
    showError,
    showSuccess,
  } = options;

  const [uploadedFiles, setUploadedFiles] = useState<FileUploadResponse[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const allFiles = Array.from(files);
    const newFiles: File[] = [];
    for (const file of allFiles) {
      const category = categorizeFile(file);
      const validationError = uploadService.validateFile(file, category);
      if (validationError) {
        showError(`${file.name}: ${validationError}`);
      } else {
        newFiles.push(file);
      }
    }
    if (newFiles.length === 0) return;

    const totalFiles = uploadedFiles.length + newFiles.length;
    if (totalFiles > maxFiles) {
      showError(`Maximum ${maxFiles} files allowed per incident`);
      return;
    }

    setIsUploadingFiles(true);
    try {
      const uploadPromises = newFiles.map(async (file, index) => {
        const fileId = `${Date.now()}-${index}`;
        const category = categorizeFile(file);
        try {
          const response = await uploadService.uploadFile(file, {
            category,
            entity_type: entityType,
            entity_id: entityId,
            onProgress: (progress) => {
              setUploadProgress((prev) => ({ ...prev, [fileId]: progress }));
            },
          });
          return response;
        } catch (error) {
          console.error('Failed to upload file:', error);
          showError(
            `Failed to upload ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          return null;
        }
      });

      const results = await Promise.all(uploadPromises);
      const successfulUploads = results.filter((r): r is FileUploadResponse => r !== null);
      if (successfulUploads.length > 0) {
        setUploadedFiles((prev) => [...prev, ...successfulUploads]);
        showSuccess(`Successfully uploaded ${successfulUploads.length} file(s)`);
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      showError('Failed to upload files. Please try again.');
    } finally {
      setIsUploadingFiles(false);
      setUploadProgress({});
    }
  };

  const removeAttachment = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return {
    uploadedFiles,
    setUploadedFiles,
    uploadProgress,
    isUploadingFiles,
    handleFileUpload,
    removeAttachment,
    maxFiles,
  };
}
