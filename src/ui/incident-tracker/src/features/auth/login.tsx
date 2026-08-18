import React, { useState } from 'react';
import {
  Box,
  Button,
  Container,
  Link,
  TextField,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useLogin } from '../../shared/hooks/use-login';

const Login: React.FC = () => {
  const {
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
    canSubmit,
  } = useLogin();

  // Optional deploy-time link to a public demo site (e.g. a staging
  // install). No link is rendered when unconfigured.
  const demoSiteUrl = import.meta.env.VITE_DEMO_SITE_URL as string | undefined;
  const onDemoSite =
    typeof window !== 'undefined' &&
    !!demoSiteUrl &&
    window.location.hostname === new URL(demoSiteUrl).hostname;

  const hasSso = ssoConfigs.length > 0;
  const [showLocalLogin, setShowLocalLogin] = useState(false);
  const showSsoView = hasSso && !showLocalLogin;
  const showLocalView = showLocalLogin || (!loadingSSOConfigs && !hasSso);

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper elevation={3} sx={{ padding: 4, width: '100%' }}>
          <Typography component="h1" variant="h5" align="center" sx={{ mb: 3 }}>
            Current Login
          </Typography>

          {processingSamlCallback ? (
            // Show loading state during SAML callback processing
            <Box sx={{ mt: 4, mb: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <CircularProgress size={40} />
              <Typography variant="body1" color="text.secondary" align="center">
                Completing SSO login...
              </Typography>
              <Typography variant="body2" color="text.secondary" align="center">
                Please wait while we redirect you.
              </Typography>
            </Box>
          ) : (
            <>
              {showSessionExpiredWarning && (
                <Alert severity="warning" sx={{ mt: 2, mb: 2 }}>
                  Your session has expired. Please log in again to continue.
                </Alert>
              )}

              {error && (
                <Alert severity="error" sx={{ mt: 2, mb: 2 }}>
                  {error}
                </Alert>
              )}

              {/* SSO login - the default view */}
              {showSsoView && (
                <Box sx={{ mt: 2 }}>
                  {ssoConfigs.map((config) => (
                    <Button
                      key={config.sp_id}
                      fullWidth
                      variant="contained"
                      data-testid="sso-login-button"
                      onClick={() => handleSSOLogin(config.sp_id)}
                      disabled={loading}
                      sx={{ mb: 1 }}
                    >
                      {ssoConfigs.length === 1
                        ? 'Sign In'
                        : `Sign in with ${config.label || 'SSO'}`}
                    </Button>
                  ))}

                  <Divider sx={{ my: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      OR
                    </Typography>
                  </Divider>

                  <Button
                    fullWidth
                    variant="text"
                    data-testid="toggle-local-login"
                    onClick={() => setShowLocalLogin(true)}
                    disabled={loading}
                  >
                    Use a username and password
                  </Button>
                </Box>
              )}

              {/* Username/password form - swaps in to replace the SSO view */}
              {showLocalView && (
                <Box component="form" onSubmit={handleLocalLogin} sx={{ mt: 1 }}>
                  <TextField
                    margin="normal"
                    required
                    fullWidth
                    id="username"
                    label="Username"
                    name="username"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loading}
                  />
                  <TextField
                    margin="normal"
                    required
                    fullWidth
                    name="password"
                    label="Password"
                    type="password"
                    id="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />

                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    data-testid="local-login-button"
                    sx={{ mt: 3, mb: 2 }}
                    disabled={!canSubmit}
                  >
                    {loading ? 'Signing In...' : 'Sign In'}
                  </Button>

                  {/* Switch back to SSO when it's available */}
                  {hasSso && (
                    <>
                      <Divider sx={{ my: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                          OR
                        </Typography>
                      </Divider>

                      <Button
                        fullWidth
                        variant="text"
                        data-testid="toggle-sso-login"
                        onClick={() => setShowLocalLogin(false)}
                        disabled={loading}
                      >
                        Sign in with SSO
                      </Button>
                    </>
                  )}
                </Box>
              )}
            </>
          )}
        </Paper>
        {demoSiteUrl && !onDemoSite && (
          <Link
            href={demoSiteUrl}
            variant="body1"
            target="_blank"
            rel="noopener noreferrer"
            sx={{ mt: 5, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            Click Here to Access the Demo Site
            <OpenInNewIcon fontSize="small" />
          </Link>
        )}
      </Box>
    </Container>
  );
};

export default Login;
