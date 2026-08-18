import type { Incident, InvolvedPartyData, PatronBanStatus } from '../../../types';
import type { PatronSearchResult } from '../../../types';
import type { StaffSearchResult } from '../../../api/staff';
import type { FileUploadResponse } from '@core/api/upload';
import type { BanIntentData } from '../components/ban-options-panel';
import type { ExtendIntentData } from '../components/incident-form-step-ban-actions';
import type { IncidentFormState } from '../components/incident-form-step-report';
import type { ExternalLinkFormData } from '../components/external-link-dialog';
import { patronApi } from '../../../api/patrons';
import { localDateTimeToUtc, getLibraryToday, getLibraryNowTime } from '../../../shared/utils/date-utils';

function buildOccurredAt(formData: IncidentFormState): string {
  const date = formData.incident_date || getLibraryToday();
  const time = formData.incident_time || getLibraryNowTime();
  return localDateTimeToUtc(date, time);
}

export async function createPatronFromSearchResult(
  patron: PatronSearchResult,
): Promise<PatronSearchResult> {
  const newPatron = await patronApi.create({
    first_name: patron.first_name || '',
    last_name: patron.last_name || '',
    status: 'active',
  } as any);
  return { id: String(newPatron.id), status: 'active' };
}

export async function createUnknownPatronRecord(): Promise<PatronSearchResult> {
  const newPatron = await patronApi.create({
    first_name: '',
    last_name: '',
    status: 'active',
    is_unknown: true,
  } as any);
  return {
    id: String(newPatron.id),
    display_name: newPatron.display_name,
    status: 'active',
    is_banned: false,
    incident_count: 0,
    is_unknown: true,
  };
}

export async function preparePatronsForSubmit(
  selectedPatrons: PatronSearchResult[],
): Promise<{ finalPatrons: PatronSearchResult[]; originalIdMap: Record<string, string> }> {
  const finalPatrons = [...selectedPatrons];
  const originalIdMap: Record<string, string> = {};

  for (let i = 0; i < finalPatrons.length; i++) {
    const patron = finalPatrons[i]!;
    const oldId = patron.id;
    if (patron.is_new_unsaved) {
      if (patron.is_unknown) {
        finalPatrons[i] = await createUnknownPatronRecord();
      } else {
        finalPatrons[i] = await createPatronFromSearchResult(patron);
      }
      originalIdMap[finalPatrons[i]!.id] = oldId;
    } else {
      originalIdMap[oldId] = oldId;
    }
  }
  return { finalPatrons, originalIdMap };
}

export function buildInvolvedParties(
  finalPatrons: PatronSearchResult[],
  selectedStaff: StaffSearchResult[],
  patronNotes: Record<string, string>,
  staffNotes: Record<string, string>,
  originalIdMap: Record<string, string> = {},
): InvolvedPartyData[] {
  const involved_parties: InvolvedPartyData[] = [];

  for (const patron of finalPatrons) {
    const originalId = originalIdMap[patron.id] || patron.id;
    involved_parties.push({
      party_type: 'patron',
      patron_id: parseInt(patron.id),
      role: 'involved',
      notes: patronNotes[originalId] || undefined,
      is_unknown_patron: patron.is_unknown === true,
    });
  }

  for (const staff of selectedStaff) {
    involved_parties.push({
      party_type: 'staff',
      staff_id: staff.uuid,
      role: 'witness',
      notes: staffNotes[staff.uuid] || undefined,
    });
  }

  return involved_parties;
}

export function buildPendingBans(
  patronBanIntents: Record<string, BanIntentData>,
  originalIdMap: Record<string, string>,
) {
  const tempToReal: Record<string, string> = {};
  for (const [newId, oldId] of Object.entries(originalIdMap)) {
    tempToReal[oldId] = newId;
  }

  return Object.entries(patronBanIntents)
    .filter(([, data]) => data.enabled)
    .map(([patronId, data]) => {
      const resolvedId = tempToReal[patronId] || patronId;
      const ref = parseInt(resolvedId, 10);
      return {
        patron_ref: ref,
        ban_type: data.ban_type,
        starts_at: data.starts_at,
        lifts_at: data.lifts_at,
        comments: data.comments || undefined,
        case_number: data.case_number || undefined,
        law_enforcement_agency: data.law_enforcement_agency || undefined,
      };
    })
    .filter((ban) => !isNaN(ban.patron_ref));
}

export function buildPendingExtends(
  patronExtendIntents: Record<string, ExtendIntentData>,
) {
  return Object.values(patronExtendIntents)
    .filter((data) => data.enabled && data.new_lifts_at)
    .map((data) => ({
      ban_id: data.ban_id,
      lifts_at: data.new_lifts_at,
      comments: data.comments || undefined,
      case_number: data.case_number || undefined,
      law_enforcement_agency: data.law_enforcement_agency || undefined,
    }));
}

