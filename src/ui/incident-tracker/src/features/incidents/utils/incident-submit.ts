import type { Incident } from '../../../types';
import type { PatronSearchResult } from '../../../types';
import type { StaffSearchResult } from '../../../api/staff';
import type { FileUploadResponse } from '@core/api/upload';
import type { ExternalLinkFormData } from '../components/external-link-dialog';
import type { BanIntentData } from '../components/ban-options-panel';
import type { ExtendIntentData } from '../components/incident-form-step-ban-actions';
import type { IncidentFormState } from '../components/incident-form-step-report';
import { bansApi } from '../../../api/bans';
import { incidentApi } from '../../../api';
import {
  preparePatronsForSubmit,
  buildInvolvedParties,
  buildCreateIncidentData,
  buildIncidentUpdateData,
  calculateInvolvedPartiesChanges,
  calculateExternalLinksChanges,
  calculateAttachmentChanges,
} from './incident-form-utils';

export async function createPostSubmitLetters(params: {
  incidentId: number;
  createdBanIds: number[] | Record<string, number> | undefined;
  extendedBanIds: number[] | Record<string, number> | undefined;
  patronBanIntents: Record<string, BanIntentData>;
  patronExtendIntents: Record<string, ExtendIntentData>;
  orgUnit: string | null;
  showError: (msg: string) => void;
}): Promise<void> {
  const { incidentId, createdBanIds, extendedBanIds, patronBanIntents, patronExtendIntents, orgUnit, showError } = params;
  const letterErrors: string[] = [];

  if (createdBanIds) {
    const enabledBans = Object.entries(patronBanIntents).filter(([, d]) => d.enabled);
    const isMap = !Array.isArray(createdBanIds);

    for (let i = 0; i < enabledBans.length; i++) {
      const [patronId, banData] = enabledBans[i]!;
      const banId = isMap
        ? (createdBanIds as Record<string, number>)[patronId]
        : (createdBanIds as number[])[i];
      if (!banId || !banData.ban_letter_content || !banData.ban_letter_template) continue;

      try {
        await bansApi.createBanLetter({
          ban_id: banId,
          content: banData.ban_letter_content,
          template: banData.ban_letter_template,
          generated_by_org: orgUnit || undefined,
          incident: incidentId,
          case_number: banData.case_number || undefined,
          law_enforcement_agency: banData.law_enforcement_agency || undefined,
        });
      } catch (err) {
        console.error(`Failed to create letter for ban ${banId}:`, err);
        letterErrors.push(`Ban letter for patron ${patronId}`);
      }
    }
  }

  if (extendedBanIds) {
    const enabledExtends = Object.entries(patronExtendIntents)
      .filter(([, d]) => d.enabled);

    for (const [, extData] of enabledExtends) {
      if (!extData.ban_letter_content || !extData.ban_letter_template) continue;
      try {
        await bansApi.createBanLetter({
          ban_id: extData.ban_id,
          content: extData.ban_letter_content,
          template: extData.ban_letter_template,
          generated_by_org: orgUnit || undefined,
          incident: incidentId,
        });
      } catch (err) {
        console.error(`Failed to create extend letter for ban ${extData.ban_id}:`, err);
        letterErrors.push(`Extension letter for ban ${extData.ban_id}`);
      }
    }
  }

  if (letterErrors.length > 0) {
    showError(`Some letters failed to generate: ${letterErrors.join(', ')}`);
  }
}

export type SubmitAction = 'save_draft' | 'save_and_ban' | 'submit_for_review';

export interface SubmitIncidentParams {
  action: SubmitAction;
  isEditMode: boolean;
  incidentId?: string;
  formData: IncidentFormState;
  selectedPatrons: PatronSearchResult[];
  selectedStaff: StaffSearchResult[];
  patronNotes: Record<string, string>;
  staffNotes: Record<string, string>;
  patronBanIntents: Record<string, BanIntentData>;
  patronExtendIntents: Record<string, ExtendIntentData>;
  uploadedFiles: FileUploadResponse[];
  externalLinks: ExternalLinkFormData[];
  user: { id?: number; display_name?: string; username?: string } | null;
  locationName: string | undefined;
  currentIncident?: Incident;
  createIncident: (data: any) => Promise<any>;
  updateIncident: (id: number, data: any, parties?: any) => Promise<any>;
  showError: (msg: string) => void;
}

