import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  Toolbar,
  Typography,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  Tooltip,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  ReportProblem as IncidentIcon,
  RateReview as ReviewIcon,
  Article as IncidentTemplateIcon,
  BarChart as BarChartIcon,
  AdminPanelSettings as RoleManagementIcon,
  Badge as StaffManagementIcon,
  Notifications as NotificationsIcon,
  Settings as SettingsIcon,
  Brightness4,
  Brightness7,
  Person as PatronIcon,
  AccountTree as ReviewProcessIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/auth-context';
import { styled } from '@mui/material/styles';
import { useTheme } from '../../contexts/theme-context';
import { authApi, orgUnitApi, type OrgUnit } from '@core';
import NotificationCenter from '../../features/notifications/components/notification-center';
import {
  STAFF_ROLES,
  COORDINATOR_ROLES,
  MANAGER_ROLES,
} from '../utils/roles';
import { ROUTES } from '../../constants';

export const PageContainer = styled(Container)(({ theme }) => ({
  paddingTop: theme.spacing(3),
  paddingBottom: theme.spacing(3),
}));

const Layout: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { activeMode, toggleMode } = useTheme();
  const [contextOrgUnit, setContextOrgUnit] = useState<OrgUnit | null>(null);

  // Load context org unit
  useEffect(() => {
    const loadOrgUnit = async () => {
      const orgUnitId = authApi.getOrgUnit();
      if (orgUnitId) {
        try {
          // Get org unit tree and find the context org unit
          const tree = await orgUnitApi.getOrgUnitTree();
          const flatUnits = orgUnitApi.flattenOrgUnits(tree);
          const orgUnit = flatUnits.find(u => u.uuid === orgUnitId);
          if (orgUnit) {
            setContextOrgUnit(orgUnit);
          }
        } catch (err) {
          console.error('Failed to load context org unit:', err);
        }
      }
    };
    loadOrgUnit();
  }, [user]);

  // Helper function to check if user has any of the required roles
  const hasAnyRole = React.useCallback((requiredRoles: readonly string[]) => {
    if (!user?.roles || !requiredRoles.length) return false;
    return user.roles.some(roleAssignment =>
      requiredRoles.includes(roleAssignment.role)
    );
  }, [user?.roles]);

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  const menuItems = [
    {
      text: 'Dashboard',
      icon: <DashboardIcon />,
      path: ROUTES.DASHBOARD,
      show: hasAnyRole(STAFF_ROLES)
    },
    {
      text: 'Incidents',
      icon: <IncidentIcon />,
      path: ROUTES.INCIDENTS,
      show: hasAnyRole(STAFF_ROLES)
    },
    {
      text: 'Reviews',
      icon: <ReviewIcon />,
      path: ROUTES.INCIDENT_REVIEWS,
      show: hasAnyRole(STAFF_ROLES)
    },
    {
      text: 'Patrons',
      icon: <PatronIcon />,
      path: ROUTES.PATRONS,
      show: hasAnyRole(STAFF_ROLES)
    },
    {
      text: 'Notifications',
      icon: <NotificationsIcon />,
      path: ROUTES.NOTIFICATIONS,
      show: hasAnyRole(STAFF_ROLES)
    },
  ];

  const managerMenuItems = [
    {
      text: 'Staff Management',
      icon: <StaffManagementIcon />,
      path: ROUTES.STAFF_MANAGEMENT,
      show: false
    },
    {
      text: 'Role Management',
      icon: <RoleManagementIcon />,
      path: ROUTES.ROLE_MANAGEMENT,
      show: false
    },
  ];

  const adminMenuItems = [
    {
      text: 'Reports',
      icon: <BarChartIcon />,
      path: ROUTES.REPORTS,
      show: hasAnyRole(MANAGER_ROLES)
    },
    {
      text: 'Review Process',
      icon: <ReviewProcessIcon />,
      path: ROUTES.REVIEW_PROCESS,
      show: hasAnyRole(MANAGER_ROLES)
    },
    {
      // Gated like its route in app.tsx (coordinator, not manager) so the
      // entry never links somewhere the RoleGuard would reject.
      text: 'Incident Templates',
      icon: <IncidentTemplateIcon />,
      path: ROUTES.TEMPLATES,
      show: hasAnyRole(COORDINATOR_ROLES)
    },
  ];

  const handleDrawerClose = () => setDrawerOpen(false);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Tooltip title="Open navigation menu" enterDelay={1000}>
            <IconButton
              size="large"
              edge="start"
              color="inherit"
              aria-label="menu"
              sx={{ mr: 2 }}
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon />
            </IconButton>
          </Tooltip>
          
          <Box sx={{ flexGrow: 1 }}>
            <Typography
              variant="h6"
              component={RouterLink}
              to={ROUTES.HOME}
              sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'baseline', gap: 1, color: 'inherit', textDecoration: 'none' }}
            >
            <span>Current</span>
            {import.meta.env.VITE_VERSION && (
              <Typography
                component="span"
                variant="caption"
                sx={{ opacity: 0.7, fontSize: '0.75rem' }}
              >
                {import.meta.env.VITE_VERSION}
              </Typography>
            )}
            </Typography>
          </Box>

          {user && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
              <Typography variant="body2">
                {user.username}
                {contextOrgUnit?.code && `@${contextOrgUnit.code}`}
              </Typography>
            </Box>
          )}

          <NotificationCenter />

          <Tooltip title={`Switch to ${activeMode === 'light' ? 'dark' : 'light'} mode`} enterDelay={1000}>
            <IconButton
              color="inherit"
              onClick={toggleMode}
              sx={{ mr: 1 }}
            >
              {activeMode === 'light' ? <Brightness4 /> : <Brightness7 />}
            </IconButton>
          </Tooltip>

          <Tooltip title="User preferences and settings" enterDelay={1000}>
            <IconButton
              component={RouterLink}
              to={ROUTES.PREFERENCES}
              color="inherit"
              sx={{ mr: 1 }}
            >
              <SettingsIcon />
            </IconButton>
          </Tooltip>

          <Button color="inherit" onClick={handleLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ flexGrow: 1, bgcolor: 'background.default' }}>
        <Outlet />
      </Box>

      <Box component="footer" sx={{ py: 3, px: 2, mt: 'auto', bgcolor: 'background.paper' }}>
        <Container maxWidth="sm">
          <Typography variant="body2" color="text.secondary" align="center">
            © {new Date().getFullYear()} King County Library System
          </Typography>
        </Container>
      </Box>

      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box sx={{ width: 250 }} role="presentation">
          <List>
            <ListItem>
              <Typography variant="h6" sx={{ p: 2 }}>
                Menu
              </Typography>
            </ListItem>
            <Divider />
            {menuItems.filter(item => item.show).map((item) => (
              <ListItem key={item.text} disablePadding>
                <ListItemButton component={RouterLink} to={item.path} onClick={handleDrawerClose}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {React.cloneElement(item.icon, { fontSize: 'small' })}
                    <ListItemText primary={item.text} />
                  </Box>
                </ListItemButton>
              </ListItem>
            ))}

            {/* Manager Tools */}
            {managerMenuItems.some(item => item.show) && (
              <>
                <Divider sx={{ my: 1 }} />
                <ListItem>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ px: 2 }}>
                    Manager Tools
                  </Typography>
                </ListItem>
                {managerMenuItems.filter(item => item.show).map((item) => (
                  <ListItem key={item.text} disablePadding>
                    <ListItemButton component={RouterLink} to={item.path} onClick={handleDrawerClose}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {React.cloneElement(item.icon, { fontSize: 'small' })}
                        <ListItemText primary={item.text} />
                      </Box>
                    </ListItemButton>
                  </ListItem>
                ))}
              </>
            )}

            {/* Admin Tools */}
            {adminMenuItems.some(item => item.show) && (
              <>
                <Divider sx={{ my: 1 }} />
                <ListItem>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ px: 2 }}>
                    Admin Tools
                  </Typography>
                </ListItem>
                {adminMenuItems.filter(item => item.show).map((item) => (
                  <ListItem key={item.text} disablePadding>
                    <ListItemButton component={RouterLink} to={item.path} onClick={handleDrawerClose}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {React.cloneElement(item.icon, { fontSize: 'small' })}
                        <ListItemText primary={item.text} />
                      </Box>
                    </ListItemButton>
                  </ListItem>
                ))}
              </>
            )}

          </List>
        </Box>
      </Drawer>

    </Box>
  );
};

export default Layout;
