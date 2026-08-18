import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { parseISO, addDays, differenceInCalendarDays, isValid } from 'date-fns';
import {
  processBanLetterTemplate,
  buildTemplateVars,
  letterNeedsViolationSelection,
} from '../../../shared/utils/ban-letter-templates';
import {
  formatLocalDate,
  parseTimestamp,
  PRESET_DAYS,
  getDefaultBanDates,
  utcToLocalDate,
} from '../../../shared/utils/date-utils';
import {
  DEFAULT_BAN_LIFT_DAYS,
  DEFAULT_TRESPASS_LIFT_DAYS,
  DEFAULT_BAN_ARCHIVE_DAYS,
} from '../../../constants';
import { type LetterIframeEditorRef } from '../../../shared/components/letter-iframe-editor';
import { useScrollToError } from '../../../shared/hooks';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { Incident, PatronBanStatus } from '../../../types';
import type { PatronDetails } from '../../../types/patron';

export type { PatronBanStatus };

export interface AvailablePatron {
  id: string;
  display_name: string;
}

export interface PerPatronFormData {
  is_trespass: boolean;
  case_number: string;
  law_enforcement_agency: string;
  starts_at: string;
  lifts_at: string;
  archives_at: string;
  comments: string;
  ban_letter_template: number | null;
  ban_letter_content: string;
}

export interface SharedFormData {
  incident: number | null;
  org_unit: string | null;
}

interface UseBanFormOptions {
  templates: BanLetterTemplate[];
  incident: Incident | null;
  patronDetailsMap: Record<string, PatronDetails>;
  preferInPlaceUpdate?: boolean;
  onTypeChangeRequested?: (isTrespass: boolean) => Promise<boolean> | boolean;
}

function parseIsoDateOrNull(value?: string): Date | null {
  if (!value) return null;
  const date = parseISO(value);
  return isValid(date) ? date : null;
}

export function getDefaultPerPatronData(occurredAtUtc?: string): PerPatronFormData {
  const startDateYmd = occurredAtUtc ? utcToLocalDate(occurredAtUtc) : undefined;
  const dates = getDefaultBanDates(undefined, undefined, startDateYmd);
  return {
    is_trespass: false,
    case_number: '',
    law_enforcement_agency: '',
    starts_at: dates.startsAt,
    lifts_at: dates.liftsAt,
    archives_at: dates.archivesAt,
    comments: '',
    ban_letter_template: null,
    ban_letter_content: '',
  };
}

