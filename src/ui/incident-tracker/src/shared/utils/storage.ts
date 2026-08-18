import type { SavedOrgUnit } from '../../types';

export const STORAGE_KEYS = {
  USER_PREFERENCES: 'incident-tracker-user-preferences',
  SAVED_ORG_UNITS: 'incident-tracker-saved-org-units',
} as const;

export function loadSavedOrgUnits(): SavedOrgUnit[] {
  const savedListData = localStorage.getItem(STORAGE_KEYS.SAVED_ORG_UNITS);

  if (!savedListData) return [];

  try {
    const savedList = (JSON.parse(savedListData) as SavedOrgUnit[])
      // Entries persisted before the uuid migration carried an integer
      // `id` instead of a `uuid`; treat those as absent.
      .filter((unit) => typeof unit.uuid === 'string' && unit.uuid.length > 0);
    savedList.sort((a, b) =>
      new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime()
    );
    return savedList;
  } catch {
    return [];
  }
}
