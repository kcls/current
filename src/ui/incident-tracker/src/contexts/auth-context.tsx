import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode, useEffect } from 'react';
import { User } from '../types';
import { authApi } from '@core';
import { loadSavedOrgUnits } from '../shared/utils/storage';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  initializing: boolean;
  error: string | null;
  login: (username: string, password: string, orgUnitUuid?: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchCurrentUser: () => Promise<void>;
  clearError: () => void;
  clearAuth: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Pick a default working location for a session whose token carries none.
 * The user's own most-recent explicit selection (saved in localStorage)
 * takes precedence; the server-side SAML working location is only a fallback
 * for users who have never chosen one. Returns undefined when no default can
 * be determined (the caller then shows the picker).
 */
async function resolveDefaultOrgUnit(): Promise<string | undefined> {
  const savedOrgUnit = loadSavedOrgUnits()[0]?.uuid;
  if (savedOrgUnit) {
    return savedOrgUnit;
  }

  try {
    const user = await authApi.getUser({ options: { with_working_locations: true } });
    const workingOrgUnits: string[] | undefined = user?.working_org_unit_uuids;
    if (Array.isArray(workingOrgUnits) && workingOrgUnits.length > 0) {
      return workingOrgUnits[0];
    }
  } catch {
    // No default available; caller falls back to the picker.
  }
  return undefined;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (username: string, password: string, orgUnitUuid?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await authApi.loginLocal({ username, password, org_unit: orgUnitUuid });
      const coreUser = await authApi.me();
      const userData: User = {
        ...coreUser,
        uuid: authApi.getSessionData()?.user_uuid,
        org_unit: authApi.getOrgUnit(),
      };
      setUser(userData);
      setIsAuthenticated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setIsAuthenticated(false);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      setIsLoading(false);
      setError(null);
    }
  }, []);

  const fetchCurrentUser = useCallback(async () => {
    setIsLoading(true);
    try {
      const coreUser = await authApi.me();
      const userData: User = {
        ...coreUser,
        uuid: authApi.getSessionData()?.user_uuid,
        org_unit: authApi.getOrgUnit(),
      };
      setUser(userData);
      setIsAuthenticated(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch user');
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearAuth = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
    setIsLoading(false);
    setError(null);
  }, []);

  // Restore the session once on load — the single source of truth for
  // "am I logged in?". A cold load has no in-memory access token, but a
  // valid refresh cookie still means the user is logged in, so refresh
  // first, then hydrate the user. refresh rotates the token, so this must
  // be the ONLY place that restores; guards just read isAuthenticated /
  // isLoading and never refresh on their own.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await authApi.refreshToken(undefined, { silent: true }).catch(() => {});

      // If the restored token has no working location, resolve a default so
      // a returning user lands on it instead of the picker. SAML tokens are
      // always issued without an org_unit, so without this an SSO user whose
      // location comes from auth.saml_usr_working_location would be re-prompted
      // on every load — the working-location resolution used to live only in
      // the login-page callback, which this cold-restore path never hits.
      //
      // Prefer the user's server-side SAML working location, then fall back
      // to the most-recently-used location saved locally. Mirrors the login
      // hook's navigateToSelectLocation().
      if (!cancelled && !authApi.getOrgUnit()) {
        const defaultOrgUnit = await resolveDefaultOrgUnit();
        if (defaultOrgUnit) {
          await authApi
            .refreshToken({ org_unit: defaultOrgUnit }, { silent: true })
            .catch(() => {});
        }
      }

      if (!cancelled) await fetchCurrentUser();
      if (!cancelled) setInitializing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchCurrentUser]);

  const value = useMemo(() => ({
    user,
    isAuthenticated,
    isLoading,
    initializing,
    error,
    login,
    logout,
    fetchCurrentUser,
    clearError,
    clearAuth,
  }), [user, isAuthenticated, isLoading, initializing, error, login, logout, fetchCurrentUser, clearError, clearAuth]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
