import React, { useRef, useEffect, useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Typography,
  TextField,
  Button,
  Box,
  FormControlLabel,
  Switch,
  Card,
  CardContent,
  Avatar,
  Chip,
  Collapse,
  Link,
  Alert,
  Autocomplete,
  FormHelperText,
} from '@mui/material';
import {
  Person as PersonIcon,
  NavigateBefore as BackIcon,
  NavigateNext as NextIcon,
} from '@mui/icons-material';
import { addDays, parseISO, format } from 'date-fns';
import { uploadService } from '@core/api/upload';
import { BanOptionsPanel, getDefaultBanIntent, type BanIntentData } from './ban-options-panel';
import {
  formatBanDate,
  calculateArchivesAt,
  calculateLiftDate,
  utcToLocalDate,
  localDateToUtc,
} from '../../../shared/utils/date-utils';
import {
  processBanLetterTemplate,
  buildTemplateVars,
} from '../../../shared/utils/ban-letter-templates';
import {
  LetterIframeEditor,
  type LetterIframeEditorRef,
} from '../../../shared/components/letter-iframe-editor';
import { DEFAULT_BAN_LIFT_DAYS } from '../../../constants';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { PatronDetails } from '../../../types/patron';
import type { PatronSearchResult, Incident, PatronBanStatus } from '../../../types';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog';
import { useConfirmDialog } from '../../../shared/hooks/use-confirm-dialog';

export interface ExtendIntentData {
  enabled: boolean;
  ban_id: number;
  is_trespass: boolean;
  current_lifts_at: string;
  new_lifts_at: string;
  archives_at: string;
  comments: string;
  case_number: string;
  law_enforcement_agency: string;
  org_unit_name?: string;
  ban_letter_template: number | null;
  ban_letter_content: string;
  content_source: 'template' | 'manual';
}

interface StepBanActionsProps {
  selectedPatrons: PatronSearchResult[];
  patronNotes: Record<string, string>;
  patronBanAtLocation: Record<string, PatronBanStatus>;
  locationName: string | undefined;
  patronBanIntents: Record<string, BanIntentData>;
  setPatronBanIntents: React.Dispatch<React.SetStateAction<Record<string, BanIntentData>>>;
  patronExtendIntents: Record<string, ExtendIntentData>;
  setPatronExtendIntents: React.Dispatch<React.SetStateAction<Record<string, ExtendIntentData>>>;
  templates: BanLetterTemplate[];
  incident: Incident | null;
  patronDetailsMap: Record<string, PatronDetails | null>;
  errors: Record<string, string>;
  validationSeq?: number;
  onNext: () => void;
  onBack: () => void;
}

