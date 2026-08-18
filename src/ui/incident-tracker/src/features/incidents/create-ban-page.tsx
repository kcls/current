import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import {
  Paper,
  Typography,
  TextField,
  Box,
  Chip,
  Link,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Tabs,
  Tab,
  Divider,
  Autocomplete,
  Checkbox,
  Tooltip,
  Button,
} from '@mui/material';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import { Gavel as GavelIcon, LocationOn as LocationOnIcon } from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { Breadcrumbs } from '../../shared/components/breadcrumbs';
import { useToast } from '../../contexts/toast-context';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import { incidentApi } from '../../api';
import { patronApi } from '../../api/patrons';
import { bansApi } from '../../api/bans';
import { processBanLetterTemplate } from '../../shared/utils/ban-letter-templates';
import { formatBanDate, localDateToUtc, getDefaultBanDates, utcToLocalDate } from '../../shared/utils/date-utils';
import { printFullHtml } from '../../shared/utils/print-service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { useConfirmDialog } from '../../shared/hooks/use-confirm-dialog';
import { BanFormFields } from './components/ban-form-fields';
import { BanLetterSection } from './components/ban-letter-section';
import { BanFormActions } from './components/ban-form-actions';
import {
  useBanForm,
  getDefaultPerPatronData,
  type AvailablePatron,
  type PatronBanStatus,
  type PerPatronFormData,
} from './hooks/use-ban-form';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { Incident } from '../../types';
import type { PatronDetails } from '../../types/patron';

