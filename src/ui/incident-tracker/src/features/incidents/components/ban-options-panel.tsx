import React, { useRef, useEffect, useMemo } from 'react';
import {
  Box,
  TextField,
  Typography,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Autocomplete,
  Tooltip,
  IconButton,
  FormHelperText,
} from '@mui/material';
import { Refresh as RefreshIcon, Print as PrintIcon } from '@mui/icons-material';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog';
import { printFullHtml } from '../../../shared/utils/print-service';
import { useConfirmDialog } from '../../../shared/hooks/use-confirm-dialog';
import { PRESET_DAYS, getDurationLabel, calculateLiftDate, getDefaultDuration, getLibraryToday, localDateToUtc, utcToLocalDate } from '../../../shared/utils/date-utils';
import {
  processBanLetterTemplate,
  buildTemplateVars,
} from '../../../shared/utils/ban-letter-templates';
import {
  LetterIframeEditor,
  type LetterIframeEditorRef,
} from '../../../shared/components/letter-iframe-editor';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { PatronDetails } from '../../../types/patron';
import type { Incident } from '../../../types';

export interface BanIntentData {
  enabled: boolean;
  ban_type: 'ban' | 'trespass';
  starts_at: string;
  lifts_at: string;
  duration_days: number;
  comments: string;
  case_number: string;
  law_enforcement_agency: string;
  ban_letter_template: number | null;
  ban_letter_content: string;
  content_source: 'template' | 'manual';
}

export function getDefaultBanIntent(occurredAtUtc?: string): BanIntentData {
  const startDateYmd = occurredAtUtc ? utcToLocalDate(occurredAtUtc) : getLibraryToday();
  const startsAt = localDateToUtc(startDateYmd);
  const defaultDays = getDefaultDuration(false);
  return {
    enabled: false,
    ban_type: 'ban',
    starts_at: startsAt,
    lifts_at: calculateLiftDate(startsAt, defaultDays),
    duration_days: defaultDays,
    comments: '',
    case_number: '',
    law_enforcement_agency: '',
    ban_letter_template: null,
    ban_letter_content: '',
    content_source: 'template',
  };
}

interface BanOptionsPanelProps {
  banData: BanIntentData;
  onChange: (data: BanIntentData) => void;
  hideType?: 'ban' | 'trespass';
  templates: BanLetterTemplate[];
  incident: Incident | null;
  patronDetails: PatronDetails | null;
  locationName?: string;
  templateError?: string;
  violationError?: string;
  startsAtError?: string;
  liftsAtError?: string;
  validationSeq?: number;
}

