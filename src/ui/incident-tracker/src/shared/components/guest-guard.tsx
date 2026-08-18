import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth-context';
import { ROUTES } from '../../constants';

const GuestGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, initializing } = useAuth();

  if (initializing) return null; // AuthProvider is still restoring the session
  return isAuthenticated ? <Navigate to={ROUTES.HOME} replace /> : <>{children}</>;
};

export default GuestGuard;
