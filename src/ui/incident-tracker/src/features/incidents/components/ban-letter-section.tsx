import React from 'react';
import {
  Box,
  FormControl,
  FormHelperText,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Tooltip,
  IconButton,
} from '@mui/material';
import { Refresh as RefreshIcon, Print as PrintIcon } from '@mui/icons-material';
import {
  LetterIframeEditor,
  type LetterIframeEditorRef,
} from '../../../shared/components/letter-iframe-editor';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { PerPatronFormData } from '../hooks/use-ban-form';

interface BanLetterSectionProps {
  formData: PerPatronFormData;
  templates: BanLetterTemplate[];
  errors: Record<string, string>;
  editorRef: React.RefObject<LetterIframeEditorRef | null>;
  currentPatronId: string | null;
  onTemplateSelect: (template: BanLetterTemplate) => void;
  onResetToTemplate: () => void;
  onPrintPreview: () => void;
  onContentEdited: (html: string) => void;
  templateDisabled?: boolean;
  templateRequired?: boolean;
  resetTooltip?: string;
}

export const BanLetterSection: React.FC<BanLetterSectionProps> = ({
  formData,
  templates,
  errors,
  editorRef,
  currentPatronId,
  onTemplateSelect,
  onResetToTemplate,
  onPrintPreview,
  onContentEdited,
  templateDisabled,
  templateRequired,
  resetTooltip = 'Reset letter to selected template',
}) => {
  return (
    <>
      <FormControl fullWidth size="small" sx={{ mt: 3 }} required={templateRequired} error={!!errors.ban_letter_template}>
        <InputLabel>Letter Template</InputLabel>
        <Select
          value={formData.ban_letter_template || ''}
          onChange={(e) => {
            const template = templates.find((t) => t.id === (e.target.value as number));
            if (template) onTemplateSelect(template);
          }}
          label="Letter Template"
          disabled={templateDisabled}
        >
          {templates
            .filter((t) => t.is_trespass === formData.is_trespass)
            .map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.subject}
              </MenuItem>
            ))}
        </Select>
        {errors.ban_letter_template && (
          <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
            {errors.ban_letter_template}
          </Typography>
        )}
      </FormControl>

      {(formData.ban_letter_template ||
        (templateDisabled && formData.ban_letter_content)) && (
        <Box sx={{ mt: 1 }}>
          <LetterIframeEditor
            key={currentPatronId ?? 'editor'}
            ref={editorRef}
            htmlContent={formData.ban_letter_content}
            onContentEdited={onContentEdited}
            error={!!errors.ban_letter_violations}
            toolbarExtra={
              <>
                <Tooltip title="Print preview">
                  <IconButton size="small" onClick={onPrintPreview}>
                    <PrintIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {formData.ban_letter_template && (
                  <Tooltip title={resetTooltip}>
                    <IconButton size="small" onClick={onResetToTemplate}>
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </>
            }
          />
          {errors.ban_letter_violations && (
            <FormHelperText error sx={{ mx: 1.75 }}>
              {errors.ban_letter_violations}
            </FormHelperText>
          )}
        </Box>
      )}
    </>
  );
};
