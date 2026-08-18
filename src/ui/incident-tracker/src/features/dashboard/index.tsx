import React, { useEffect, useState, useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../../constants';
import { useAuth } from '../../contexts/auth-context';
import { useLocations } from '../../contexts/location-context';
import { useIncidents } from '../../contexts/incidents-context';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  CircularProgress,
  Button,
  Link,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  LocationOn as LocationIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { PatronStatusTabs } from './components/patron-status-tabs';
import { Incident } from '../../types';
import { authApi as coreAuthApi } from '@core';
import { getPatronNames } from '../../shared/utils/patron-utils';
import { getRegionOrgUnit } from '../../shared/utils/location-utils';
import { LinkTableRow, LinkTableCell } from '../../shared/components/link-table-row';

const Dashboard: React.FC = () => {
  const { incidents, isLoading, fetchIncidents } = useIncidents();
  const { locations } = useLocations();
  const { user } = useAuth();

  const [recentIncidents, setRecentIncidents] = useState<Incident[]>([]);

  // Helper function to get org unit name
  const getOrgUnitName = (orgUnitUuid: string | null | undefined): string => {
    if (!orgUnitUuid) return '';
    const location = locations.find(loc => loc.uuid === orgUnitUuid);
    return location?.display_label || location?.label || '';
  };

  const userOrgUnitId = coreAuthApi.getOrgUnit();
  const orgUnitName = getOrgUnitName(userOrgUnitId);
  const regionOrgUnitId = useMemo(() => {
    if (!userOrgUnitId || locations.length === 0) return null;
    return getRegionOrgUnit(userOrgUnitId, locations);
  }, [userOrgUnitId, locations]);
  const regionName = getOrgUnitName(regionOrgUnitId);

  useEffect(() => {
    if (locations.length === 0) return;

    fetchIncidents({
      limit: 20,
      page: 1,
      with_involved_parties: true,
      org_unit: regionOrgUnitId
    });
  }, [locations, regionOrgUnitId, fetchIncidents]);

  useEffect(() => {
    setRecentIncidents(incidents.slice(0, 20));
  }, [incidents]);


  const formatTime = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  if (isLoading) {
    return (
      <PageContainer>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="lg">
      <Box mb={3} display="flex" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" gutterBottom>
            Welcome, {user?.display_name || user?.username || 'User'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <LocationIcon sx={{ fontSize: 16, verticalAlign: 'middle', mr: 0.5 }} />
            {orgUnitName}
          </Typography>
        </Box>
        <Button
          component={RouterLink}
          to={ROUTES.INCIDENTS_NEW}
          variant="contained"
          startIcon={<AddIcon />}
        >
          New Incident
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Patron Status - Trespasses & Bans */}
        <Grid size={12}>
          <PatronStatusTabs orgUnitId={userOrgUnitId ?? null} orgUnitName={orgUnitName} />
        </Grid>

        {/* Recent Incidents - Full Width */}
        <Grid size={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Incidents {regionName && <Typography component="span" variant="body2" color="text.secondary">({regionName})</Typography>}
              </Typography>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 650 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell width="70px">ID</TableCell>
                      <TableCell>Title</TableCell>
                      <TableCell width="180px">Location</TableCell>
                      <TableCell>Patron</TableCell>
                      <TableCell width="180px">Occurred</TableCell>
                      <TableCell width="180px">Review Complete</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentIncidents.map((incident) => (
                      <LinkTableRow
                        key={incident.id}
                        to={`/incidents/${incident.id}`}
                        hover
                      >
                        <LinkTableCell>
                          <Typography variant="body2" fontWeight="medium">
                            #{incident.id}
                          </Typography>
                        </LinkTableCell>
                        <LinkTableCell>
                          <Typography variant="body2">
                            {incident.title || 'General Incident'}
                          </Typography>
                        </LinkTableCell>
                        <LinkTableCell>
                          <Typography variant="body2" color="text.secondary">
                            {incident.org_unit_name || 'Unknown'}
                          </Typography>
                        </LinkTableCell>
                        <LinkTableCell>
                          <Typography variant="body2" color="text.secondary">
                            {getPatronNames(incident)}
                          </Typography>
                        </LinkTableCell>
                        <LinkTableCell>
                          <Typography variant="body2" color="text.secondary">
                            {formatTime(incident.occurred_at)}
                          </Typography>
                        </LinkTableCell>
                        <LinkTableCell>
                          <Typography variant="body2" color="text.secondary">
                            {incident.resolved_at ? formatTime(incident.resolved_at) : '-'}
                          </Typography>
                        </LinkTableCell>
                      </LinkTableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {recentIncidents.length > 0 && (
                <Box textAlign="center" mt={2}>
                  <Link
                    component={RouterLink}
                    to={ROUTES.INCIDENTS}
                    variant="body2"
                  >
                    View All Incidents
                  </Link>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

      </Grid>
    </PageContainer>
  );
};

export default Dashboard;