export function buildCreateIncidentData(params: {
  formData: IncidentFormState;
  involved_parties: InvolvedPartyData[];
  originalIdMap: Record<string, string>;
  patronBanIntents: Record<string, BanIntentData>;
  patronExtendIntents: Record<string, ExtendIntentData>;
  metadata?: Record<string, any>;
  /**
   * File-upload uuids (from `uploadService.uploadFile`) to bind to
   * this incident as attachments. Empty / omitted = no attachments.
   * Replaces the legacy `metadata.attachments` payload.
   */
  attachment_file_upload_ids?: string[];
}) {
  const {
    formData,
    involved_parties,
    originalIdMap,
    patronBanIntents,
    patronExtendIntents,
    metadata,
    attachment_file_upload_ids,
  } = params;
  const baseMeta = metadata || formData.metadata || {};
  const pendingBans = buildPendingBans(patronBanIntents, originalIdMap);
  const pendingExtends = buildPendingExtends(patronExtendIntents);
  let finalMeta = pendingBans.length > 0 ? { ...baseMeta, pending_bans: pendingBans } : baseMeta;
  if (pendingExtends.length > 0) {
    finalMeta = { ...finalMeta, pending_extends: pendingExtends };
  }

  return {
    template_ids: formData.template_ids,
    org_unit: formData.org_unit || null,
    sub_location: formData.sub_location,
    title: formData.title,
    description: formData.description,
    requires_follow_up: formData.requires_follow_up,
    called_emergency: formData.called_emergency,
    occurred_at: buildOccurredAt(formData),
    metadata: finalMeta,
    is_emergency: false,
    involved_parties,
    attachment_file_upload_ids,
  };
}

export function buildIncidentUpdateData(params: {
  formData: IncidentFormState;
  user: { id?: number; display_name?: string; username?: string } | null;
  locationName: string | undefined;
  uploadedFiles: FileUploadResponse[];
}): Partial<Incident> {
  const { formData, user, locationName, uploadedFiles } = params;
  const incidentData: Partial<Incident> = {
    title: formData.title,
    description: formData.description,
    org_unit: formData.org_unit || undefined,
    sub_location: formData.sub_location ? String(formData.sub_location) : undefined,
    metadata: formData.metadata,
    created_by_name: user?.display_name || user?.username,
    org_unit_name: locationName,
    requires_follow_up: formData.requires_follow_up,
    follow_up_date: formData.follow_up_date,
    notes: formData.notes,
    called_emergency: formData.called_emergency,
    occurred_at: buildOccurredAt(formData),
    template_ids: formData.template_ids ?? [],
  };

  // Attachment binding on update is handled by the caller
  // (incident-submit.ts) via calculateAttachmentChanges →
  // updateIncident's add_attachment_file_upload_ids/remove_attachment_ids
  // options, not in this scalar payload. uploadedFiles isn't consumed
  // here.
  void uploadedFiles;

  return incidentData;
}

