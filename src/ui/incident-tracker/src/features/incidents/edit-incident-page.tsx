import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../../constants';
import { Paper, Typography, Box, Alert, Link } from '@mui/material';
import { PageContainer } from '../../shared/components/layout';
import { useToast } from '../../contexts/toast-context';
import { useTemplates } from '../../contexts/templates-context';
import { useLocations } from '../../contexts/location-context';
import { useIncidents } from '../../contexts/incidents-context';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import { Breadcrumbs } from '../../shared/components/breadcrumbs';
import { StepReport } from './components/incident-form-step-report';
import { useFileUpload } from './hooks/use-file-upload';
import { useIncidentFormState } from './hooks/use-incident-form-state';
import { useEditModePrefill } from './hooks/use-edit-mode-prefill';
import { submitIncident, type SubmitIncidentResult } from './utils/incident-submit';
import { BanLetterPromptDialog, type BanNeedingLetter } from './components/ban-letter-prompt-dialog';
import { patronApi } from '../../api/patrons';
import type { IncidentTemplate } from '../../types';

const EditIncidentPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const { isLoading: templatesLoading, fetchTemplates } = useTemplates();
  const { isLoading: locationsLoading } = useLocations();
  const {
    currentIncident,
    isLoading: incidentLoading,
    fetchIncident: fetchIncidentById,
    createIncident,
    updateIncident,
  } = useIncidents();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [letterPrompt, setLetterPrompt] = useState<{
    bans: BanNeedingLetter[];
    navigateTo: string;
  } | null>(null);

  const fileUpload = useFileUpload({ entityId: id, showError, showSuccess });
  // The context can still hold the previously viewed incident until the
  // fetch below lands; only trust it once the ids match.
  const loadedIncident = currentIncident && String(currentIncident.id) === id ? currentIncident : null;
  const followupOf = loadedIncident?.followup_of ?? null;
  const isFollowup = followupOf != null;
  const relatedIds = (loadedIncident?.linked_incidents ?? [])
    .filter((l) => l.link_type === 'related')
    .map((l) => l.incident_id);

  const form = useIncidentFormState({ isEditMode: true, templateId: null, isFollowup, fileUpload });

  // Active bans/trespasses created on this incident. Moving such an incident
  // ends in the new-letter prompt, so Save & Ban is withheld while the
  // location is changed. Unknown (lookup failed) counts as none.
  const [hasActiveBans, setHasActiveBans] = useState(false);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    patronApi
      .getPatronBans({ incidentId: id, limit: 1 })
      .then((bans) => !cancelled && setHasActiveBans(bans.length > 0))
      .catch(() => !cancelled && setHasActiveBans(false));
    return () => {
      cancelled = true;
    };
  }, [id]);
  const isMovingWithBans =
    hasActiveBans && loadedIncident != null && form.formData.org_unit !== loadedIncident.org_unit;

  useEditModePrefill({
    isEditMode: true,
    currentIncident,
    setFormData: form.setFormData,
    setSelectedPatrons: form.setSelectedPatrons,
    setSelectedStaff: form.setSelectedStaff,
    setPatronNotes: form.setPatronNotes,
    setStaffNotes: form.setStaffNotes,
    setUploadedFiles: fileUpload.setUploadedFiles,
    setExternalLinks: form.setExternalLinks,
  });

  useEffect(() => {
    fetchTemplates({});
    if (id) {
      fetchIncidentById(parseInt(id));
    }
  }, [id, fetchTemplates, fetchIncidentById]);

  // Title is derived from selected templates (same rule as create flow).
  // Without this, removing a template here leaves the old joined-name title
  // in place and the detail-page header keeps showing the removed template.
  useEffect(() => {
    if (form.formData.template_ids && form.formData.template_ids.length > 0) {
      const selectedTemplates = form.formData.template_ids
        .map((tid) => form.templates.find((t) => t.id === tid))
        .filter((t): t is IncidentTemplate => t !== undefined);

      if (selectedTemplates.length > 0) {
        const title =
          selectedTemplates.length === 1
            ? selectedTemplates[0]!.name
            : selectedTemplates.map((t) => t.name).join(', ');

        form.setFormData((prev) => (prev.title === title ? prev : { ...prev, title }));
      }
    }
  }, [form.formData.template_ids, form.templates]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildSubmitParams = (action: 'save_draft' | 'submit_for_review' | 'save_and_ban') => ({
    action,
    isEditMode: true,
    incidentId: id,
    formData: form.formData,
    selectedPatrons: form.selectedPatrons,
    selectedStaff: form.selectedStaff,
    patronNotes: form.patronNotes,
    staffNotes: form.staffNotes,
    patronBanIntents: form.patronBanIntents,
    patronExtendIntents: form.patronExtendIntents,
    uploadedFiles: fileUpload.uploadedFiles,
    externalLinks: form.externalLinks,
    user: form.user,
    locationName: form.locationName,
    currentIncident: currentIncident || undefined,
    createIncident,
    updateIncident,
    showError,
  } as const);

  // After a move, active bans/trespasses need letters naming the new
  // location; offer that before leaving the page.
  const finishSubmit = (result: SubmitIncidentResult) => {
    showSuccess(result.successMessage);
    const bans = (result.move?.moved_bans ?? [])
      .filter((b) => !b.is_archived)
      .map((b) => {
        const party = loadedIncident?.involved_parties?.find(
          (p) => String(p.patron_id) === String(b.patron),
        );
        return {
          banId: b.id,
          isTrespass: b.is_trespass,
          patronName: party?.patron_display?.display_name || `Patron #${b.patron}`,
        };
      });
    if (bans.length > 0) {
      setLetterPrompt({ bans, navigateTo: result.navigateTo });
    } else {
      navigate(result.navigateTo);
    }
  };

  const handleSaveDraft = async () => {
    if (!form.validateStepReport()) return;
    setIsSubmitting(true);
    try {
      const result = await submitIncident(buildSubmitParams('save_draft'));
      finishSubmit(result);
    } catch (error: any) {
      showError(error.message || 'Failed to save incident');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!form.validateForm()) return;
    setIsSubmitting(true);
    try {
      const result = await submitIncident(buildSubmitParams('submit_for_review'));
      finishSubmit(result);
    } catch (error: any) {
      showError(error.message || 'Failed to submit incident for review');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveAndBan = async () => {
    if (!form.validateStepReport()) return;
    setIsSubmitting(true);
    try {
      const result = await submitIncident(buildSubmitParams('save_and_ban'));
      finishSubmit(result);
    } catch (error: any) {
      showError(error.message || 'Failed to save incident');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (templatesLoading || locationsLoading || incidentLoading) {
    return (
      <PageContainer>
        <LoadingSkeleton variant="form" rows={8} />
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="lg">
      <Breadcrumbs
        items={[
          { label: 'Incidents', href: ROUTES.INCIDENTS },
          { label: `Incident #${id}`, href: `/incidents/${id}` },
          { label: 'Edit Incident' },
        ]}
      />

      <Paper sx={{ p: 4 }}>
        <Box mb={3}>
          <Typography variant="h5" gutterBottom>
            {isFollowup ? 'Edit Follow-up Incident' : 'Edit Incident'}
          </Typography>
          {isFollowup && (
            <Alert severity="info" sx={{ mb: 1 }}>
              This is a follow-up to{' '}
              <Link component={RouterLink} to={`/incidents/${followupOf}`}>
                Incident #{followupOf}
              </Link>
              . Its templates and sub-location come from the original incident and cannot be
              changed, and bans or trespasses cannot be added to it.
            </Alert>
          )}
          {relatedIds.length > 0 && (
            <Alert severity="info">
              Related to{' '}
              {relatedIds.map((rid, i) => (
                <React.Fragment key={rid}>
                  {i > 0 && ', '}
                  <Link component={RouterLink} to={`/incidents/${rid}`}>
                    Incident #{rid}
                  </Link>
                </React.Fragment>
              ))}
              .
            </Alert>
          )}
        </Box>

        <StepReport
          formData={form.formData}
          errors={form.errors}
          onInputChange={form.handleInputChange}
          clearError={form.clearError}
          isEditMode
          originalOrgUnit={loadedIncident?.org_unit ?? null}
          isFollowup={isFollowup}
          isSubmitting={isSubmitting}
          templates={form.templates}
          locations={form.locations}
          availableLocationOptions={form.availableLocationOptions}
          subLocations={form.subLocations}
          isLoadingSubLocations={form.isLoadingSubLocations}
          patron={form.patronProps}
          staff={form.staffProps}
          shouldShowCalledEmergency={form.shouldShowCalledEmergency}
          attachment={form.attachmentProps}
          externalLinks={form.externalLinks}
          setExternalLinks={form.setExternalLinks}
          onNext={() => {}}
          onSaveReport={handleSaveDraft}
          saveReportLabel={isMovingWithBans ? 'Save & Move' : undefined}
          hasReviewChain={form.hasReviewChain}
          onSubmitForReview={handleSubmitForReview}
          onSaveAndBan={isFollowup || isMovingWithBans ? undefined : handleSaveAndBan}
        />
      </Paper>

      <BanLetterPromptDialog
        open={letterPrompt !== null}
        bans={letterPrompt?.bans ?? []}
        locationName={form.locationName || 'the new location'}
        onGenerate={(banId) => navigate(`/bans/${banId}/edit`, { state: { regenerateLetter: true } })}
        onSkip={() => letterPrompt && navigate(letterPrompt.navigateTo)}
      />
    </PageContainer>
  );
};

export default EditIncidentPage;
