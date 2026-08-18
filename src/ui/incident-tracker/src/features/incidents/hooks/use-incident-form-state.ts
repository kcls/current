import { useState, useEffect, useMemo, useCallback } from 'react';
import debounce from 'lodash/debounce';
import { useAuth } from '../../../contexts/auth-context';
import { useLocations } from '../../../contexts/location-context';
import { useTemplates } from '../../../contexts/templates-context';
import { patronApi } from '../../../api/patrons';
import { staffApi } from '../../../api/staff';
import { reviewChainApi } from '../../../api/review-chain';
import type { StaffSearchResult } from '../../../api/staff';
import type { Incident, PatronSearchResult, PatronBanStatus } from '../../../types';
import type { ExternalLinkFormData } from '../components/external-link-dialog';
import type { BanIntentData } from '../components/ban-options-panel';
import type { ExtendIntentData } from '../components/incident-form-step-ban-actions';
import type {
  IncidentFormState,
  PatronProps,
  StaffProps,
  AttachmentProps,
} from '../components/incident-form-step-report';
import { useScrollToError } from '../../../shared/hooks';
import { getLibraryToday, getLibraryNowTime, localDateTimeToUtc } from '../../../shared/utils/date-utils';
import { letterNeedsViolationSelection } from '../../../shared/utils/ban-letter-templates';
import { authApi } from '@core';
import type { FileUploadResponse } from '@core/api/upload';
import type { PatronDetails } from '../../../types/patron';

interface UseIncidentFormStateOptions {
  isEditMode: boolean;
  templateId: string | null;
  fileUpload: {
    uploadedFiles: FileUploadResponse[];
    uploadProgress: Record<string, number>;
    isUploadingFiles: boolean;
    handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    removeAttachment: (index: number) => void;
    maxFiles: number;
  };
}

function computeBanStepErrors(
  banIntents: Record<string, BanIntentData>,
  extendIntents: Record<string, ExtendIntentData>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [patronId, data] of Object.entries(banIntents).filter(([, d]) => d.enabled)) {
    if (!data.starts_at) errors[`ban_starts_${patronId}`] = 'Start date is required';
    if (!data.lifts_at) {
      errors[`ban_lifts_${patronId}`] = 'Lift date is required';
    } else if (data.starts_at && new Date(data.lifts_at) < new Date(data.starts_at)) {
      errors[`ban_lifts_${patronId}`] = 'Lift date cannot be before start date';
    }
    if (!data.ban_letter_template) {
      errors[`ban_letter_${patronId}`] = 'Letter template is required';
    } else if (letterNeedsViolationSelection(data.ban_letter_content)) {
      errors[`ban_letter_violations_${patronId}`] =
        'Please select at least one violation to issue letter';
    }
  }

  for (const [patronId, data] of Object.entries(extendIntents).filter(([, d]) => d.enabled)) {
    if (!data.new_lifts_at) errors[`extend_lifts_${patronId}`] = 'New lift date is required';
    if (!data.ban_letter_template) {
      errors[`extend_letter_${patronId}`] = 'Letter template is required';
    } else if (letterNeedsViolationSelection(data.ban_letter_content)) {
      errors[`extend_letter_violations_${patronId}`] =
        'Please select at least one violation to issue letter';
    }
  }

  return errors;
}