export const BanOptionsPanel: React.FC<BanOptionsPanelProps> = ({
  banData,
  onChange,
  hideType,
  templates,
  incident,
  patronDetails,
  locationName,
  templateError,
  violationError,
  startsAtError,
  liftsAtError,
  validationSeq,
}) => {
  const editorRef = useRef<LetterIframeEditorRef>(null);
  const isTrespass = banData.ban_type === 'trespass';

  const filteredTemplates = useMemo(
    () => templates.filter((t) => t.is_trespass === isTrespass && t.operation_type === 'created'),
    [templates, isTrespass],
  );

  const selectedTemplate = useMemo(
    () => filteredTemplates.find((t) => t.id === banData.ban_letter_template) || null,
    [filteredTemplates, banData.ban_letter_template],
  );

  // Stable patch helper: merges partial updates without capturing stale banData
  const onPatch = React.useCallback(
    (patch: Partial<BanIntentData>) => onChange({ ...banData, ...patch }),
    [banData, onChange],
  );

  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    if (violationError) editorRef.current?.flashViolations();
  }, [violationError, validationSeq]);

  // Auto-select default template when type changes or templates load
  useEffect(() => {
    if (banData.ban_letter_template) return;
    const tpl = filteredTemplates.find((t) => t.is_default) ?? filteredTemplates[0];
    if (tpl) {
      onPatch({ ban_letter_template: tpl.id, content_source: 'template' });
    }
  }, [filteredTemplates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Regenerate letter content in template mode
  useEffect(() => {
    if (banData.content_source !== 'template' || !selectedTemplate || !incident) return;
    const content = processBanLetterTemplate(selectedTemplate, incident, patronDetails, {
      startsAt: banData.starts_at,
      liftsAt: banData.lifts_at,
      caseNumber: banData.case_number || undefined,
      lawEnforcementAgency: banData.law_enforcement_agency || undefined,
      selectedLocationName: locationName,
    });
    onPatch({ ban_letter_content: content });
  }, [banData.content_source, banData.ban_letter_template, banData.case_number, banData.law_enforcement_agency, banData.starts_at, banData.lifts_at, locationName, incident, patronDetails]); // eslint-disable-line react-hooks/exhaustive-deps

  // In-place variable updates in manual mode; sync state to keep DOM and ban_letter_content aligned
  useEffect(() => {
    if (banData.content_source !== 'manual' || !incident) return;
    const vars = buildTemplateVars(incident, patronDetails, {
      startsAt: banData.starts_at,
      liftsAt: banData.lifts_at,
      caseNumber: banData.case_number || undefined,
      lawEnforcementAgency: banData.law_enforcement_agency || undefined,
      selectedLocationName: locationName,
    });
    editorRef.current?.updateTemplateVars(vars);
    const synced = editorRef.current?.syncContent();
    if (synced) onPatch({ ban_letter_content: synced });
  }, [banData.content_source, banData.case_number, banData.law_enforcement_agency, banData.starts_at, banData.lifts_at, locationName, incident, patronDetails]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTypeChange = (ban_type: 'ban' | 'trespass') => {
    const newDuration = getDefaultDuration(ban_type === 'trespass');
    const newLiftsAt = calculateLiftDate(banData.starts_at, newDuration);
    const newFiltered = templates.filter(
      (t) => t.is_trespass === (ban_type === 'trespass') && t.operation_type === 'created',
    );
    const defaultTpl = newFiltered.find((t) => t.is_default) ?? null;
    onChange({
      ...banData,
      ban_type,
      duration_days: newDuration,
      lifts_at: newLiftsAt,
      ban_letter_template: defaultTpl?.id ?? null,
      ban_letter_content: '',
      content_source: 'template',
    });
  };

  const handleStartDateChange = (dateStr: string) => {
    if (!dateStr) {
      onChange({ ...banData, starts_at: '' });
      return;
    }
    const startsAt = localDateToUtc(dateStr);
    if (banData.duration_days > 0) {
      const newLiftsAt = calculateLiftDate(startsAt, banData.duration_days);
      onChange({ ...banData, starts_at: startsAt, lifts_at: newLiftsAt });
    } else {
      onChange({ ...banData, starts_at: startsAt });
    }
  };

  const handleDurationChange = (days: number) => {
    if (!banData.starts_at) return;
    const newLiftsAt = calculateLiftDate(banData.starts_at, days);
    onChange({ ...banData, duration_days: days, lifts_at: newLiftsAt });
  };

  const handleLiftDateChange = (dateStr: string) => {
    if (!dateStr) {
      onChange({ ...banData, lifts_at: '', duration_days: 0 });
      return;
    }
    const liftsAt = localDateToUtc(dateStr);
    onChange({ ...banData, lifts_at: liftsAt, duration_days: 0 });
  };

  const handleTemplateChange = async (_: any, template: BanLetterTemplate | null) => {
    if (!template) return;
    if (banData.content_source === 'manual') {
      const ok = await confirm({
        title: 'Replace edits?',
        message: 'Switching template will replace your edits. Continue?',
      });
      if (!ok) return;
    }
    onChange({ ...banData, ban_letter_template: template.id, content_source: 'template' });
  };

  const handleContentEdited = (content: string) => {
    onChange({ ...banData, content_source: 'manual', ban_letter_content: content });
  };

  const handleResetToTemplate = async () => {
    const ok = await confirm({
      title: 'Reset letter?',
      message: 'This will reset the letter to the selected template. Any manual edits to the letter will be lost.',
    });
    if (!ok) return;
    onChange({ ...banData, content_source: 'template' });
  };

  const handlePrintPreview = () => {
    const html = editorRef.current?.getFullHtml();
    if (!html) return;
    printFullHtml(html);
  };

  const startsAtDate = banData.starts_at
    ? utcToLocalDate(banData.starts_at)
    : '';

  const liftsAtDate = banData.lifts_at
    ? utcToLocalDate(banData.lifts_at)
    : '';

  const typeLabel = banData.ban_type === 'trespass' ? 'trespass' : 'ban';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box display="flex" gap={2}>
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel required>Type</InputLabel>
          <Select
            value={banData.ban_type}
            onChange={(e) => handleTypeChange(e.target.value as 'ban' | 'trespass')}
            label="Type"
            required
            disabled={!!hideType}
          >
            <MenuItem value="ban">Ban</MenuItem>
            <MenuItem value="trespass">Trespass</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Box display="flex" gap={2}>
        <TextField
          type="date"
          label="Start Date"
          value={startsAtDate}
          onChange={(e) => handleStartDateChange(e.target.value)}
          size="small"
          required
          error={!!startsAtError}
          slotProps={{ inputLabel: { shrink: true } }}
          helperText={startsAtError || `When the ${typeLabel} begins`}
          sx={{ flex: 1 }}
        />
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel>Duration</InputLabel>
          <Select
            value={banData.duration_days || ''}
            onChange={(e) => handleDurationChange(Number(e.target.value))}
            label="Duration"
          >
            {PRESET_DAYS.map((d) => (
              <MenuItem key={d} value={d}>
                {getDurationLabel(d)}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, ml: 1.75 }}>
            Quick preset to set lift date
          </Typography>
        </FormControl>
        <TextField
          type="date"
          label="Lift Date"
          value={liftsAtDate}
          onChange={(e) => handleLiftDateChange(e.target.value)}
          size="small"
          required
          error={!!liftsAtError}
          slotProps={{ inputLabel: { shrink: true } }}
          helperText={
            liftsAtError ||
            `${banData.ban_type === 'ban' ? 'Ban' : 'Trespass'} will be automatically lifted on this date`
          }
          sx={{ flex: 1 }}
        />
      </Box>

      <Box display="flex" gap={2}>
        <TextField
          label="Law Enforcement Agency"
          value={banData.law_enforcement_agency}
          onChange={(e) => onChange({ ...banData, law_enforcement_agency: e.target.value })}
          size="small"
          sx={{ flex: 1 }}
        />
        <TextField
          label="Police Case Number"
          value={banData.case_number}
          onChange={(e) => onChange({ ...banData, case_number: e.target.value })}
          size="small"
          sx={{ flex: 1 }}
        />
      </Box>

      <TextField
        label="Internal Comments"
        value={banData.comments}
        onChange={(e) => onChange({ ...banData, comments: e.target.value })}
        size="small"
        multiline
        rows={2}
      />

      <Box>
        <Autocomplete
          size="small"
          disableClearable
          options={filteredTemplates}
          value={selectedTemplate ?? undefined}
          onChange={handleTemplateChange}
          getOptionLabel={(t) => t.name || t.subject || `Template #${t.id}`}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Letter Template"
              required
              error={!!templateError}
              helperText={templateError}
            />
          )}
        />

        {banData.ban_letter_content && (
          <Box sx={{ mt: 1 }}>
            <LetterIframeEditor
              ref={editorRef}
              htmlContent={banData.ban_letter_content}
              onContentEdited={handleContentEdited}
              error={!!violationError}
              height={400}
              toolbarExtra={
                <>
                  <Tooltip title="Print preview">
                    <IconButton size="small" onClick={handlePrintPreview}>
                      <PrintIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {banData.ban_letter_template && (
                    <Tooltip title="Reset letter to selected template">
                      <IconButton size="small" onClick={handleResetToTemplate}>
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </>
              }
            />
            {violationError && (
              <FormHelperText error sx={{ mx: 1.75 }}>
                {violationError}
              </FormHelperText>
            )}
          </Box>
        )}
      </Box>
      <ConfirmDialog {...dialogProps} />
    </Box>
  );
};
