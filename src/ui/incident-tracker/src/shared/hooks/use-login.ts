/**
 * useLogin Hook
 *
 * Handles all authentication logic for the Login page:
 * - Local username/password authentication
 * - SSO/SAML authentication initiation
 * - SAML callback token processing (when IdP redirects back with token)
 * - Post-authentication navigation (redirect to home or location selection)
 * - Auto-selection of previously saved org unit
 *
 * This hook is designed to work with Login.tsx (pure UI component) and is
 * independent of AuthGuard, which handles session management for protected routes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/auth-context';
import { samlApi, type SamlSSOConfig, authApi } from '@core';
import { loadSavedOrgUnits } from '../utils/storage';
import { ROUTES } from '../../constants';
import { routeToHref } from '../utils/redirect-utils';

/**
 * Error messages for SAML authentication failures
 */
const SAML_ERROR_MESSAGES: Record<string, string> = {
  no_roles: 'SSO authentication successful, but your account has not been granted application access. Please contact your administrator to assign appropriate roles to your account.',
  saml_auth_failed: 'SSO authentication failed. Please try again or use username/password login.',
  saml_no_token: 'SSO authentication completed but no session token was received. Please try again.',
  saml_token_invalid: 'SSO authentication token was invalid. Please try again.',
};

export interface UseLoginReturn {
  username: string;
  password: string;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  error: string;
  loading: boolean;
  processingSamlCallback: boolean;
  ssoConfigs: SamlSSOConfig[];
  loadingSSOConfigs: boolean;
  showSessionExpiredWarning: boolean;
  handleLocalLogin: (e: React.FormEvent) => Promise<void>;
  handleSSOLogin: (spId?: number) => Promise<void>;
  canSubmit: boolean;
}

export function useLogin(): UseLoginReturn {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, login, fetchCurrentUser } = useAuth();
  const redirectToRef = useRef(searchParams.get('redirect_to'));

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoConfigs, setSSOConfigs] = useState<SamlSSOConfig[]>([]);
  const [loadingSSOConfigs, setLoadingSSOConfigs] = useState(true);
  const [processingSamlCallback, setProcessingSamlCallback] = useState(false);
  const showSessionExpiredWarning = searchParams.get('session_expired') === '1';

  // Handle URL error parameters (from SAML callbacks)
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam && SAML_ERROR_MESSAGES[errorParam]) {
      setError(SAML_ERROR_MESSAGES[errorParam] ?? '');
      setProcessingSamlCallback(false);
      navigate(ROUTES.LOGIN, { replace: true });
    }
  }, [searchParams, navigate]);

  // Handle SAML callback - backend sets HttpOnly cookie, we just need to exchange it for tokens
  useEffect(() => {
    const isSamlCallback = searchParams.get('sso') === '1';
    if (!isSamlCallback) return;

    // Clear the sso param from URL
    navigate(ROUTES.LOGIN, { replace: true });

    const handleSamlCallback = async () => {
      setProcessingSamlCallback(true);

      try {
        // Exchange HttpOnly cookie for access token
        await authApi.refreshToken(undefined, { silent: true });

        await fetchCurrentUser();
        // Navigation will be handled by the isAuthenticated useEffect
      } catch (err) {
        console.error('Failed to authenticate with SAML:', err);
        authApi.clearTokens();
        setError(SAML_ERROR_MESSAGES.saml_token_invalid ?? '');
        setProcessingSamlCallback(false);
      }
    };

    handleSamlCallback();
  }, [searchParams, fetchCurrentUser, navigate]);

  // Fetch SSO configurations for this domain on mount
  useEffect(() => {
    const fetchSSOConfigs = async () => {
      setLoadingSSOConfigs(true);
      try {
        const configs = await samlApi.listSSOConfigs(window.location.origin);
        setSSOConfigs(configs);
      } catch (err) {
        // SSO is optional, don't show error
        console.error('Failed to fetch SSO configs:', err);
      } finally {
        setLoadingSSOConfigs(false);
      }
    };

    fetchSSOConfigs();
  }, []);

  const navigateToSelectLocation = useCallback(async () => {
    // The user's own most-recent explicit selection takes precedence; the
    // SAML-assigned working location is only a fallback for users who have
    // never chosen one.
    const firstSaved = loadSavedOrgUnits()[0];
    if (firstSaved?.uuid) {
      try {
        await authApi.refreshToken({ org_unit: firstSaved.uuid }, { silent: true });
        await fetchCurrentUser();
        navigate(redirectToRef.current || ROUTES.HOME);
        return;
      } catch {
        // Fall through to the SAML working location / picker.
      }
    }

    // Fall back to a SAML-assigned working location.
    try {
      const user = await authApi.getUser({options: {with_working_locations: true}});

      const workingOrgUnits = user?.working_org_unit_uuids;
      if (Array.isArray(workingOrgUnits) && workingOrgUnits.length > 0) {
        await authApi.refreshToken({ org_unit: workingOrgUnits[0] }, { silent: true });
        await fetchCurrentUser();
        navigate(redirectToRef.current || ROUTES.HOME);
        return;
      }
    } catch (err) {
      console.error('Failed to apply SSO working location:', err);
    }

    navigate(ROUTES.SELECT_LOCATION);
  }, [navigate, fetchCurrentUser]);

  // Navigate after successful login
  useEffect(() => {
    if (!isAuthenticated) return;

    const orgUnit = authApi.getOrgUnit();
    if (orgUnit) {
      navigate(redirectToRef.current || ROUTES.HOME);
    } else {
      navigateToSelectLocation();
    }
  }, [isAuthenticated, navigate, navigateToSelectLocation]);

  const handleLocalLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Check for saved org unit to include in login
      const savedOrgUnits = loadSavedOrgUnits();
      const savedOrgUnit = savedOrgUnits.length > 0 ? savedOrgUnits[0]?.uuid : undefined;

      await login(username, password, savedOrgUnit);

      // Navigation handled by isAuthenticated useEffect
    } catch (err: any) {
      setError(err?.message || err || 'Login failed');
      setLoading(false);
    }
  }, [login, username, password]);

  const handleSSOLogin = useCallback(async (spId?: number) => {
    const resolvedSpId = spId ?? ssoConfigs[0]?.sp_id;
    if (!resolvedSpId) return;

    setError('');
    setLoading(true);

    try {
      // Carry redirect_to in RelayState so it survives the IdP round-trip
      let relayState = window.location.origin + routeToHref(ROUTES.LOGIN);
      if (redirectToRef.current) {
        relayState += `?redirect_to=${encodeURIComponent(redirectToRef.current)}`;
      }

      const response = await samlApi.initiateSSOLogin({
        spId: resolvedSpId,
        relayState,
      });

      // Redirect to IdP
      window.location.href = response.redirect_url;
    } catch (err: any) {
      console.error('SSO login failed:', err);
      setError('SSO login failed. Please try username/password login.');
      setLoading(false);
    }
  }, [ssoConfigs]);

  return {
    username,
    password,
    setUsername,
    setPassword,
    error,
    loading,
    processingSamlCallback,
    ssoConfigs,
    loadingSSOConfigs,
    showSessionExpiredWarning,
    handleLocalLogin,
    handleSSOLogin,
    canSubmit: !loading && username.length > 0 && password.length > 0,
  };
}
