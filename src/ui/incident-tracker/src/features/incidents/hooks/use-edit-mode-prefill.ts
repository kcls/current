import { useEffect } from 'react';
import { patronApi } from '../../../api/patrons';
import { staffApi } from '../../../api/staff';
import type { Incident, PatronSearchResult } from '../../../types';
import type { StaffSearchResult } from '../../../api/staff';
import type { IncidentFormState } from '../components/incident-form-step-report';
import type { FileUploadResponse } from '@core/api/upload';
import type { ExternalLinkFormData } from '../components/external-link-dialog';
import { utcToLocalDateTime } from '../../../shared/utils/date-utils';

interface UseEditModePrefillOptions {
  isEditMode: boolean;
  currentIncident: Incident | null | undefined;
  setFormData: React.Dispatch<React.SetStateAction<IncidentFormState>>;
  setSelectedPatrons: React.Dispatch<React.SetStateAction<PatronSearchResult[]>>;
  setSelectedStaff: React.Dispatch<React.SetStateAction<StaffSearchResult[]>>;
  setPatronNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setStaffNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setUploadedFiles: React.Dispatch<React.SetStateAction<FileUploadResponse[]>>;
  setExternalLinks: React.Dispatch<React.SetStateAction<ExternalLinkFormData[]>>;
}

export function useEditModePrefill(options: UseEditModePrefillOptions): void {
  const {
    isEditMode,
    currentIncident,
    setFormData,
    setSelectedPatrons,
    setSelectedStaff,
    setPatronNotes,
    setStaffNotes,
    setUploadedFiles,
    setExternalLinks,
  } = options;

  useEffect(() => {
    if (!isEditMode || !currentIncident) return;

    const occurred = utcToLocalDateTime(currentIncident.occurred_at);
    setFormData({
      title: currentIncident.title || '',
      description: currentIncident.description || '',
      template_ids: currentIncident.template_ids || [],
      org_unit: currentIncident.org_unit || null,
      sub_location:
        typeof currentIncident.sub_location === 'number' ? currentIncident.sub_location : null,
      involved_parties:
        currentIncident.involved_parties?.map(
          (p) => p.non_patron_name || (p.patron_id ? String(p.patron_id) : ''),
        ) || [],
      other_staff_involved: [],
      metadata: currentIncident.metadata || {},
      requires_follow_up: currentIncident.requires_follow_up || false,
      follow_up_date: currentIncident.follow_up_date,
      notes: currentIncident.notes,
      incident_date: occurred.date,
      incident_time: occurred.time,
      called_emergency: currentIncident.called_emergency || false,
    });

    const allPatronParties =
      currentIncident.involved_parties?.filter(
        (p) => p.party_type === 'patron' && p.patron_id,
      ) || [];

    if (allPatronParties.length > 0) {
      const notes: Record<string, string> = {};
      allPatronParties.forEach((party) => {
        if (party.patron_id && party.notes) {
          notes[String(party.patron_id)] = party.notes;
        }
      });
      setPatronNotes(notes);

      Promise.all(
        allPatronParties.map(async (party) => {
          try {
            const patron = await patronApi.get(String(party.patron_id));
            return {
              id: String(patron.id),
              display_name: patron.display_name,
              barcode: patron.barcode,
              library_card: patron.library_card_number,
              status: patron.status,
              is_banned: patron.status === 'banned',
              incident_count: patron.incidents?.length || 0,
              last_incident: patron.incidents?.[0]?.date,
              is_unknown: patron.is_unknown,
            } as PatronSearchResult;
          } catch (error) {
            console.error(`Error loading patron ${party.patron_id}:`, error);
            return null;
          }
        }),
      ).then((patrons) => {
        const validPatrons = patrons.filter((p) => p !== null) as PatronSearchResult[];
        setSelectedPatrons(validPatrons);
      });
    }

    const staffParties =
      currentIncident.involved_parties?.filter(
        (p) => p.party_type === 'staff' && p.staff_id,
      ) || [];

    if (staffParties.length > 0) {
      const notes: Record<string, string> = {};
      staffParties.forEach((party) => {
        if (party.staff_id && party.notes) {
          notes[party.staff_id] = party.notes;
        }
      });
      setStaffNotes(notes);

      Promise.all(
        staffParties.map(async (party) => {
          try {
            const staff = await staffApi.getById(party.staff_id!);
            return {
              id: staff.id,
              uuid: staff.uuid || party.staff_id!,
              display_name: staff.display_name || '',
              email: staff.email,
              username: staff.username,
            };
          } catch (error) {
            console.error(`Error loading staff ${party.staff_id}:`, error);
            return null;
          }
        }),
      ).then((staffMembers) => {
        const validStaff = staffMembers.filter((s) => s !== null) as any[];
        setSelectedStaff(validStaff);
      });
    }

    // Attachments are now a top-level field on `Incident`, populated
    // by `incident/get` when `with_attachments` is true. Map each to
    // the form's FileUploadResponse shape so the existing render /
    // delete flow keeps working unchanged — only the path field is
    // synthesized (storage_path isn't returned to clients).
    if (currentIncident.attachments && currentIncident.attachments.length > 0) {
      setUploadedFiles(
        currentIncident.attachments.map((a) => ({
          id: a.id,
          uuid: a.id,
          filename: a.original_name,
          original_name: a.original_name,
          path: '',
          relative_path: a.relative_path,
          size: a.size ?? 0,
          mime_type: a.mime_type ?? '',
          uploaded_by: 0,
          uploaded_at: '',
          category: a.category,
        })),
      );
    }

    if (currentIncident.external_links && currentIncident.external_links.length > 0) {
      setExternalLinks(
        currentIncident.external_links.map((link) => ({
          id: link.id,
          url: link.url,
          title: link.title,
          description: link.description || '',
        }))
      );
    }
  }, [isEditMode, currentIncident]); // eslint-disable-line react-hooks/exhaustive-deps
}
