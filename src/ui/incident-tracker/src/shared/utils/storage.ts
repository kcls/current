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

/**
 * Forget a saved location, by uuid.
 *
 * Called when the server rejects one as unknown. A saved location is a
 * convenience, and an org unit can legitimately disappear -- a branch
 * closes, or the install is rebuilt on a different org tree, which is
 * what happens on an upgrade that reseeds. Keeping a reference the
 * server has disowned only makes the next login fail the same way.
 */
export function forgetSavedOrgUnit(uuid: string): void {
  try {
    const remaining = loadSavedOrgUnits().filter((u) => u.uuid !== uuid);
    localStorage.setItem(STORAGE_KEYS.SAVED_ORG_UNITS, JSON.stringify(remaining));
  } catch {
    // Storage unavailable or malformed; nothing useful to do here. The
    // caller has already retried without the location.
  }
}

/**
 * True when a failure is the server rejecting an org unit it does not
 * know about, rather than a genuine auth failure.
 *
 * Matched on the code plus the shape of the message: a 404 from
 * login/refresh can only be about the org_unit, since that is the only
 * reference in the request the server looks up.
 */
export function isUnknownOrgUnit(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code ?? '';
  const message = e?.message ?? '';
  return (
    code === 'NOT_FOUND' ||
    /not[_ ]found/i.test(code) ||
    /org unit .* not found/i.test(message)
  );
}