const CreateBanPage: React.FC = () => {
  const navigate = useNavigate();
  const { incidentId, patronId } = useParams<{ incidentId: string; patronId?: string }>();
  const { showSuccess, showError } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();

  const isPatronLocked = !!patronId;

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [templates, setTemplates] = useState<BanLetterTemplate[]>([]);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [patronDetailsMap, setPatronDetailsMap] = useState<Record<string, PatronDetails>>({});
  const [availablePatrons, setAvailablePatrons] = useState<AvailablePatron[]>([]);
  const [selectedPatronIds, setSelectedPatronIds] = useState<string[]>([]);
  const [patronBanAtLocation, setPatronBanAtLocation] = useState<Record<string, PatronBanStatus>>({});

  const [pendingTemplateChange, setPendingTemplateChange] = useState<{
    templateId: number | null;
    isTrespass?: boolean;
  } | null>(null);

  const form = useBanForm({
    templates,
    incident,
    patronDetailsMap,
    preferInPlaceUpdate: false,
    onTypeChangeRequested: (isTrespass) => {
      setPendingTemplateChange({ templateId: null, isTrespass });
      return false; // The pending dialog will handle the actual change
    },
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const tmplList = await bansApi.getBanLetterTemplates();
        setTemplates(tmplList);
        if (incidentId) {
          await loadIncidentData(incidentId, tmplList);
        }
      } catch {
        showError('Failed to load page data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, patronId]);

  const loadIncidentData = async (incidentIdStr: string, tmplList?: BanLetterTemplate[]) => {
    try {
      const incidentData = await incidentApi.get(incidentIdStr);
      setIncident(incidentData);
      const orgUnitId = incidentData.org_unit || null;
      form.setSharedFormData({ incident: incidentData.id, org_unit: orgUnitId });

      const patronList: AvailablePatron[] = [];
      for (const party of incidentData.involved_parties || []) {
        if (
          party.patron_id &&
          party.patron_display &&
          party.party_type === 'patron' &&
          !party.patron_display.is_deleted
        ) {
          patronList.push({ id: party.patron_id, display_name: party.patron_display.display_name });
        }
      }

      setAvailablePatrons(patronList);
      const patronIds = patronList.map((p) => p.id);
      setSelectedPatronIds(patronIds);

      const [detailsResults] = await Promise.all([
        Promise.all(patronList.map((p) => patronApi.get(p.id).catch(() => null))),
      ]);
      const detailsMap: Record<string, PatronDetails> = {};
      detailsResults.forEach((d, i) => {
        const pid = patronIds[i];
        if (d && pid) detailsMap[pid] = d;
      });
      setPatronDetailsMap(detailsMap);

      // Check active bans at incident location for each patron
      const banCheckResults: Record<string, PatronBanStatus> = {};
      if (orgUnitId) {
        await Promise.all(
          patronIds.map(async (pid) => {
            try {
              const bans = await patronApi.getPatronBans({ patronId: pid, orgUnit: orgUnitId });
              const now = new Date();
              let hasBan = false, hasTrespass = false;
              let banId: number | undefined, trespassId: number | undefined;
              let trespassOrgUnitName: string | undefined;
              let banLiftsAt: string | undefined, trespassLiftsAt: string | undefined;
              for (const b of bans) {
                if (b.deleted_at) continue;
                const liftsAt = b.lifts_at ? new Date(b.lifts_at) : null;
                if (!liftsAt || liftsAt > now) {
                  if (b.is_trespass) {
                    hasTrespass = true;
                    trespassId = b.id;
                    trespassOrgUnitName = b.org_unit_name || undefined;
                    trespassLiftsAt = b.lifts_at || undefined;
                  } else if (b.org_unit === orgUnitId) {
                    hasBan = true;
                    banId = b.id;
                    banLiftsAt = b.lifts_at || undefined;
                  }
                }
              }
              if (hasBan || hasTrespass) {
                banCheckResults[pid] = {
                  hasBan,
                  hasTrespass,
                  banId,
                  trespassId,
                  trespassOrgUnitName,
                  banLiftsAt,
                  trespassLiftsAt,
                };
              }
            } catch (err) {
              console.error(`Failed to check bans for patron ${pid}:`, err);
            }
          }),
        );
      }
      setPatronBanAtLocation(banCheckResults);

      const tList = tmplList || templates;
      const defaultBanTemplate = tList.find((t) => t.is_default && !t.is_trespass);
      const defaultTrespassTemplate = tList.find((t) => t.is_default && t.is_trespass);

      const incidentDates = getDefaultBanDates(
        undefined,
        undefined,
        utcToLocalDate(incidentData.occurred_at),
      );

      const newFormData: Record<string, PerPatronFormData> = {};
      for (const pid of patronIds) {
        const status = banCheckResults[pid];
        const forceTrespass = !!(status?.hasTrespass || status?.hasBan);
        const template = forceTrespass
          ? (defaultTrespassTemplate ?? defaultBanTemplate)
          : defaultBanTemplate;
        const content = template
          ? processBanLetterTemplate(template, incidentData, detailsMap[pid], {
              startsAt: incidentDates.startsAt,
              liftsAt: incidentDates.liftsAt,
            })
          : '';
        newFormData[pid] = {
          ...getDefaultPerPatronData(incidentData.occurred_at),
          is_trespass: forceTrespass,
          ban_letter_template: template?.id || null,
          ban_letter_content: content,
        };
      }
      form.setFormDataPerPatron(newFormData);

      if (patronIds.length > 0) form.setCurrentPatronId(patronIds[0] ?? null);
    } catch {
      showError('Failed to load incident details');
    }
  };

  const handleTemplateSelect = (template: BanLetterTemplate) => {
    if (!form.currentPatronId) return;
    if (form.hasEditedContentPerPatron[form.currentPatronId]) {
      setPendingTemplateChange({ templateId: template.id });
      return;
    }
    form.applyTemplateToCurrentPatron(template);
  };

  const handleConfirmTemplateChange = () => {
    if (!pendingTemplateChange || !form.currentPatronId) return;
    if (pendingTemplateChange.isTrespass !== undefined) {
      const isTrespass = pendingTemplateChange.isTrespass;
      form.updatePatronData(form.currentPatronId, { is_trespass: isTrespass });
      const template = isTrespass
        ? templates.find((t) => t.is_trespass && t.is_default)
        : templates.find((t) => !t.is_trespass && t.is_default);
      if (template) form.applyTemplateToCurrentPatron(template);
    } else if (pendingTemplateChange.templateId) {
      const template = templates.find((t) => t.id === pendingTemplateChange.templateId);
      if (template) form.applyTemplateToCurrentPatron(template);
    }
    setPendingTemplateChange(null);
  };

  const handlePatronSelectionChange = (newSelection: AvailablePatron[]) => {
    const newIds = newSelection.map((p) => p.id);
    const addedIds = newIds.filter((pid) => !selectedPatronIds.includes(pid));

    if (addedIds.length > 0 && incident) {
      const defaultTemplate = templates.find((t) => t.is_default && !t.is_trespass);
      form.setFormDataPerPatron((prev) => {
        const updated = { ...prev };
        for (const pid of addedIds) {
          const content = defaultTemplate
            ? form.buildLetterContent(defaultTemplate, incident, patronDetailsMap[pid])
            : '';
          updated[pid] = {
            ...getDefaultPerPatronData(incident.occurred_at),
            ban_letter_template: defaultTemplate?.id || null,
            ban_letter_content: content,
          };
        }
        return updated;
      });
    }

    setSelectedPatronIds(newIds);
    if (newIds.length === 0) {
      form.setCurrentPatronId(null);
    } else if (!newIds.includes(form.currentPatronId || '')) {
      form.setCurrentPatronId(newIds[0] ?? null);
    }
  };

  const handleResetToTemplate = async () => {
    if (!form.currentPatronId || !form.currentFormData.ban_letter_template || !incident) return;
    const template = templates.find((t) => t.id === form.currentFormData.ban_letter_template);
    if (!template) return;
    const ok = await confirm({
      title: 'Reset letter?',
      message: 'This will reset the letter to the selected template. Any manual edits to the letter will be lost.',
    });
    if (!ok) return;
    const content = form.buildLetterContent(template, incident, patronDetailsMap[form.currentPatronId]);
    form.updatePatronData(form.currentPatronId, { ban_letter_content: content });
    form.setHasEditedContentPerPatron((prev) => ({ ...prev, [form.currentPatronId!]: false }));
  };

  const handlePrintPreview = () => {
    const html = form.editorRef.current?.getFullHtml();
    if (!html) return;
    printFullHtml(html);
  };

  const handleSubmit = async () => {
    const snapshot = form.syncAndGetSnapshot();
    if (!form.validateForm(selectedPatronIds, true, snapshot)) return;

    setIsSubmitting(true);
    try {
      for (const pid of selectedPatronIds) {
        const data = snapshot[pid];
        if (!data) continue;
        await bansApi.createBan({
          patron: parseInt(pid),
          incident: form.sharedFormData.incident!,
          org_unit: form.sharedFormData.org_unit!,
          starts_at: localDateToUtc(data.starts_at),
          lifts_at: data.lifts_at ? localDateToUtc(data.lifts_at) : undefined,
          comments: data.comments || undefined,
          case_number: data.case_number || undefined,
          law_enforcement_agency: data.law_enforcement_agency || undefined,
          ban_letter_template: data.ban_letter_template || undefined,
          ban_letter_content: data.ban_letter_content || undefined,
          is_trespass: data.is_trespass,
        });
      }
      const label = form.currentFormData.is_trespass ? 'Trespass' : 'Ban';
      showSuccess(
        selectedPatronIds.length > 1
          ? `Successfully created ${selectedPatronIds.length} ban(s)/trespass(es)`
          : `${label} created successfully`,
      );
      navigate(`/incidents/${form.sharedFormData.incident}`);
    } catch (error: any) {
      showError(error.message || 'Failed to create ban');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <LoadingSkeleton variant="form" rows={8} />
      </PageContainer>
    );
  }

  const currentBanStatus = patronBanAtLocation[form.currentPatronId ?? ''] ?? null;
  const hasActiveTrespass = !!currentBanStatus?.hasTrespass;
  const hasActiveBanAtLocation = !!currentBanStatus?.hasBan;
  const typeIsLocked = hasActiveTrespass || hasActiveBanAtLocation;
  const hasAnyTrespassBlock = selectedPatronIds.some(
    (pid) => !!patronBanAtLocation[pid]?.hasTrespass,
  );

  const banStatusAlert = (
    <>
      {hasActiveTrespass && (
        <Alert severity="warning">
          Already has an active{' '}
          <Link component={RouterLink} to={`/bans/${currentBanStatus!.trespassId}`} target="_blank">
            trespass
          </Link>
          {currentBanStatus?.trespassLiftsAt && (
            <> · Lifts {formatBanDate(currentBanStatus.trespassLiftsAt)}</>
          )}
        </Alert>
      )}
      {!hasActiveTrespass && hasActiveBanAtLocation && (
        <Alert severity="info">
          Already has an active{' '}
          <Link component={RouterLink} to={`/bans/${currentBanStatus!.banId}`} target="_blank">
            ban
          </Link>
          {currentBanStatus?.banLiftsAt && (
            <> · Lifts {formatBanDate(currentBanStatus.banLiftsAt)}</>
          )}
        </Alert>
      )}
    </>
  );

  const submitLabel =
    selectedPatronIds.length > 1
      ? `Create ${selectedPatronIds.length} Bans/Trespasses`
      : `Create ${form.currentFormData.is_trespass ? 'Trespass' : 'Ban'}`;

  return (
    <PageContainer maxWidth="lg">
      <Breadcrumbs
        items={[
          { label: 'Incidents', href: '/incidents' },
          { label: `Incident #${form.sharedFormData.incident}`, href: `/incidents/${form.sharedFormData.incident}` },
          { label: 'New Ban/Trespass' },
        ]}
      />

      <Paper sx={{ p: 4 }}>
        <Box display="flex" gap={2} mb={3}>
          {incident && (
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Incident
                </Typography>
                <Tooltip
                  title="Click to view incident details. Ban/trespass letter may include incident description and other details."
                  arrow
                  disableInteractive
                >
                  <Link
                    component={RouterLink}
                    to={`/incidents/${incident.id}`}
                    sx={{ textDecoration: 'none', display: 'inline-block' }}
                  >
                    <Typography variant="body1" fontWeight="medium">
                      Incident #{incident.id}
                    </Typography>
                  </Link>
                </Tooltip>
                <Typography variant="body2" color="text.secondary">
                  {incident.title}
                </Typography>
                {incident.org_unit_name && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                    <LocationOnIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {incident.org_unit_name}
                    </Typography>
                  </Box>
                )}
                {incident.template_name && (
                  <Box sx={{ mt: 1 }}>
                    <Chip label={incident.template_name} size="small" />
                  </Box>
                )}
              </CardContent>
            </Card>
          )}

          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Patrons
              </Typography>
              {availablePatrons.length === 0 ? (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  No patrons found for this incident. Please add patrons to the incident first.
                </Alert>
              ) : availablePatrons.length === 1 ? (
                <Tooltip
                  title="Click to view patron details. Ban/trespass letter may require patron info such as address."
                  arrow
                  disableInteractive
                >
                  <Link
                    component={RouterLink}
                    to={`/patrons/${availablePatrons[0]!.id}`}
                    sx={{ textDecoration: 'none', display: 'inline-block' }}
                  >
                    <Typography variant="body1">
                      {availablePatrons[0]!.display_name || availablePatrons[0]!.id}
                    </Typography>
                  </Link>
                </Tooltip>
              ) : (
                <>
                  <Autocomplete
                    multiple
                    disableCloseOnSelect
                    options={availablePatrons}
                    value={availablePatrons.filter((p) => selectedPatronIds.includes(p.id))}
                    onChange={(_, newValue) => handlePatronSelectionChange(newValue)}
                    getOptionLabel={(option) => option.display_name || option.id}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    disabled={isPatronLocked}
                    renderOption={(props, option, { selected }) => {
                      const { key, ...rest } = props;
                      return (
                        <li key={key} {...rest}>
                          <Checkbox
                            icon={<CheckBoxOutlineBlankIcon fontSize="small" />}
                            checkedIcon={<CheckBoxIcon fontSize="small" />}
                            style={{ marginRight: 8 }}
                            checked={selected}
                          />
                          {option.display_name || option.id}
                        </li>
                      );
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder={
                          selectedPatronIds.length === 0 ? 'Select patrons to ban/trespass' : ''
                        }
                        size="small"
                        inputProps={{
                          ...params.inputProps,
                          readOnly: true,
                          style: { cursor: 'pointer', caretColor: 'transparent' },
                        }}
                        InputProps={{ ...params.InputProps, sx: { cursor: 'pointer' } }}
                      />
                    )}
                    renderTags={(value) => (
                      <Typography variant="body2" sx={{ ml: 1 }}>
                        {value.length} patron{value.length !== 1 ? 's' : ''} selected
                      </Typography>
                    )}
                  />
                  {selectedPatronIds.length > 0 && (
                    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {selectedPatronIds.map((pid) => {
                        const patron = availablePatrons.find((p) => p.id === pid);
                        if (!patron) return null;
                        return (
                          <Tooltip key={pid} title="Click to view patron details." arrow disableInteractive>
                            <Link
                              component={RouterLink}
                              to={`/patrons/${pid}`}
                              sx={{ textDecoration: 'none', display: 'inline-block' }}
                            >
                              <Typography variant="body1">
                                {patron.display_name || pid}
                              </Typography>
                            </Link>
                          </Tooltip>
                        );
                      })}
                    </Box>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </Box>

        {availablePatrons.length > 1 && (
          <Box sx={{ mb: 3 }}>
            <Tabs
              value={form.currentPatronId || selectedPatronIds[0]}
              onChange={(_, value) => form.setCurrentPatronId(value)}
              variant="scrollable"
              scrollButtons="auto"
            >
              {selectedPatronIds.map((pid) => {
                const p = availablePatrons.find((a) => a.id === pid);
                const hasError =
                  form.errorsPerPatron[pid] && Object.keys(form.errorsPerPatron[pid]).length > 0;
                return (
                  <Tab
                    key={pid}
                    value={pid}
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {p?.display_name || pid}
                        {hasError && (
                          <Box
                            component="span"
                            sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }}
                          />
                        )}
                      </Box>
                    }
                  />
                );
              })}
            </Tabs>
            <Divider />
          </Box>
        )}

        <BanFormFields
          formData={form.currentFormData}
          errors={form.currentErrors}
          presetValue={form.presetValue}
          onFieldChange={form.handleInputChange}
          typeDisabled={typeIsLocked}
          banStatusAlert={banStatusAlert}
        />

        <BanLetterSection
          formData={form.currentFormData}
          templates={templates}
          errors={form.currentErrors}
          editorRef={form.editorRef}
          currentPatronId={form.currentPatronId}
          onTemplateSelect={handleTemplateSelect}
          onResetToTemplate={handleResetToTemplate}
          onPrintPreview={handlePrintPreview}
          onContentEdited={(html) => {
            form.updateCurrentPatronData({ ban_letter_content: html });
            if (form.currentPatronId) {
              form.setHasEditedContentPerPatron((prev) => ({
                ...prev,
                [form.currentPatronId!]: true,
              }));
            }
          }}
          templateRequired
          resetTooltip="Reset letter to selected template"
        />

        <BanFormActions
          onSubmit={handleSubmit}
          cancelTo={`/incidents/${form.sharedFormData.incident}`}
          submitLabel={submitLabel}
          submitIcon={<GavelIcon />}
          isSubmitting={isSubmitting}
          disabled={loading || selectedPatronIds.length === 0 || hasAnyTrespassBlock}
        />
      </Paper>

      <Dialog open={!!pendingTemplateChange} onClose={() => setPendingTemplateChange(null)}>
        <DialogTitle>Discard Letter Edits?</DialogTitle>
        <DialogContent>
          <Typography>
            You have edited the letter content. Switching{' '}
            {pendingTemplateChange?.isTrespass !== undefined ? 'type' : 'template'} will replace
            your edits with the new template content.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingTemplateChange(null)}>Cancel</Button>
          <Button onClick={handleConfirmTemplateChange} color="warning" variant="contained">
            Discard &amp; Switch
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog {...dialogProps} />
    </PageContainer>
  );
};

export default CreateBanPage;
