/**
 * AuthGuard Component
 *
 * Protects routes that require authentication. Responsibilities:
 * - Session recovery: Attempts to restore session from HttpOnly refresh token cookie on page load
 * - Session expiration monitoring: Tracks refresh token expiration and warns users before timeout
 * - Session extension: Allows users to extend their session before it expires
 * - Redirect enforcement: Redirects unauthenticated users to the login page
 *
 * This component wraps all protected routes and is independent of the Login page.
 * Authentication flow (local/SSO login, SAML callback) is handled by useLogin hook.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  LinearProgress,
} from '@mui/material';
import { authApi as coreAuthApi } from '@core';
import { useAuth } from '../../contexts/auth-context';
import { ROUTES } from '../../constants';
import { getRedirectPath, routeToHref } from '../utils/redirect-utils';

/**
 * Session warning countdown duration (2 minutes)
 * When the refresh token is about to expire within this time,
 * show a warning dialog asking if they want to extend their session.
 */
const SESSION_WARNING_COUNTDOWN_MS = 2 * 60 * 1000;

/** Check session expiration every 30 seconds */
const CHECK_INTERVAL_MS = 30 * 1000;

interface AuthGuardProps {
  children: React.ReactNode;
}

/** Prevent multiple simultaneous redirects */
let isRedirecting = false;

const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, initializing, clearAuth } = useAuth();
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getCurrentRedirectPath = useCallback((): string | undefined => {
    return getRedirectPath(window.location.pathname, window.location.search);
  }, []);

  const handleLogoutAndRedirect = useCallback((sessionExpired = false, redirectTo?: string) => {
    if (isRedirecting) return;
    if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    if (warningIntervalRef.current) clearInterval(warningIntervalRef.current);

    setShowWarningDialog(false);
    coreAuthApi.clearTokens();
    clearAuth();

    isRedirecting = true;
    const params = new URLSearchParams();
    if (sessionExpired) params.set('session_expired', '1');
    if (redirectTo) params.set('redirect_to', redirectTo);
    const loginHref = routeToHref(ROUTES.LOGIN);
    const url = params.size ? `${loginHref}?${params}` : loginHref;
    window.location.href = url;
  }, [clearAuth]);


  const checkSessionExpiration = useCallback(() => {
    if (!isAuthenticated) return;

    const expiresAt = coreAuthApi.getRefreshTokenExpirationTime();
    if (!expiresAt) return;

    const remaining = expiresAt - Date.now();

    if (remaining <= 0) {
      handleLogoutAndRedirect(true, getCurrentRedirectPath());
      return;
    }

    if (remaining <= SESSION_WARNING_COUNTDOWN_MS) {
      setTimeRemaining(remaining);
      setShowWarningDialog(true);
    } else {
      setShowWarningDialog(false);
      setTimeRemaining(null);
    }
  }, [isAuthenticated, handleLogoutAndRedirect]);

  // Subscribe to sessionExpired$ events
  useEffect(() => {
    const subscription = coreAuthApi.sessionExpired$.subscribe(() => {
      handleLogoutAndRedirect(true, getCurrentRedirectPath());
    });

    return () => subscription.unsubscribe();
  }, [handleLogoutAndRedirect]);

  // Periodic session check
  useEffect(() => {
    if (!isAuthenticated || initializing) {
      setShowWarningDialog(false);
      return;
    }

    checkSessionExpiration();
    checkIntervalRef.current = setInterval(checkSessionExpiration, CHECK_INTERVAL_MS);

    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, [isAuthenticated, initializing, checkSessionExpiration]);

  // Update countdown timer every second when warning dialog is shown
  useEffect(() => {
    if (!showWarningDialog) return;

    warningIntervalRef.current = setInterval(() => {
      const expiresAt = coreAuthApi.getRefreshTokenExpirationTime();
      if (!expiresAt) return;

      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        handleLogoutAndRedirect(true, getCurrentRedirectPath());
      } else {
        setTimeRemaining(remaining);
      }
    }, 1000);

    return () => {
      if (warningIntervalRef.current) clearInterval(warningIntervalRef.current);
    };
  }, [showWarningDialog, handleLogoutAndRedirect]);

  const handleExtendSession = async () => {
    try {
      await coreAuthApi.refreshToken();
      setShowWarningDialog(false);
      setTimeRemaining(null);
    } catch (error) {
      console.error('Failed to extend session:', error);
      handleLogoutAndRedirect(true, getCurrentRedirectPath());
    }
  };

  // Show loading while the provider restores the session
  if (initializing) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh'
      }}>
        Loading...
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated && !isRedirecting) {
    handleLogoutAndRedirect(false, getCurrentRedirectPath());
    return null;
  }

  return (
    <>
      {children}

      {/* Session Expiring Warning Dialog */}
      <Dialog
        open={showWarningDialog}
        onClose={() => {}}
        disableEscapeKeyDown
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: '8px',
              p: 3,
            },
          },
        }}
      >
        <DialogTitle sx={{ p: 0, pb: 2 }}>
          Session Expiring Soon
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            Your session will expire in{' '}
            <strong>{timeRemaining ? Math.ceil(timeRemaining / 1000) : 0} seconds</strong>.
          </Typography>
          <LinearProgress
            variant="determinate"
            value={timeRemaining ? (timeRemaining / SESSION_WARNING_COUNTDOWN_MS) * 100 : 0}
            sx={{
              height: 4,
              borderRadius: 2,
              mb: 3,
            }}
          />
          <Typography variant="body2" color="text.secondary">
            Do you want to stay signed in?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 0, pt: 3, gap: 1 }}>
          <Button onClick={() => handleLogoutAndRedirect(false)}>
            End session
          </Button>
          <Button onClick={handleExtendSession} variant="contained" disableElevation>
            Keep me signed in
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default AuthGuard;
