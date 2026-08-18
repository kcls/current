import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ROUTES } from '../../constants';
import { Paper, Typography, Box } from '@mui/material';
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
import { submitIncident } from './utils/incident-submit';
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

  const fileUpload = useFileUpload({ entityId: id, showError, showSuccess });
  const form = useIncidentFormState({ isEditMode: true, templateId: null, fileUpload });

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

  const handleSaveDraft = async () => {
    if (!form.validateStepReport()) return;
    setIsSubmitting(true);
    try {
      const result = await submitIncident(buildSubmitParams('save_draft'));
      showSuccess(result.successMessage);
      navigate(result.navigateTo);
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
      showSuccess(result.successMessage);
      navigate(result.navigateTo);
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
      showSuccess(result.successMessage);
      navigate(result.navigateTo);
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
            Edit Incident
          </Typography>
        </Box>

        <StepReport
          formData={form.formData}
          errors={form.errors}
          onInputChange={form.handleInputChange}
          clearError={form.clearError}
          isEditMode
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
          hasReviewChain={form.hasReviewChain}
          onSubmitForReview={handleSubmitForReview}
          onSaveAndBan={handleSaveAndBan}
        />
      </Paper>
    </PageContainer>
  );
};

export default EditIncidentPage;