export interface SubmitIncidentResult {
  incidentId: number;
  navigateTo: string;
  successMessage: string;
}

export async function submitIncident(params: SubmitIncidentParams): Promise<SubmitIncidentResult> {
  const {
    action, isEditMode, incidentId: idStr,
    formData, selectedPatrons, selectedStaff, patronNotes, staffNotes,
    patronBanIntents, patronExtendIntents, uploadedFiles, externalLinks,
    user, locationName,
    currentIncident, createIncident, updateIncident, showError,
  } = params;

  const { finalPatrons, originalIdMap } = await preparePatronsForSubmit(selectedPatrons);

  if (isEditMode && idStr) {
    if (!currentIncident) throw new Error('Failed to update incident: not loaded');
    const id = parseInt(idStr);
    const incidentData = buildIncidentUpdateData({ formData, user, locationName, uploadedFiles });
    const { add, remove } = calculateInvolvedPartiesChanges({
      currentIncident,
      finalPatrons,
      selectedStaff,
      patronNotes,
      staffNotes,
      originalIdMap,
    });
    const { add: addLinks, remove: removeLinks } = calculateExternalLinksChanges({
      currentIncident,
      externalLinks,
    });
    const { add: addAttachments, remove: removeAttachments } = calculateAttachmentChanges({
      currentIncident,
      uploadedFiles,
    });
    await updateIncident(id, incidentData, {
      add_involved_parties: add.length > 0 ? add : undefined,
      remove_involved_parties: remove.length > 0 ? remove : undefined,
      add_external_links: addLinks.length > 0 ? addLinks : undefined,
      remove_external_links: removeLinks.length > 0 ? removeLinks : undefined,
      add_attachment_file_upload_ids: addAttachments.length > 0 ? addAttachments : undefined,
      remove_attachment_ids: removeAttachments.length > 0 ? removeAttachments : undefined,
    });

    if (action === 'submit_for_review') {
      await incidentApi.createReview(id, 'submitted', 'Initial submission for review');
      return {
        incidentId: id,
        navigateTo: `/incidents/${id}`,
        successMessage: `Incident #${id} updated and submitted for review`,
      };
    }

    if (action === 'save_and_ban') {
      return {
        incidentId: id,
        navigateTo: `/incidents/${id}/create-ban`,
        successMessage: `Incident #${id} saved`,
      };
    }

    return {
      incidentId: id,
      navigateTo: `/incidents/${id}`,
      successMessage: `Incident #${id} updated successfully`,
    };
  }

  const involved_parties = buildInvolvedParties(finalPatrons, selectedStaff, patronNotes, staffNotes, originalIdMap);

  let metadata = formData.metadata || {};
  // Attachments no longer ride in metadata. The backend takes
  // already-uploaded file_upload ids at the top level and writes the
  // incidents.attachments join row only; the asset.file_upload row
  // was already created by odo-asset during the upload step.
  if (externalLinks.length > 0) {
    metadata = { ...metadata, external_links: externalLinks };
  }

  const attachment_file_upload_ids = uploadedFiles
    .map((f) => f.uuid)
    .filter((uuid) => !!uuid);

  const createData = buildCreateIncidentData({
    formData,
    involved_parties,
    originalIdMap,
    patronBanIntents,
    patronExtendIntents,
    metadata,
    attachment_file_upload_ids,
  });
  const result = await createIncident(createData);

  await createPostSubmitLetters({
    incidentId: result.id,
    createdBanIds: result.created_ban_ids,
    extendedBanIds: result.extended_ban_ids,
    patronBanIntents,
    patronExtendIntents,
    orgUnit: formData.org_unit,
    showError,
  });

  if (action === 'submit_for_review') {
    await incidentApi.createReview(result.id, 'submitted', 'Initial submission for review');
    return {
      incidentId: result.id,
      navigateTo: `/incidents/${result.id}`,
      successMessage: 'Incident created and submitted for review',
    };
  }

  return {
    incidentId: result.id,
    navigateTo: `/incidents/${result.id}`,
    successMessage: 'Incident created successfully',
  };
}
