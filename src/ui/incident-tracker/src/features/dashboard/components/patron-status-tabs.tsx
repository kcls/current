import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Tabs,
  Tab,
  Box,
} from '@mui/material';
import { PatronConsequencePanel } from './patron-consequence-panel';
import { useUserPreferences } from '../../../contexts/user-preferences-context';

interface PatronStatusTabsProps {
  orgUnitId: string | null;
  orgUnitName: string;
}

export const PatronStatusTabs: React.FC<PatronStatusTabsProps> = ({
  orgUnitId,
  orgUnitName,
}) => {
  const { getRowsPerPage, setRowsPerPage } = useUserPreferences();
  const [activeTab, setActiveTab] = useState(0);
  const rowsPerPage = getRowsPerPage('dashboard-patrons', 10);

  const handleRowsPerPageChange = (rows: number) => {
    setRowsPerPage('dashboard-patrons', rows);
  };

  return (
    <Card>
      <CardContent>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Active Trespasses" />
          <Tab label="Active Bans" />
        </Tabs>

        <Box sx={{ mt: 2 }}>
          {activeTab === 0 && (
            <PatronConsequencePanel
              variant="trespasses"
              orgUnitId={orgUnitId}
              orgUnitName={orgUnitName}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={handleRowsPerPageChange}
            />
          )}

          {activeTab === 1 && (
            <PatronConsequencePanel
              variant="bans"
              orgUnitId={orgUnitId}
              orgUnitName={orgUnitName}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={handleRowsPerPageChange}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default PatronStatusTabs;