export function calculateInvolvedPartiesChanges(params: {
  currentIncident: Incident;
  finalPatrons: PatronSearchResult[];
  selectedStaff: StaffSearchResult[];
  patronNotes: Record<string, string>;
  staffNotes: Record<string, string>;
  originalIdMap?: Record<string, string>;
}): { add: InvolvedPartyData[]; remove: number[] } {
  const { currentIncident, finalPatrons, selectedStaff, patronNotes, staffNotes, originalIdMap = {} } = params;
  const add_involved_parties: InvolvedPartyData[] = [];
  const remove_involved_parties: number[] = [];

  const currentPatronParties =
    currentIncident.involved_parties?.filter(
      (p: any) => p.party_type === 'patron' && p.patron_id,
    ) || [];
  const currentPatronMap = new Map(
    currentPatronParties.map((p: any) => [String(p.patron_id), p]),
  );
  const newPatronIds = new Set(finalPatrons.map((p) => p.id));

  currentPatronParties.forEach((party: any) => {
    if (!newPatronIds.has(String(party.patron_id)) && party.id != null) {
      remove_involved_parties.push(party.id);
    }
  });

  finalPatrons.forEach((patron) => {
    const isUnknown = patron.is_unknown === true;
    const patronIdStr = patron.id;
    const originalId = originalIdMap[patron.id] || patron.id;
    const existingParty = currentPatronMap.get(patronIdStr);

    if (!existingParty) {
      add_involved_parties.push({
        party_type: 'patron',
        patron_id: parseInt(patronIdStr),
        role: 'involved',
        notes: patronNotes[originalId] || undefined,
        is_unknown_patron: isUnknown,
      });
    } else {
      const newNotes = patronNotes[originalId] || '';
      const oldNotes = existingParty.notes || '';
      if (newNotes !== oldNotes) {
        if (existingParty.id != null) {
          remove_involved_parties.push(existingParty.id);
        }
        add_involved_parties.push({
          party_type: 'patron',
          patron_id: parseInt(patron.id),
          role: 'involved',
          notes: newNotes || undefined,
          is_unknown_patron: isUnknown,
        });
      }
    }
  });

  const currentStaff =
    currentIncident.involved_parties?.filter(
      (p: any) => p.party_type === 'staff' && p.staff_id,
    ) || [];
  const currentStaffIds = new Set(currentStaff.map((p: any) => String(p.staff_id)));
  const newStaffIds = new Set(selectedStaff.map((s) => s.uuid));

  currentStaff.forEach((party: any) => {
    if (!newStaffIds.has(String(party.staff_id)) && party.id != null) {
      remove_involved_parties.push(party.id);
    }
  });

  selectedStaff.forEach((staff) => {
    if (!currentStaffIds.has(staff.uuid)) {
      add_involved_parties.push({
        party_type: 'staff',
        staff_id: staff.uuid,
        role: 'witness',
        notes: staffNotes[staff.uuid] || undefined,
      });
    } else {
      const existingParty = currentStaff.find((p: any) => String(p.staff_id) === staff.uuid);
      if (existingParty?.id) {
        const newNotes = staffNotes[staff.uuid] || '';
        const oldNotes = existingParty.notes || '';
        if (newNotes !== oldNotes) {
          remove_involved_parties.push(existingParty.id);
          add_involved_parties.push({
            party_type: 'staff',
            staff_id: staff.uuid,
            role: 'witness',
            notes: newNotes || undefined,
          });
        }
      }
    }
  });

  return { add: add_involved_parties, remove: remove_involved_parties };
}

/**
 * Diff the form's attachment list against the incident's saved attachments,
 * for the edit/update flow.
 *
 * Everything is in one id-space: `incident/get` returns each attachment's
 * `id` as its `asset.file_upload` uuid, and prefill seeds the form's
 * `uploadedFiles[].uuid` from that same value, while files uploaded this
 * session carry the file_upload uuid from odo-asset's upload response. So a
 * plain set diff over file_upload uuids gives the add/remove lists, both of
 * which the update endpoint keys on file_upload uuid.
 */
export function calculateAttachmentChanges(params: {
  currentIncident: Incident;
  uploadedFiles: FileUploadResponse[];
}): { add: string[]; remove: string[] } {
  const { currentIncident, uploadedFiles } = params;
  const savedIds = new Set(
    (currentIncident.attachments || []).map((a) => a.id),
  );
  const retainedIds = new Set(
    uploadedFiles.map((f) => f.uuid).filter((uuid) => !!uuid),
  );

  // Removed: saved file no longer present in the form.
  const remove = [...savedIds].filter((id) => !retainedIds.has(id));
  // Added: form file not among the saved set (uploaded this session).
  const add = [...retainedIds].filter((id) => !savedIds.has(id));

  return { add, remove };
}

export function calculateExternalLinksChanges(params: {
  currentIncident: Incident;
  externalLinks: ExternalLinkFormData[];
}): { add: ExternalLinkFormData[]; remove: number[] } {
  const { currentIncident, externalLinks } = params;
  const currentLinks = currentIncident.external_links || [];
  const currentMap = new Map(
    currentLinks.filter((l) => l.id != null).map((l) => [l.id!, l]),
  );

  const add: ExternalLinkFormData[] = [];
  const remove: number[] = [];

  const retainedIds = new Set(
    externalLinks.filter((l) => l.id != null).map((l) => l.id!),
  );

  // Removed: in current but no longer in form
  for (const link of currentLinks) {
    if (link.id != null && !retainedIds.has(link.id)) {
      remove.push(link.id);
    }
  }

  for (const link of externalLinks) {
    if (link.id == null) {
      // New link
      add.push({ url: link.url, title: link.title, description: link.description });
    } else {
      // Existing — check for edits
      const existing = currentMap.get(link.id);
      if (existing) {
        const changed =
          link.url !== existing.url ||
          link.title !== existing.title ||
          (link.description || '') !== (existing.description || '');

        if (changed) {
          remove.push(link.id);
          add.push({ url: link.url, title: link.title, description: link.description });
        }
      }
    }
  }

  return { add, remove };
}