const ExtendLetterSection: React.FC<{
  extendData: ExtendIntentData;
  templates: BanLetterTemplate[];
  incident: Incident | null;
  patronDetails: PatronDetails | null;
  locationName?: string;
  templateError?: string;
  violationError?: string;
  validationSeq?: number;
  onUpdate: (patch: Partial<ExtendIntentData>) => void;
}> = ({ extendData, templates, incident, patronDetails, locationName, templateError, violationError, validationSeq, onUpdate }) => {
  const editorRef = useRef<LetterIframeEditorRef>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    if (violationError) editorRef.current?.flashViolations();
  }, [violationError, validationSeq]);

  const filteredTemplates = useMemo(
    () => templates.filter((t) => t.is_trespass === extendData.is_trespass && t.operation_type === 'extended'),
    [templates, extendData.is_trespass],
  );

  const selectedTemplate = useMemo(
    () => filteredTemplates.find((t) => t.id === extendData.ban_letter_template) || null,
    [filteredTemplates, extendData.ban_letter_template],
  );

  // Auto-select default extend template
  useEffect(() => {
    if (extendData.ban_letter_template !== null) return;
    const tpl = filteredTemplates.find((t) => t.is_default) ?? filteredTemplates[0];
    if (tpl) {
      onUpdate({ ban_letter_template: tpl.id, content_source: 'template' });
    }
  }, [filteredTemplates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Regenerate letter in template mode
  useEffect(() => {
    if (extendData.content_source !== 'template' || !selectedTemplate || !incident) return;
    const content = processBanLetterTemplate(selectedTemplate, incident, patronDetails, {
      startsAt: undefined,
      liftsAt: extendData.new_lifts_at,
      caseNumber: extendData.case_number || undefined,
      lawEnforcementAgency: extendData.law_enforcement_agency || undefined,
      selectedLocationName: locationName,
    });
    onUpdate({ ban_letter_content: content });
  }, [extendData.content_source, extendData.ban_letter_template, extendData.new_lifts_at, extendData.case_number, extendData.law_enforcement_agency, locationName, incident, patronDetails]); // eslint-disable-line react-hooks/exhaustive-deps

  // In-place variable updates in manual mode; sync state to keep DOM and ban_letter_content aligned
  useEffect(() => {
    if (extendData.content_source !== 'manual' || !incident) return;
    const vars = buildTemplateVars(incident, patronDetails, {
      liftsAt: extendData.new_lifts_at,
      caseNumber: extendData.case_number || undefined,
      lawEnforcementAgency: extendData.law_enforcement_agency || undefined,
      selectedLocationName: locationName,
    });
    editorRef.current?.updateTemplateVars(vars);
    const synced = editorRef.current?.syncContent();
    if (synced) onUpdate({ ban_letter_content: synced });
  }, [extendData.content_source, extendData.new_lifts_at, extendData.case_number, extendData.law_enforcement_agency, locationName, incident, patronDetails]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTemplateChange = async (_: any, template: BanLetterTemplate) => {
    if (extendData.content_source === 'manual') {
      const ok = await confirm({
        title: 'Replace edits?',
        message: 'Switching template will replace your edits. Continue?',
      });
      if (!ok) return;
    }
    onUpdate({ ban_letter_template: template.id, content_source: 'template' });
  };


  return (
    <Box display="flex" flexDirection="column" gap={2} mt={2}>
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

        {extendData.ban_letter_content && (
          <Box sx={{ mt: 1 }}>
            <LetterIframeEditor
              ref={editorRef}
              htmlContent={extendData.ban_letter_content}
              onContentEdited={(content) => onUpdate({ content_source: 'manual', ban_letter_content: content })}
              error={!!violationError}
              height={400}
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

export const StepBanActions: React.FC<StepBanActionsProps> = ({
  selectedPatrons,
  patronNotes,
  patronBanAtLocation,
  locationName,
  patronBanIntents,
  setPatronBanIntents,
  patronExtendIntents,
  setPatronExtendIntents,
  templates,
  incident,
  patronDetailsMap,
  errors,
  validationSeq,
  onNext,
  onBack,
}) => {
  // Derive patron details for temporary patrons from their search result data
  // so letter templates can resolve names instead of showing placeholders
  const resolvedDetailsMap = useMemo(() => {
    const merged = { ...patronDetailsMap };
    for (const p of selectedPatrons) {
      if (p.is_new_unsaved && merged[p.id] === undefined) {
        merged[p.id] = {
          id: p.id,
          display_name: p.display_name ?? '',
          first_name: p.first_name,
          last_name: p.last_name,
        } as PatronDetails;
      }
    }
    return merged;
  }, [patronDetailsMap, selectedPatrons]);

  return (
    <>
      {selectedPatrons.length === 0 && (
        <Alert severity="info" sx={{ mb: 3 }}>
          No patrons were added in the previous step.
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {selectedPatrons.map((patron) => {
          const banStatus = patronBanAtLocation[patron.id];
          const hasActiveTrespass = !!banStatus?.hasTrespass;
          const hasActiveBanAtLocation = !!banStatus?.hasBan;
          const trespassLocationLabel = banStatus?.trespassOrgUnitName;

          // Determine extend context
          const extendIsTrespass = hasActiveTrespass;
          const extendBanId = extendIsTrespass
            ? banStatus?.trespassId
            : banStatus?.banId;
          const extendCurrentLiftsAt = extendIsTrespass
            ? banStatus?.trespassLiftsAt
            : banStatus?.banLiftsAt;
          const extendLabel = extendIsTrespass ? 'trespass' : 'ban';
          const extendLocationName = extendIsTrespass
            ? (trespassLocationLabel || 'another location')
            : (locationName || 'this location');

          const hasExistingBanOrTrespass = hasActiveTrespass || hasActiveBanAtLocation;
          const extendIntent = patronExtendIntents[patron.id];
          const banIntent = patronBanIntents[patron.id];

          // Min extend date: current lift date + 1 day
          const minDate = extendCurrentLiftsAt
            ? format(addDays(parseISO(utcToLocalDate(extendCurrentLiftsAt) + 'T00:00:00'), 1), 'yyyy-MM-dd')
            : '';

          const templateError = errors[`ban_letter_${patron.id}`];
          const extendTemplateError = errors[`extend_letter_${patron.id}`];
          const violationError = errors[`ban_letter_violations_${patron.id}`];
          const extendViolationError = errors[`extend_letter_violations_${patron.id}`];
          const startsAtError = errors[`ban_starts_${patron.id}`];
          const liftsAtError = errors[`ban_lifts_${patron.id}`];
          const extendLiftsError = errors[`extend_lifts_${patron.id}`];

          return (
            <Card key={patron.id} variant="outlined">
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                  <Avatar
                    src={
                      patron.primary_photo_url
                        ? uploadService.getFileUrl(patron.primary_photo_url)
                        : undefined
                    }
                    sx={{ width: 36, height: 36, bgcolor: 'action.disabledBackground' }}
                  >
                    <PersonIcon sx={{ fontSize: 20 }} />
                  </Avatar>
                  <Box>
                    <Box display="flex" alignItems="center">
                      {patron.is_new_unsaved ? (
                        <Typography variant="body2">
                          {patron.display_name}
                        </Typography>
                      ) : (
                        <Link
                          component={RouterLink}
                          to={`/patrons/${patron.id}`}
                          target="_blank"
                          variant="body2"
                          sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                        >
                          {patron.display_name}
                        </Link>
                      )}
                      {patron.is_unknown && (
                        <Chip label="Unknown" size="small" variant="outlined" sx={{ ml: 1 }} />
                      )}
                    </Box>
                    {patronNotes[patron.id] && (
                      <Typography variant="caption" color="text.secondary">
                        {patronNotes[patron.id]}
                      </Typography>
                    )}
                  </Box>
                </Box>

                {hasActiveTrespass && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Already has an active{' '}
                    <Link component={RouterLink} to={`/bans/${banStatus!.trespassId}`} target="_blank">
                      trespass
                    </Link>{' '}
                    at {trespassLocationLabel || 'another location'}
                    {extendCurrentLiftsAt && (
                      <> · Lifts {formatBanDate(extendCurrentLiftsAt)}</>
                    )}
                  </Alert>
                )}
                {!hasActiveTrespass && hasActiveBanAtLocation && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Already has an active{' '}
                    <Link component={RouterLink} to={`/bans/${banStatus!.banId}`} target="_blank">
                      ban
                    </Link>{' '}
                    at {locationName || 'this location'}
                    {extendCurrentLiftsAt && (
                      <> · Lifts {formatBanDate(extendCurrentLiftsAt)}</>
                    )}
                  </Alert>
                )}

                {hasExistingBanOrTrespass && extendBanId && (
                  <Box sx={{ mb: 1 }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={extendIntent?.enabled ?? false}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            if (checked && extendCurrentLiftsAt) {
                              const defaultNewLiftsAt = calculateLiftDate(
                                extendCurrentLiftsAt,
                                DEFAULT_BAN_LIFT_DAYS,
                              );
                              const archivesAt = extendIsTrespass
                                ? ''
                                : calculateArchivesAt(defaultNewLiftsAt);
                              const extTemplates = templates.filter(
                                (t) => t.is_trespass === extendIsTrespass && t.operation_type === 'extended',
                              );
                              const extTpl = extTemplates.find((t) => t.is_default) ?? extTemplates[0];
                              setPatronExtendIntents((prev) => ({
                                ...prev,
                                [patron.id]: {
                                  enabled: true,
                                  ban_id: extendBanId,
                                  is_trespass: extendIsTrespass,
                                  current_lifts_at: extendCurrentLiftsAt,
                                  new_lifts_at: defaultNewLiftsAt,
                                  archives_at: archivesAt,
                                  comments: '',
                                  case_number: '',
                                  law_enforcement_agency: '',
                                  org_unit_name: extendLocationName,
                                  ban_letter_template: extTpl?.id ?? null,
                                  ban_letter_content: '',
                                  content_source: 'template',
                                },
                              }));
                              // Mutually exclusive: disable ban creation
                              setPatronBanIntents((prev) => {
                                const existing = prev[patron.id];
                                if (!existing?.enabled) return prev;
                                return { ...prev, [patron.id]: { ...existing, enabled: false } };
                              });
                            } else {
                              setPatronExtendIntents((prev) => ({
                                ...prev,
                                [patron.id]: { ...prev[patron.id]!, enabled: false },
                              }));
                            }
                          }}
                        />
                      }
                      label={
                        <Typography variant="body2" fontWeight="medium">
                          Extend existing {extendLabel}
                        </Typography>
                      }
                    />
                    <Collapse in={extendIntent?.enabled ?? false} unmountOnExit>
                      <Box sx={{ mt: 1, p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
                        <Box display="flex" flexDirection="column" gap={2}>
                          <TextField
                            label="New Lift Date"
                            type="date"
                            value={
                              extendIntent?.new_lifts_at
                                ? utcToLocalDate(extendIntent.new_lifts_at)
                                : ''
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              const newLiftsAt = val ? localDateToUtc(val) : '';
                              const newArchivesAt = extendIsTrespass || !newLiftsAt
                                ? ''
                                : calculateArchivesAt(newLiftsAt);
                              setPatronExtendIntents((prev) => ({
                                ...prev,
                                [patron.id]: {
                                  ...prev[patron.id]!,
                                  new_lifts_at: newLiftsAt,
                                  archives_at: newArchivesAt,
                                },
                              }));
                            }}
                            size="small"
                            fullWidth
                            required
                            error={!!extendLiftsError}
                            slotProps={{
                              inputLabel: { shrink: true },
                              htmlInput: { min: minDate },
                            }}
                            helperText={
                              extendLiftsError ||
                              (!extendIsTrespass && extendIntent?.archives_at
                                ? `Auto-archive: ${formatBanDate(extendIntent.archives_at)}`
                                : extendIsTrespass
                                  ? 'Archived manually by coordinator'
                                  : undefined)
                            }
                          />
                          <Box display="flex" gap={2}>
                            <TextField
                              label="Case Number"
                              value={extendIntent?.case_number ?? ''}
                              onChange={(e) => {
                                setPatronExtendIntents((prev) => ({
                                  ...prev,
                                  [patron.id]: { ...prev[patron.id]!, case_number: e.target.value },
                                }));
                              }}
                              size="small"
                              sx={{ flex: 1 }}
                            />
                            <TextField
                              label="Law Enforcement Agency"
                              value={extendIntent?.law_enforcement_agency ?? ''}
                              onChange={(e) => {
                                setPatronExtendIntents((prev) => ({
                                  ...prev,
                                  [patron.id]: { ...prev[patron.id]!, law_enforcement_agency: e.target.value },
                                }));
                              }}
                              size="small"
                              sx={{ flex: 1 }}
                            />
                          </Box>
                          <TextField
                            label="Internal Comments"
                            value={extendIntent?.comments ?? ''}
                            onChange={(e) => {
                              setPatronExtendIntents((prev) => ({
                                ...prev,
                                [patron.id]: { ...prev[patron.id]!, comments: e.target.value },
                              }));
                            }}
                            size="small"
                            fullWidth
                            multiline
                            rows={2}
                          />

                          {extendIntent && (
                            <ExtendLetterSection
                              extendData={extendIntent}
                              templates={templates}
                              incident={incident}
                              patronDetails={resolvedDetailsMap[patron.id] || null}
                              locationName={locationName}
                              templateError={extendTemplateError}
                              violationError={extendViolationError}
                              validationSeq={validationSeq}
                              onUpdate={(patch) => {
                                setPatronExtendIntents((prev) => ({
                                  ...prev,
                                  [patron.id]: { ...prev[patron.id]!, ...patch },
                                }));
                              }}
                            />
                          )}
                        </Box>
                      </Box>
                    </Collapse>
                  </Box>
                )}

                {!hasActiveTrespass && (
                  <>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={banIntent?.enabled ?? false}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            if (checked) {
                              const intent = { ...getDefaultBanIntent(incident?.occurred_at), enabled: true };
                              // When an active ban exists, lock to trespass
                              if (hasActiveBanAtLocation) intent.ban_type = 'trespass';
                              // Pre-select template so the effect doesn't need filteredTemplates to change
                              const banTemplates = templates.filter(
                                (t) => t.is_trespass === (intent.ban_type === 'trespass') && t.operation_type === 'created',
                              );
                              const tpl = banTemplates.find((t) => t.is_default) ?? banTemplates[0];
                              if (tpl) intent.ban_letter_template = tpl.id;
                              setPatronBanIntents((prev) => ({
                                ...prev,
                                [patron.id]: intent,
                              }));
                              setPatronExtendIntents((prev) => {
                                const existing = prev[patron.id];
                                if (!existing?.enabled) return prev;
                                return { ...prev, [patron.id]: { ...existing, enabled: false } };
                              });
                            } else {
                              setPatronBanIntents((prev) => ({
                                ...prev,
                                [patron.id]: {
                                  ...(prev[patron.id] || getDefaultBanIntent(incident?.occurred_at)),
                                  enabled: false,
                                },
                              }));
                            }
                          }}
                        />
                      }
                      label={
                        <Typography variant="body2" fontWeight="medium">
                          {hasActiveBanAtLocation ? 'Create a trespass' : 'Create a ban/trespass'}
                        </Typography>
                      }
                    />
                    <Collapse in={banIntent?.enabled ?? false} unmountOnExit>
                      <Box sx={{ mt: 1, p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
                        <BanOptionsPanel
                          banData={banIntent || getDefaultBanIntent(incident?.occurred_at)}
                          onChange={(data) =>
                            setPatronBanIntents((prev) => ({ ...prev, [patron.id]: data }))
                          }
                          hideType={hasActiveBanAtLocation ? 'ban' : undefined}
                          templates={templates}
                          incident={incident}
                          patronDetails={resolvedDetailsMap[patron.id] || null}
                          locationName={locationName}
                          templateError={templateError}
                          violationError={violationError}
                          startsAtError={startsAtError}
                          liftsAtError={liftsAtError}
                          validationSeq={validationSeq}
                        />
                      </Box>
                    </Collapse>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Box>

      <Box display="flex" gap={2} mt={6}>
        <Button variant="outlined" onClick={onBack} startIcon={<BackIcon />}>
          Back
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={onNext} endIcon={<NextIcon />}>
          Next
        </Button>
      </Box>
    </>
  );
};

export default StepBanActions;
