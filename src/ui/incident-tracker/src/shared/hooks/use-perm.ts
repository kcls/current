import { useEffect, useState } from 'react';
import { authApi } from '@core';
import { useAuth } from '../../contexts/auth-context';

/**
 * Whether the signed-in user holds `perm`, asked of the server so the
 * answer is the same one the API will apply. Use it to decide whether a
 * write control is shown at all, rather than inferring from role names.
 *
 * `orgUnit` says where to check, and should be the org unit the API
 * checks for that write:
 *   - a uuid: at that org unit (an entity's own, or the working location)
 *   - null: with no org unit, as the API does for patron writes
 *   - undefined: not known yet (the entity is still loading). Nothing is
 *     asked and the result is false, so a control never flashes on
 *     against the wrong org unit.
 *
 * False until the server answers, and on any error.
 */
export function usePerm(perm: string, orgUnit: string | null | undefined): boolean {
  const { user } = useAuth();
  // Re-ask when the signed-in user changes; uuid is optional on User.
  const userKey = user ? (user.uuid ?? String(user.id)) : null;
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(false);
    if (orgUnit === undefined || !userKey) return;

    let cancelled = false;
    authApi.userHasPerm(perm, orgUnit ?? undefined).then((result) => {
      if (!cancelled) setAllowed(result);
    });
    return () => {
      cancelled = true;
    };
  }, [perm, orgUnit, userKey]);

  return allowed;
}

/**
 * usePerm at the working location: for creating something new, which
 * the forms default to the working location. False when the session has
 * no working location yet.
 */
export function useWorkingLocationPerm(perm: string): boolean {
  return usePerm(perm, authApi.getOrgUnit() ?? undefined);
}
