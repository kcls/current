import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ROUTES } from '../../constants';
import { Paper, Typography, Box } from '@mui/material';
import { PageContainer } from '../../shared/components/layout';
import { useToast } from '../../contexts/toast-context';
import { useTemplates } from '../../contexts/templates-context';
import { useLocations } from '../../contexts/location-context';
import LoadingSkeleton from '../../shared/components/loading-skeleton';
import { Breadcrumbs } from '../../shared/components/breadcrumbs';
import { patronApi } from '../../api/patrons';
import { bansApi } from '../../api/bans';
import { IncidentFormStepper, type StepDefinition } from './components/incident-form-stepper';
import { StepReport, type IncidentFormState } from './components/incident-form-step-report';
import { StepBanActions } from './components/incident-form-step-ban-actions';
import { StepReview } from './components/incident-form-step-review';
import { useIncidents } from '../../contexts/incidents-context';
import { useFileUpload } from './hooks/use-file-upload';
import { useIncidentFormState } from './hooks/use-incident-form-state';
import { submitIncident } from './utils/incident-submit';
import { authApi as coreAuthApi } from '@core';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { PatronSearchResult } from '../../types';
import type { PatronDetails } from '../../types/patron';
import type { IncidentTemplate } from '../../types';
import { hasRole, INCIDENT_ROLES } from '../../shared/utils/roles';

const CreateIncidentPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showSuccess, showError } = useToast();
  const { isLoading: templatesLoading, fetchTemplates } = useTemplates();
  const { isLoading: locationsLoading } = useLocations();
  const { createIncident, updateIncident } = useIncidents();

  const templateId = searchParams.get('template');
  const prefillBanId = searchParams.get('ban_id');
  const prefillPatronId = searchParams.get('patron_id');

  const fileUpload = useFileUpload({ showError, showSuccess });
  const form = useIncidentFormState({ isEditMode: false, templateId, fileUpload });

  const [activeStep, setActiveStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [banLetterTemplates, setBanLetterTemplates] = useState<BanLetterTemplate[]>([]);
  const [banValidationSeq, setBanValidationSeq] = useState(0);

  const steps: StepDefinition[] = [
    { label: 'Report' },
    { label: 'Create Bans / Trespasses', optional: true },
    { label: 'Submit for Review' },
  ];

  const currentStepLabel = steps[activeStep]?.label;

  useEffect(() => {
    fetchTemplates({});
    bansApi.getBanLetterTemplates().then(setBanLetterTemplates).catch(console.error);
  }, [fetchTemplates]);

  // Pre-fill from query params (ban_id or patron_id)
  useEffect(() => {
    const prefill = async () => {
      try {
        if (prefillBanId) {
          const details = await bansApi.getBanDetails(parseInt(prefillBanId, 10));
          const ban = details.ban;
          const patronId = ban.patron_id || (typeof ban.patron === 'object' ? ban.patron?.id : ban.patron);
          if (patronId) {
            const summary = await patronApi.getDetailSummary(patronId);
            const p = summary.patron;
            const result: PatronSearchResult = {
              id: String(p.id),
              display_name: p.display_name,
              barcode: p.barcode,
              status: p.status ?? 'active',
            };
            form.setSelectedPatrons((prev) =>
              prev.some((x) => x.id === result.id) ? prev : [...prev, result],
            );
          }
        } else if (prefillPatronId) {
          const summary = await patronApi.getDetailSummary(prefillPatronId);
          const p = summary.patron;
          const result: PatronSearchResult = {
            id: String(p.id),
            display_name: p.display_name,
            barcode: p.barcode,
            status: p.status ?? 'active',
          };
          form.setSelectedPatrons((prev) =>
            prev.some((x) => x.id === result.id) ? prev : [...prev, result],
          );
        }
      } catch (err) {
        console.error('Failed to prefill from query params:', err);
      }
    };
    prefill();
  }, [prefillBanId, prefillPatronId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch patron details when entering Step 2
  useEffect(() => {
    if (currentStepLabel !== 'Create Bans / Trespasses') return;
    for (const patron of form.selectedPatrons) {
      if (patron.is_new_unsaved || form.patronDetailsMap[patron.id] !== undefined) continue;
      patronApi.get(patron.id).then((details: PatronDetails) => {
        form.setPatronDetailsMap((prev) => ({ ...prev, [patron.id]: details }));
      }).catch(() => {
        form.setPatronDetailsMap((prev) => ({ ...prev, [patron.id]: null }));
      });
    }
  }, [currentStepLabel, form.selectedPatrons]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply templates when selected
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

        form.setFormData((prev) => ({
          ...prev,
          title,
          metadata: { ...prev.metadata },
        }));

        const allChecklists = selectedTemplates
          .filter((t) => t.resolution_checklist && t.resolution_checklist.length > 0)
          .flatMap((t) => t.resolution_checklist || []);

        if (allChecklists.length > 0) {
          form.setFormData((prev) => ({
            ...prev,
            metadata: { ...prev.metadata, resolution_checklist: allChecklists },
          }));
        }
      }
    }
  }, [form.formData.template_ids, form.templates]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = () => {
    if (currentStepLabel === 'Report' && !form.validateStepReport()) return;
    if (currentStepLabel === 'Create Bans / Trespasses' && !form.validateStepBanActions()) {
      setBanValidationSeq((seq) => seq + 1);
      return;
    }
    setActiveStep((prev) => {
      let next = prev + 1;
      if (next === 1 && !form.hasPatrons) next = 2;
      return Math.min(next, steps.length - 1);
    });
  };

  const handleBack = () => {
    setActiveStep((prev) => {
      let back = prev - 1;
      if (back === 1 && !form.hasPatrons) back = 0;
      return Math.max(back, 0);
    });
  };

  const handleSaveDraft = async () => {
    if (!form.validateStepReport()) {
      setActiveStep(0);
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await submitIncident({
        action: 'save_draft',
        isEditMode: false,
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
        createIncident,
        updateIncident,
        showError,
      });
      showSuccess(result.successMessage);
      navigate(result.navigateTo);
    } catch (error: any) {
      showError(error.message || 'Failed to save incident');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!form.validateForm()) {
      setActiveStep(0);
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await submitIncident({
        action: 'submit_for_review',
        isEditMode: false,
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
        createIncident,
        updateIncident,
        showError,
      });
      showSuccess(result.successMessage);
      navigate(result.navigateTo);
    } catch (error: any) {
      showError(error.message || 'Failed to submit incident for review');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (templatesLoading || locationsLoading) {
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
          { label: 'New Incident' },
        ]}
      />

      <Paper sx={{ p: 4 }}>
        <Box mb={3}>
          <Typography variant="h5" gutterBottom>
            Report New Incident
          </Typography>
        </Box>

        <IncidentFormStepper activeStep={activeStep} steps={steps} />

        {/* Step 1: Report */}
        {currentStepLabel === 'Report' && (
          <StepReport
            formData={form.formData}
            errors={form.errors}
            onInputChange={form.handleInputChange}
            clearError={form.clearError}
            isEditMode={false}
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
            onNext={handleNext}
            hasReviewChain={form.hasReviewChain}
          />
        )}

        {/* Step 2: Create Bans / Trespasses */}
        {currentStepLabel === 'Create Bans / Trespasses' && (
          <StepBanActions
            selectedPatrons={form.selectedPatrons}
            patronNotes={form.patronNotes}
            patronBanAtLocation={form.patronBanAtLocation}
            locationName={form.locationName}
            patronBanIntents={form.patronBanIntents}
            setPatronBanIntents={form.setPatronBanIntents}
            patronExtendIntents={form.patronExtendIntents}
            setPatronExtendIntents={form.setPatronExtendIntents}
            templates={banLetterTemplates}
            incident={form.tempIncident}
            patronDetailsMap={form.patronDetailsMap}
            errors={form.banStepErrors}
            validationSeq={banValidationSeq}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}

        {/* Step 3: Submit for Review */}
        {currentStepLabel === 'Submit for Review' && (
          <StepReview
            reviewChain={form.reviewChain}
            hasReviewChain={form.hasReviewChain}
            currentUserId={coreAuthApi.getSessionData()?.user_uuid ?? null}
            isAdmin={hasRole(form.user ?? null, INCIDENT_ROLES.ADMIN)}
            onBack={handleBack}
            onSaveReport={handleSaveDraft}
            onSubmitForReview={handleSubmitForReview}
            isSubmitting={isSubmitting}
          />
        )}
      </Paper>
    </PageContainer>
  );
};

export default CreateIncidentPage;
