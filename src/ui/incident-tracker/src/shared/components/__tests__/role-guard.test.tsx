import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../tests/test-utils';
import RoleGuard from '../role-guard';
import * as authContext from '../../../contexts/auth-context';

// Mock useAuth hook
vi.mock('../../../contexts/auth-context', async () => {
  const actual = await vi.importActual('../../../contexts/auth-context');
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

const mockUseAuth = vi.mocked(authContext.useAuth);

// Helper to create mock auth state
function createAuthState(overrides: Partial<ReturnType<typeof authContext.useAuth>> = {}) {
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    initializing: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    fetchCurrentUser: vi.fn(),
    clearError: vi.fn(),
    clearAuth: vi.fn(),
    ...overrides,
  };
}

// Helper to create mock user with roles
function createMockUser(roles: Array<{ role: string; org_unit?: number }>) {
  return {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    display_name: 'Test User',
    roles: roles.map((r, i) => ({
      id: i + 1,
      role: r.role,
      org_unit: r.org_unit ?? 1,
    })),
  };
}

describe('RoleGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('should render nothing when loading', () => {
      mockUseAuth.mockReturnValue(createAuthState({ isLoading: true }));

      const { container } = renderWithProviders(
        <RoleGuard allowedRoles={['incident-staff']}>
          <div>Protected Content</div>
        </RoleGuard>
      );

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('unauthenticated state', () => {
    it('should render nothing when not authenticated', () => {
      mockUseAuth.mockReturnValue(
        createAuthState({ isLoading: false, isAuthenticated: false })
      );

      const { container } = renderWithProviders(
        <RoleGuard allowedRoles={['incident-staff']}>
          <div>Protected Content</div>
        </RoleGuard>
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('authorized access', () => {
    it('should render children when user has allowed role', () => {
      const user = createMockUser([{ role: 'incident-staff' }]);
      mockUseAuth.mockReturnValue(
        createAuthState({ isAuthenticated: true, user })
      );

      renderWithProviders(
        <RoleGuard allowedRoles={['incident-staff']}>
          <div>Protected Content</div>
        </RoleGuard>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    it('should render children when user has one of multiple allowed roles', () => {
      const user = createMockUser([{ role: 'incident-coordinator' }]);
      mockUseAuth.mockReturnValue(
        createAuthState({ isAuthenticated: true, user })
      );

      renderWithProviders(
        <RoleGuard allowedRoles={['incident-staff', 'incident-coordinator', 'incident-admin']}>
          <div>Protected Content</div>
        </RoleGuard>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    it('should render children when user has admin role', () => {
      const user = createMockUser([{ role: 'incident-admin' }]);
      mockUseAuth.mockReturnValue(
        createAuthState({ isAuthenticated: true, user })
      );

      renderWithProviders(
        <RoleGuard allowedRoles={['incident-admin']}>
          <div>Protected Content</div>
        </RoleGuard>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  describe('unauthorized access', () => {
    it('should redirect when user lacks required role', () => {
      const user = createMockUser([{ role: 'incident-staff' }]);
      mockUseAuth.mockReturnValue(
        createAuthState({ isAuthenticated: true, user })
      );

      renderWithProviders(
        <RoleGuard allowedRoles={['incident-admin']}>
          <div>Protected Content</div>
        </RoleGuard>
      );

      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('should redirect to custom path when specified', () => {
      const user = createMockUser([{ role: 'incident-staff' }]);
      mockUseAuth.mockReturnValue(
        createAuthState({ isAuthenticated: true, user })
      );

      renderWithProviders(
        <RoleGuard allowedRoles={['incident-admin']} redirectTo="/unauthorized">
          <div>Protected Content</div>
        </RoleGuard>,
        { initialRoute: '/protected' }
      );

      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('should show access denied page when showAccessDenied is true', () => {
      const user = createMockUser([{ role: 'incident-staff' }]);
      mockUseAuth.mockReturnValue(
        createAuthState({ isAuthenticated: true, user })
      );

      renderWithProviders(
        <RoleGuard allowedRoles={['incident-admin']} showAccessDenied>
          <div>Protected Content</div>
        </RoleGuard>
      );

      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
      expect(
        screen.getByText(/your account has not been granted/i)
      ).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle user with no roles', () => {
      const user = createMockUser([]);
      mockUseAuth.mockReturnValue(
        createAuthState({ isAuthenticated: true, user })
      );

      renderWithProviders(
        <RoleGuard allowedRoles={['incident-staff']} showAccessDenied>
          <div>Protected Content</div>
        </RoleGuard>
      );

      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
    });

    it('should handle user with undefined roles', () => {
      const user = { id: 1, username: 'test', email: 'test@example.com', display_name: 'Test' };
      mockUseAuth.mockReturnValue(
        createAuthState({ isAuthenticated: true, user: user as any })
      );

      renderWithProviders(
        <RoleGuard allowedRoles={['incident-staff']} showAccessDenied>
          <div>Protected Content</div>
        </RoleGuard>
      );

      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('should handle multiple roles on user', () => {
      const user = createMockUser([
        { role: 'incident-staff' },
        { role: 'incident-coordinator' },
      ]);
      mockUseAuth.mockReturnValue(
        createAuthState({ isAuthenticated: true, user })
      );

      renderWithProviders(
        <RoleGuard allowedRoles={['incident-manager']}>
          <div>Protected Content</div>
        </RoleGuard>
      );

      // User has staff and coordinator, but not manager
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });
});
