import { Routes, Route, Navigate } from 'react-router-dom';
import { PageErrorBoundary } from './shared/components/error-boundary';
import AppProviders from './shared/components/app-providers';
import Layout from './shared/components/layout';
import Dashboard from './features/dashboard';
import Login from './features/auth/login';
import SelectLocation from './features/auth/select-location';
import Preferences from './features/settings/preferences';
import Appearance from './features/settings/appearance';
import IncidentList from './features/incidents/incident-list';
import CreateIncidentPage from './features/incidents/create-incident-page';
import EditIncidentPage from './features/incidents/edit-incident-page';
import IncidentDetail from './features/incidents/incident-detail';
import CreateBanPage from './features/incidents/create-ban-page';
import EditBanPage from './features/incidents/edit-ban-page';
import TemplateList from './features/settings/template-list';
import Reports from './features/reports';
import PatronList from './features/patrons/patron-list';
import PatronDetail from './features/patrons/patron-detail';
import IncidentReviews from './features/incidents/incident-reviews';
import PatronBanDetail from './features/patrons/patron-ban-detail';
import Notifications from './features/notifications';
import ReviewChainSettings from './features/settings/review-chain-settings';
import AuthGuard from './shared/components/auth-guard';
import GuestGuard from './shared/components/guest-guard';
import OrgUnitGuard from './shared/components/org-unit-guard';
import RoleGuard from './shared/components/role-guard';
import {
  STAFF_ROLES,
  COORDINATOR_ROLES,
  MANAGER_ROLES,
} from './shared/utils/roles';
import { ROUTES } from './constants';

function App() {
  return (
    <PageErrorBoundary>
      <AppProviders>
        <Routes>
          <Route path={ROUTES.LOGIN} element={<GuestGuard><Login /></GuestGuard>} />
          <Route
            path="*"
            element={
              <AuthGuard>
                <Routes>
                  <Route path={ROUTES.SELECT_LOCATION} element={<SelectLocation />} />
                  <Route
                    path={ROUTES.HOME}
                    element={
                      <OrgUnitGuard>
                        <Layout />
                      </OrgUnitGuard>
                    }
                  >
                    <Route index element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]} showAccessDenied>
                        <Dashboard />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.INCIDENTS} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <IncidentList />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.INCIDENTS_NEW} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <CreateIncidentPage />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.INCIDENT_DETAIL} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <IncidentDetail />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.INCIDENT_EDIT} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <EditIncidentPage />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.INCIDENT_CREATE_BAN} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <CreateBanPage />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.BAN_EDIT} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <EditBanPage />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.TEMPLATES} element={
                      <RoleGuard allowedRoles={[...COORDINATOR_ROLES]}>
                        <TemplateList />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.REPORTS} element={
                      <RoleGuard allowedRoles={[...MANAGER_ROLES]}>
                        <Reports />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.PATRONS} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <PatronList />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.PATRON_DETAIL} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <PatronDetail />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.INCIDENT_REVIEWS} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <IncidentReviews />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.BANS} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <PatronBanDetail />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.NOTIFICATIONS} element={
                      <RoleGuard allowedRoles={[...STAFF_ROLES]}>
                        <Notifications />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.REVIEW_PROCESS} element={
                      <RoleGuard allowedRoles={[...MANAGER_ROLES]}>
                        <ReviewChainSettings />
                      </RoleGuard>
                    } />
                    <Route path={ROUTES.PREFERENCES} element={
                      <Preferences />
                    } />
                    <Route path={ROUTES.APPEARANCE} element={
                      <Appearance />
                    } />
                    <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
                  </Route>
                </Routes>
              </AuthGuard>
            }
          />
        </Routes>
      </AppProviders>
    </PageErrorBoundary>
  );
}

export default App;
