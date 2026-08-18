import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Paper } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { Breadcrumbs } from '../../shared/components/breadcrumbs';
import { useToast } from '../../contexts/toast-context';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import { incidentApi } from '../../api';
import { patronApi } from '../../api/patrons';
import { bansApi } from '../../api/bans';
import { getBanActivity } from '../../api/activity';
import { localDateToUtc, utcToLocalDate } from '../../shared/utils/date-utils';
import { printFullHtml } from '../../shared/utils/print-service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { useConfirmDialog } from '../../shared/hooks/use-confirm-dialog';
import { BanFormFields } from './components/ban-form-fields';
import { BanLetterSection } from './components/ban-letter-section';
import { BanFormActions } from './components/ban-form-actions';
import { useBanForm, type AvailablePatron } from './hooks/use-ban-form';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { Incident } from '../../types';
import type { PatronDetails } from '../../types/patron';

const EditBanPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showSuccess, showError } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();

  const isFromBanPage = location.pathname.startsWith('/bans/');

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [templates, setTemplates] = useState<BanLetterTemplate[]>([]);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [patronDetailsMap, setPatronDetailsMap] = useState<Record<string, PatronDetails>>({});
  const [availablePatrons, setAvailablePatrons] = useState<AvailablePatron[]>([]);
  const [existingBan, setExistingBan] = useState<any>(null);

  const form = useBanForm({
    templates,
    incident,
    patronDetailsMap,
    preferInPlaceUpdate: true,
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const tmplList = await bansApi.getBanLetterTemplates();
        setTemplates(tmplList);
        if (id) {
          await loadExistingBan(id, tmplList);
        }
      } catch {
        showError('Failed to load page data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadExistingBan = async (banId: string, tmplList?: BanLetterTemplate[]) => {
    try {
      const details = await bansApi.getBanDetails(parseInt(banId));
      const ban = details.ban;
      setExistingBan(ban);

      const letter = details.letters?.[0] ?? null;
      let letterContent = '';
      if (letter) {
        const letterData = await bansApi.getBanLetter(letter.id);
        letterContent = letterData?.content || '';
      }

      const activityEntries = await getBanActivity(parseInt(banId));
      const createdEntry = activityEntries.find((e) => e.event_type === 'ban.created');
      const caseNumber = (createdEntry?.event_data?.case_number as string) || '';
      const lawEnforcementAgency = (createdEntry?.event_data?.law_enforcement_agency as string) || '';

      const incidentRef = ban.incident;
      const incidentId = typeof incidentRef === 'object' ? incidentRef?.id : incidentRef;
      form.setSharedFormData({
        incident: incidentId ?? null,
        org_unit: ban.org_unit || null,
      });

      if (ban.patron) {
        const pid = String(typeof ban.patron === 'object' ? ban.patron.id : ban.patron);
        form.setFormDataPerPatron({
          [pid]: {
            is_trespass: ban.is_trespass || false,
            case_number: caseNumber,
            law_enforcement_agency: lawEnforcementAgency,
            starts_at: ban.starts_at ? utcToLocalDate(ban.starts_at) : '',
            lifts_at: ban.lifts_at ? utcToLocalDate(ban.lifts_at) : '',
            archives_at: ban.archives_at ? utcToLocalDate(ban.archives_at) : '',
            comments: ban.comments || '',
            ban_letter_template: letter?.template || null,
            ban_letter_content: letterContent,
          },
        });
        form.setCurrentPatronId(pid);

        try {
          const patronData = await patronApi.get(pid);
          setPatronDetailsMap({ [pid]: patronData });
          setAvailablePatrons([{ id: pid, display_name: patronData.display_name || pid }]);
        } catch {
          const p = ban.patron;
          if (typeof p === 'object') {
            const name = p.preferred_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
            setAvailablePatrons([{ id: pid, display_name: name || pid }]);
          }
        }
      }

      if (ban.incident) {
        const iid = typeof ban.incident === 'object' ? ban.incident.id : ban.incident;
        if (iid) {
          const fullIncident = await incidentApi.get(String(iid));
          setIncident(fullIncident);
        }
      }
    } catch {
      showError('Failed to load ban details');
    }
  };

  const handleResetToTemplate = async () => {
    if (!form.currentPatronId || !form.currentFormData.ban_letter_template || !incident) return;
    const template = templates.find((t) => t.id === form.currentFormData.ban_letter_template);
    if (!template) return;
    const ok = await confirm({
      title: 'Reset letter?',
      message: 'This will fetch the latest patron and incident data, then regenerate the letter using the selected template. Any unsaved edits to the letter will be lost.',
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
    if (!form.validateForm([form.currentPatronId!], false, snapshot)) return;

    setIsSubmitting(true);
    try {
      const data = snapshot[form.currentPatronId!];
      if (!data) return;
      await bansApi.editBan({
        ban_id: parseInt(id!),
        starts_at: data.starts_at ? localDateToUtc(data.starts_at) : undefined,
        lifts_at: data.lifts_at ? localDateToUtc(data.lifts_at) : undefined,
        archives_at: data.archives_at ? localDateToUtc(data.archives_at) : undefined,
        org_unit: form.sharedFormData.org_unit || undefined,
        comments: data.comments || undefined,
        is_trespass: data.is_trespass,
        case_number: data.case_number || undefined,
        law_enforcement_agency: data.law_enforcement_agency || undefined,
        ban_letter_template: data.ban_letter_template || undefined,
        ban_letter_content: data.ban_letter_content || undefined,
      });
      showSuccess(`${data.is_trespass ? 'Trespass' : 'Ban'} #${id} updated successfully`);
      navigate(isFromBanPage ? `/bans/${id}` : `/incidents/${form.sharedFormData.incident}`);
    } catch (error: any) {
      showError(error.message || 'Failed to save ban');
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

  const cancelTo = isFromBanPage ? `/bans/${id}` : `/incidents/${form.sharedFormData.incident}`;

  return (
    <PageContainer maxWidth="lg">
      <Breadcrumbs
        items={isFromBanPage ? [
          { label: 'Patrons', href: '/patrons' },
          ...(availablePatrons[0]
            ? [{ label: availablePatrons[0].display_name, href: `/patrons/${availablePatrons[0].id}` }]
            : []),
          { label: `${existingBan?.is_trespass ? 'Trespass' : 'Ban'} #${id}`, href: `/bans/${id}` },
          { label: 'Edit' },
        ] : [
          { label: 'Incidents', href: '/incidents' },
          { label: `Incident #${form.sharedFormData.incident}`, href: `/incidents/${form.sharedFormData.incident}` },
          { label: 'Edit Ban/Trespass' },
        ]}
      />

      <Paper sx={{ p: 4 }}>
        <BanFormFields
          formData={form.currentFormData}
          errors={form.currentErrors}
          presetValue={form.presetValue}
          onFieldChange={form.handleInputChange}
          typeDisabled
        />

        <BanLetterSection
          formData={form.currentFormData}
          templates={templates}
          errors={form.currentErrors}
          editorRef={form.editorRef}
          currentPatronId={form.currentPatronId}
          onTemplateSelect={() => {}} // Template selector is disabled in edit mode
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
          templateDisabled
          resetTooltip="Regenerate letter from template with latest patron and incident data"
        />

        <BanFormActions
          onSubmit={handleSubmit}
          cancelTo={cancelTo}
          submitLabel="Save & Regenerate Letter"
          submitIcon={<SaveIcon />}
          isSubmitting={isSubmitting}
          disabled={loading}
        />
      </Paper>

      <ConfirmDialog {...dialogProps} />
    </PageContainer>
  );
};

export default EditBanPage;