export function useIncidentFormState(options: UseIncidentFormStateOptions) {
  const { isEditMode, templateId, fileUpload } = options;
  const { user } = useAuth();
  const { templates } = useTemplates();
  const { locations, subLocations, isLoadingSubLocations, fetchSubLocationsByOrgUnit } = useLocations();
  const sessionOrgUnit = authApi.getOrgUnit();

  const [formData, setFormData] = useState<IncidentFormState>({
    title: '',
    description: '',
    template_ids: templateId ? [parseInt(templateId)] : [],
    org_unit: sessionOrgUnit || null,
    sub_location: null,
    involved_parties: [],
    other_staff_involved: [],
    metadata: {},
    requires_follow_up: false,
    incident_date: getLibraryToday(),
    incident_time: getLibraryNowTime(),
    called_emergency: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Step 2 (ban actions) errors, kept separate from the Step 1 `errors` map
  const [banStepErrors, setBanStepErrors] = useState<Record<string, string>>({});
  const [reviewChain, setReviewChain] = useState<import('../../../types').ReviewChainEntry[]>([]);
  const [hasReviewChain, setHasReviewChain] = useState<boolean | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffSearchResult[]>([]);
  const [selectedPatrons, setSelectedPatrons] = useState<PatronSearchResult[]>([]);
  const [patronSearchResults, setPatronSearchResults] = useState<PatronSearchResult[]>([]);
  const [isSearchingPatrons, setIsSearchingPatrons] = useState(false);
  const [patronSearch, setPatronSearch] = useState('');
  const [staffNotes, setStaffNotes] = useState<Record<string, string>>({});
  const [patronNotes, setPatronNotes] = useState<Record<string, string>>({});
  const [patronBanIntents, setPatronBanIntents] = useState<Record<string, BanIntentData>>({});
  const [patronExtendIntents, setPatronExtendIntents] = useState<Record<string, ExtendIntentData>>({});
  const [patronBanAtLocation, setPatronBanAtLocation] = useState<Record<string, PatronBanStatus>>({});
  const [externalLinks, setExternalLinks] = useState<ExternalLinkFormData[]>([]);
  const [patronDetailsMap, setPatronDetailsMap] = useState<Record<string, PatronDetails | null>>({});

  useScrollToError(errors);
  useScrollToError(banStepErrors);

  const hasPatrons = selectedPatrons.length > 0;

  const locationName = useMemo(
    () => locations.find((l) => l.uuid === formData.org_unit)?.label,
    [locations, formData.org_unit],
  );

  const shouldShowCalledEmergency = useMemo(() => {
    return formData.template_ids.some((tid) => {
      const template = templates.find((t) => t.id === tid);
      return template?.show_called_emergency === true;
    });
  }, [formData.template_ids, templates]);

  const availableLocationOptions = useMemo(() => {
    const filteredLocations = locations
      .filter((loc) => {
        if (loc.is_active === false) return false;
        return loc.unit_type_object?.can_have_patrons !== false;
      })
      .sort((a, b) => (a.display_label || a.label).localeCompare(b.display_label || b.label));

    if (isEditMode && formData.org_unit) {
      const currentLocation = locations.find((loc) => loc.uuid === formData.org_unit);
      if (currentLocation && !filteredLocations.find((loc) => loc.id === currentLocation.id)) {
        return [currentLocation, ...filteredLocations];
      }
    }

    return filteredLocations;
  }, [locations, isEditMode, formData.org_unit]);

  const tempIncident = useMemo((): Incident => {
    const occurredAt = localDateTimeToUtc(
      formData.incident_date || getLibraryToday(),
      formData.incident_time || '00:00',
    );
    return {
      id: 0,
      title: formData.title,
      description: formData.description || '',
      org_unit: formData.org_unit,
      org_unit_name: locationName || '',
      created_at: occurredAt,
      occurred_at: occurredAt,
    } as Incident;
  }, [formData.title, formData.description, formData.org_unit, formData.incident_date, formData.incident_time, locationName]);

  useEffect(() => {
    if (!isEditMode && locations.length > 0 && formData.org_unit) {
      const currentLocation = locations.find((loc) => loc.uuid === formData.org_unit);
      if (
        currentLocation &&
        (currentLocation.is_active === false ||
          currentLocation.unit_type_object?.can_have_patrons === false)
      ) {
        setFormData((prev) => ({ ...prev, org_unit: null }));
        setErrors((prev) => ({
          ...prev,
          org_unit: `Your default location "${currentLocation.display_label || currentLocation.label}" cannot be used for incidents. Please select a valid location.`,
        }));
      } else if (currentLocation) {
        setErrors((prev) => {
          if (!prev.org_unit) return prev;
          const { org_unit: _, ...rest } = prev;
          return rest;
        });
      }
    }
  }, [locations, isEditMode, formData.org_unit]);

  useEffect(() => {
    if (formData.org_unit) {
      fetchSubLocationsByOrgUnit(formData.org_unit);
    }
  }, [formData.org_unit, fetchSubLocationsByOrgUnit]);

  useEffect(() => {
    const fetchReviewChain = async () => {
      if (formData.org_unit) {
        try {
          const chain = await reviewChainApi.list(formData.org_unit);
          setReviewChain(chain);
          setHasReviewChain(chain.length > 0);
        } catch (err) {
          console.error('Failed to fetch review chain:', err);
          setReviewChain([]);
          setHasReviewChain(false);
        }
      } else {
        setReviewChain([]);
        setHasReviewChain(null);
      }
    };
    fetchReviewChain();
  }, [formData.org_unit]);

  useEffect(() => {
    if (!formData.org_unit || selectedPatrons.length === 0) {
      setPatronBanAtLocation({});
      setPatronExtendIntents({});
      return;
    }

    setPatronBanAtLocation({});
    setPatronExtendIntents({});

    let cancelled = false;
    const checkBans = async () => {
      const results: Record<string, PatronBanStatus> = {};
      await Promise.all(
        selectedPatrons.map(async (patron) => {
          const numericId = Number(patron.id);
          if (patron.is_new_unsaved || isNaN(numericId)) return;
          try {
            const bans = await patronApi.getPatronBans({
              patronId: patron.id,
              orgUnit: formData.org_unit!,
            });
            const now = new Date();
            let hasBan = false;
            let hasTrespass = false;
            let banId: number | undefined;
            let trespassId: number | undefined;
            let trespassOrgUnitName: string | undefined;
            let banLiftsAt: string | undefined;
            let trespassLiftsAt: string | undefined;
            for (const b of bans) {
              if (b.deleted_at) continue;
              const liftsAt = b.lifts_at ? new Date(b.lifts_at) : null;
              if (!liftsAt || liftsAt > now) {
                if (b.is_trespass) {
                  hasTrespass = true;
                  trespassId = b.id;
                  trespassOrgUnitName = b.org_unit_name || undefined;
                  trespassLiftsAt = b.lifts_at || undefined;
                } else if (b.org_unit === formData.org_unit) {
                  hasBan = true;
                  banId = b.id;
                  banLiftsAt = b.lifts_at || undefined;
                }
              }
            }
            if (hasBan || hasTrespass) {
              results[patron.id] = {
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
            console.error(`Failed to check bans for patron ${patron.id}:`, err);
          }
        }),
      );
      if (!cancelled) {
        setPatronBanAtLocation(results);
        setPatronBanIntents((prev) => {
          const next = { ...prev };
          for (const [pid, status] of Object.entries(results)) {
            if (status.hasTrespass && next[pid]?.enabled) {
              next[pid] = { ...next[pid]!, enabled: false };
            }
          }
          return next;
        });
      }
    };
    checkBans();
    return () => { cancelled = true; };
  }, [selectedPatrons, formData.org_unit]);

  useEffect(() => {
    setErrors((prev) => {
      const toRemove = [
        ...Object.entries(patronBanIntents)
          .filter(([, data]) => data.enabled && data.ban_letter_template)
          .map(([pid]) => `ban_letter_${pid}`),
        ...Object.entries(patronExtendIntents)
          .filter(([, data]) => data.enabled && data.ban_letter_template)
          .map(([pid]) => `extend_letter_${pid}`),
      ];
      if (!toRemove.some((k) => k in prev)) return prev;
      const next = { ...prev };
      toRemove.forEach((k) => delete next[k]);
      return next;
    });
  }, [patronBanIntents, patronExtendIntents]);

  const clearError = useCallback((field: string) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  }, []);

  const handleInputChange = useCallback((field: keyof IncidentFormState, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    clearError(field);
  }, [clearError]);

  const searchPatrons = useMemo(
    () =>
      debounce(async (searchTerm: string) => {
        if (!searchTerm || searchTerm.length < 2) {
          setPatronSearchResults([]);
          return;
        }
        setIsSearchingPatrons(true);
        try {
          const response = await patronApi.search({ query: searchTerm, limit: 10 });
          setPatronSearchResults(response.items);
        } catch (error) {
          console.error('Error searching for patrons:', error);
          setPatronSearchResults([]);
        } finally {
          setIsSearchingPatrons(false);
        }
      }, 300),
    [],
  );

  const clearBanIntents = useCallback((patronId: string) => {
    setPatronBanIntents((prev) => {
      const { [patronId]: _, ...rest } = prev;
      return rest;
    });
    setPatronExtendIntents((prev) => {
      const { [patronId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const validateStepReport = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.template_ids || formData.template_ids.length === 0) {
      newErrors.template_ids = 'Please select at least one incident template';
    }
    if (!formData.description) newErrors.description = 'Incident Narrative is required';
    if (!formData.org_unit) newErrors.org_unit = 'Location is required';

    const templatesRequiringPatron = formData.template_ids
      .map((tid) => templates.find((t) => t.id === tid))
      .filter((t) => t?.requires_patron === true);

    if (templatesRequiringPatron.length > 0 && selectedPatrons.length === 0) {
      const templateNames = templatesRequiringPatron.map((t) => t?.name).join(', ');
      newErrors.patron_id = `The selected template(s) "${templateNames}" require patron information. Please add at least one patron.`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, templates, selectedPatrons]);

  // Clear step-2 errors as soon as edits resolve them; new errors only surface on Next
  useEffect(() => {
    const current = computeBanStepErrors(patronBanIntents, patronExtendIntents);

    setBanStepErrors((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const key of Object.keys(prev)) {
        if (current[key]) next[key] = prev[key]!;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [patronBanIntents, patronExtendIntents]);

  const validateStepBanActions = useCallback((): boolean => {
    const newErrors = computeBanStepErrors(patronBanIntents, patronExtendIntents);
    setBanStepErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [patronBanIntents, patronExtendIntents]);

  const validateForm = useCallback((): boolean => {
    return validateStepReport();
  }, [validateStepReport]);

  const patronProps: PatronProps = {
    selected: selectedPatrons,
    setSelected: setSelectedPatrons,
    searchResults: patronSearchResults,
    isSearching: isSearchingPatrons,
    searchTerm: patronSearch,
    setSearchTerm: setPatronSearch,
    search: searchPatrons,
    notes: patronNotes,
    setNotes: setPatronNotes,
    banStatus: patronBanAtLocation,
    clearBanIntents,
  };

  const staffProps: StaffProps = {
    selected: selectedStaff,
    setSelected: setSelectedStaff,
    notes: staffNotes,
    setNotes: setStaffNotes,
    onSearch: async (query: string) => {
      const results = await staffApi.searchByName(query, 10);
      return results.map((r) => ({
        id: r.id,
        uuid: r.uuid,
        display_name: r.display_name,
        email: r.email,
        role: r.role,
      }));
    },
  };

  const attachmentProps: AttachmentProps = {
    files: fileUpload.uploadedFiles,
    isUploading: fileUpload.isUploadingFiles,
    progress: fileUpload.uploadProgress,
    maxFiles: fileUpload.maxFiles,
    onUpload: fileUpload.handleFileUpload,
    onRemove: fileUpload.removeAttachment,
  };

  return {
    formData, setFormData,
    errors, setErrors,
    banStepErrors,
    reviewChain, hasReviewChain,
    selectedStaff, setSelectedStaff,
    selectedPatrons, setSelectedPatrons,
    patronNotes, setPatronNotes,
    staffNotes, setStaffNotes,
    patronBanIntents, setPatronBanIntents,
    patronExtendIntents, setPatronExtendIntents,
    patronBanAtLocation,
    externalLinks, setExternalLinks,
    patronDetailsMap, setPatronDetailsMap,
    handleInputChange, clearError, clearBanIntents,
    patronSearchResults, isSearchingPatrons,
    patronSearch, setPatronSearch, searchPatrons,
    hasPatrons, locationName, shouldShowCalledEmergency,
    availableLocationOptions, tempIncident,
    validateStepReport, validateStepBanActions, validateForm,
    patronProps, staffProps, attachmentProps,
    user, templates, locations, subLocations, isLoadingSubLocations,
  };
}