export function useBanForm(options: UseBanFormOptions) {
  const { templates, incident, patronDetailsMap, preferInPlaceUpdate, onTypeChangeRequested } = options;

  const [formDataPerPatron, setFormDataPerPatron] = useState<Record<string, PerPatronFormData>>({});
  const [errorsPerPatron, setErrorsPerPatron] = useState<Record<string, Record<string, string>>>({});
  const [currentPatronId, setCurrentPatronId] = useState<string | null>(null);
  const [sharedFormData, setSharedFormData] = useState<SharedFormData>({ incident: null, org_unit: null });
  const [hasEditedContentPerPatron, setHasEditedContentPerPatron] = useState<Record<string, boolean>>({});

  const editorRef = useRef<LetterIframeEditorRef>(null);

  const currentFormData = currentPatronId
    ? formDataPerPatron[currentPatronId] || getDefaultPerPatronData()
    : getDefaultPerPatronData();

  const currentErrors = useMemo(
    () => (currentPatronId ? errorsPerPatron[currentPatronId] || {} : {}),
    [currentPatronId, errorsPerPatron],
  );

  const presetValue = useMemo(() => {
    const startDate = parseIsoDateOrNull(currentFormData.starts_at);
    const liftDate = parseIsoDateOrNull(currentFormData.lifts_at);
    if (!startDate || !liftDate) return '';
    const diffDays = differenceInCalendarDays(liftDate, startDate);
    return (PRESET_DAYS as readonly number[]).includes(diffDays) ? String(diffDays) : '';
  }, [currentFormData.starts_at, currentFormData.lifts_at]);

  useScrollToError(currentErrors);

  const clearError = useCallback((pid: string, field: string) => {
    setErrorsPerPatron((prev) => {
      if (!prev[pid]?.[field]) return prev;
      const updated = { ...prev };
      if (updated[pid]) {
        const patronErrors = { ...updated[pid] };
        delete patronErrors[field];
        updated[pid] = patronErrors;
      }
      return updated;
    });
  }, []);

  const updateCurrentPatronData = useCallback((updates: Partial<PerPatronFormData>) => {
    setCurrentPatronId((pid) => {
      if (!pid) return pid;
      setFormDataPerPatron((prev) => ({
        ...prev,
        [pid]: { ...(prev[pid] ?? getDefaultPerPatronData()), ...updates },
      }));
      return pid;
    });
  }, []);

  const updatePatronData = useCallback((pid: string, updates: Partial<PerPatronFormData>) => {
    setFormDataPerPatron((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? getDefaultPerPatronData()), ...updates },
    }));
  }, []);

  const buildLetterContent = useCallback((
    template: BanLetterTemplate,
    incidentData: Incident,
    patronData?: PatronDetails | null,
    overrides?: { startsAt?: string; liftsAt?: string; lawEnforcementAgency?: string },
  ): string => {
    return processBanLetterTemplate(template, incidentData, patronData, {
      startsAt: overrides?.startsAt ?? currentFormData.starts_at,
      liftsAt: overrides?.liftsAt ?? currentFormData.lifts_at,
      lawEnforcementAgency: overrides?.lawEnforcementAgency ?? currentFormData.law_enforcement_agency,
    });
  }, [currentFormData.starts_at, currentFormData.lifts_at, currentFormData.law_enforcement_agency]);

  const applyTemplateToCurrentPatron = useCallback((template: BanLetterTemplate) => {
    if (!currentPatronId || !incident) return;
    const content = buildLetterContent(template, incident, patronDetailsMap[currentPatronId]);
    updatePatronData(currentPatronId, { ban_letter_template: template.id, ban_letter_content: content });
    setHasEditedContentPerPatron((prev) => ({ ...prev, [currentPatronId]: false }));
  }, [currentPatronId, incident, patronDetailsMap, buildLetterContent, updatePatronData]);

  const regenerateLetterContent = useCallback((overrides: {
    starts_at?: string;
    lifts_at?: string;
    law_enforcement_agency?: string;
  }) => {
    if (!currentPatronId || !currentFormData.ban_letter_template || !incident) return;

    // In-place update when editing or when manual edits exist
    if (preferInPlaceUpdate || hasEditedContentPerPatron[currentPatronId]) {
      const vars = buildTemplateVars(incident, patronDetailsMap[currentPatronId], {
        startsAt: overrides.starts_at ?? currentFormData.starts_at,
        liftsAt: overrides.lifts_at ?? currentFormData.lifts_at,
        lawEnforcementAgency: overrides.law_enforcement_agency ?? currentFormData.law_enforcement_agency,
      });
      editorRef.current?.updateTemplateVars(vars);
      return;
    }

    const template = templates.find((t) => t.id === currentFormData.ban_letter_template);
    if (!template) return;
    const content = buildLetterContent(template, incident, patronDetailsMap[currentPatronId], {
      startsAt: overrides.starts_at,
      liftsAt: overrides.lifts_at,
      lawEnforcementAgency: overrides.law_enforcement_agency,
    });
    updatePatronData(currentPatronId, { ban_letter_content: content });
  }, [
    currentPatronId, currentFormData, incident, templates,
    patronDetailsMap, preferInPlaceUpdate, hasEditedContentPerPatron,
    buildLetterContent, updatePatronData,
  ]);

  const handleInputChange = useCallback(async (field: keyof PerPatronFormData, value: any) => {
    if (!currentPatronId) return;
    clearError(currentPatronId, field);

    if (field === 'is_trespass') {
      const isTrespass = value === true;
      if (hasEditedContentPerPatron[currentPatronId]) {
        const proceed = onTypeChangeRequested
          ? await onTypeChangeRequested(isTrespass)
          : true;
        if (!proceed) return;
      }
      updatePatronData(currentPatronId, { is_trespass: isTrespass });
      const template = isTrespass
        ? templates.find((t) => t.is_trespass && t.is_default)
        : templates.find((t) => !t.is_trespass && t.is_default);
      if (template && incident) {
        const content = buildLetterContent(template, incident, patronDetailsMap[currentPatronId]);
        updatePatronData(currentPatronId, {
          is_trespass: isTrespass,
          ban_letter_template: template.id,
          ban_letter_content: content,
        });
        setHasEditedContentPerPatron((prev) => ({ ...prev, [currentPatronId]: false }));
      }
      return;
    }

    if (field === 'starts_at' && value) {
      const startDate = parseTimestamp(value);
      const liftDays = currentFormData.is_trespass ? DEFAULT_TRESPASS_LIFT_DAYS : DEFAULT_BAN_LIFT_DAYS;
      const liftsDate = addDays(startDate, liftDays);
      const newLiftsAt = formatLocalDate(liftsDate);
      if (currentFormData.is_trespass) {
        updatePatronData(currentPatronId, { starts_at: value, lifts_at: newLiftsAt });
      } else {
        const archivesDate = addDays(liftsDate, DEFAULT_BAN_ARCHIVE_DAYS);
        updatePatronData(currentPatronId, { starts_at: value, lifts_at: newLiftsAt, archives_at: formatLocalDate(archivesDate) });
      }
      regenerateLetterContent({ starts_at: value, lifts_at: newLiftsAt });
      return;
    }

    if (field === 'lifts_at' && value) {
      if (currentFormData.is_trespass) {
        updatePatronData(currentPatronId, { lifts_at: value });
      } else {
        const liftDate = parseTimestamp(value);
        const archivesDate = addDays(liftDate, DEFAULT_BAN_ARCHIVE_DAYS);
        updatePatronData(currentPatronId, { lifts_at: value, archives_at: formatLocalDate(archivesDate) });
      }
      regenerateLetterContent({ lifts_at: value });
      return;
    }

    if (field === 'law_enforcement_agency') {
      updatePatronData(currentPatronId, { law_enforcement_agency: value });
      regenerateLetterContent({ law_enforcement_agency: value });
      return;
    }

    updatePatronData(currentPatronId, { [field]: value });
  }, [
    currentPatronId, currentFormData, templates, incident, patronDetailsMap,
    hasEditedContentPerPatron, onTypeChangeRequested,
    clearError, updatePatronData, buildLetterContent, regenerateLetterContent,
  ]);

  const validateForm = useCallback((
    selectedPatronIds: string[],
    requireTemplate: boolean,
    dataSource?: Record<string, PerPatronFormData>,
  ): boolean => {
    const source = dataSource ?? formDataPerPatron;
    const newErrors: Record<string, Record<string, string>> = {};
    let firstInvalidId: string | null = null;

    for (const pid of selectedPatronIds) {
      const data = source[pid];
      if (!data) continue;
      const errors: Record<string, string> = {};
      if (!data.starts_at) errors.starts_at = 'Start date is required';
      if (!data.lifts_at) errors.lifts_at = 'Lift date is required';
      if (
        data.starts_at &&
        data.lifts_at &&
        parseTimestamp(data.lifts_at) < parseTimestamp(data.starts_at)
      ) {
        errors.lifts_at = 'Lift date cannot be before start date';
      }
      if (requireTemplate && !data.ban_letter_template) {
        errors.ban_letter_template = 'Letter template is required';
      }
      if (letterNeedsViolationSelection(data.ban_letter_content)) {
        errors.ban_letter_violations = 'Please select at least one violation to issue letter';
      }
      if (Object.keys(errors).length > 0) {
        newErrors[pid] = errors;
        if (!firstInvalidId) firstInvalidId = pid;
      }
    }

    if (firstInvalidId && firstInvalidId !== currentPatronId) setCurrentPatronId(firstInvalidId);
    setErrorsPerPatron(newErrors);
    if (firstInvalidId === currentPatronId && newErrors[firstInvalidId!]?.ban_letter_violations) {
      editorRef.current?.flashViolations();
    }
    return Object.keys(newErrors).length === 0;
  }, [formDataPerPatron, currentPatronId]);

  // Clear the violation error as soon as the user checks a violation
  useEffect(() => {
    setErrorsPerPatron((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [pid, errors] of Object.entries(prev)) {
        if (
          errors?.ban_letter_violations &&
          !letterNeedsViolationSelection(formDataPerPatron[pid]?.ban_letter_content ?? '')
        ) {
          const rest = { ...errors };
          delete rest.ban_letter_violations;
          next[pid] = rest;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [formDataPerPatron]);

  const syncAndGetSnapshot = useCallback((): Record<string, PerPatronFormData> => {
    const snapshot = { ...formDataPerPatron };
    if (currentPatronId && editorRef.current) {
      const html = editorRef.current.syncContent();
      if (snapshot[currentPatronId]) {
        snapshot[currentPatronId] = { ...snapshot[currentPatronId]!, ban_letter_content: html };
      }
      setFormDataPerPatron(snapshot);
    }
    return snapshot;
  }, [formDataPerPatron, currentPatronId]);

  return {
    formDataPerPatron,
    setFormDataPerPatron,
    errorsPerPatron,
    setErrorsPerPatron,
    currentPatronId,
    setCurrentPatronId,
    sharedFormData,
    setSharedFormData,
    hasEditedContentPerPatron,
    setHasEditedContentPerPatron,
    editorRef,
    currentFormData,
    currentErrors,
    presetValue,
    updateCurrentPatronData,
    updatePatronData,
    clearError,
    handleInputChange,
    applyTemplateToCurrentPatron,
    buildLetterContent,
    regenerateLetterContent,
    validateForm,
    syncAndGetSnapshot,
  };
}
