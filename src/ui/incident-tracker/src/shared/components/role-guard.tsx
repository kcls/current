import React from 'react';
import { Navigate } from 'react-router-dom';
import { Box, Typography, Paper } from '@mui/material';
import { Block as BlockIcon } from '@mui/icons-material';
import { useAuth } from '../../contexts/auth-context';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: string[];
  redirectTo?: string;
  showAccessDenied?: boolean;
}

const AccessDeniedPage: React.FC = () => (
  <Box
    display="flex"
    justifyContent="center"
    alignItems="center"
    py={8}
  >
    <Paper sx={{ p: 4, maxWidth: 500, textAlign: 'center' }}>
      <BlockIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
      <Typography variant="h5" gutterBottom>
        Access Denied
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Your account has not been granted application access. Please contact your administrator to assign appropriate roles to your account.
      </Typography>
    </Paper>
  </Box>
);

const RoleGuard: React.FC<RoleGuardProps> = ({
  children,
  allowedRoles,
  redirectTo = '/',
  showAccessDenied = false,
}) => {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading || !isAuthenticated) return null;

  const hasAccess = user?.roles?.some((r: any) =>
    allowedRoles.includes(r.role)
  );

  if (hasAccess) {
    return <>{children}</>;
  }

  return showAccessDenied ? <AccessDeniedPage /> : <Navigate to={redirectTo} replace />;
};

export default RoleGuard;
