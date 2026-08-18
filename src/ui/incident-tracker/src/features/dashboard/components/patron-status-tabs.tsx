import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Tabs,
  Tab,
  Box,
} from '@mui/material';
import { PatronTable } from './patron-table';
import { patronApi } from '../../../api/patrons';
import { useUserPreferences } from '../../../contexts/user-preferences-context';
import type { PatronSearchResult } from '../../../types/patron';

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
  const [trespassPage, setTrespassPage] = useState(0);
  const [banPage, setBanPage] = useState(0);
  const rowsPerPage = getRowsPerPage('dashboard-patrons', 10);

  // Trespasses state
  const [trespasses, setTrespasses] = useState<PatronSearchResult[]>([]);
  const [trespassTotal, setTrespassTotal] = useState(0);
  const [trespassLoading, setTrespassLoading] = useState(false);

  // Bans state
  const [bans, setBans] = useState<PatronSearchResult[]>([]);
  const [banTotal, setBanTotal] = useState(0);
  const [banLoading, setBanLoading] = useState(false);

  // Load trespasses
  useEffect(() => {
    const loadTrespasses = async () => {
      try {
        setTrespassLoading(true);

        const response = await patronApi.search({
          has_visible_trespass: true,
          page: trespassPage + 1,
          limit: rowsPerPage,
          sort_lift_date: true,
          sort_dir: 'asc',
        });

        setTrespasses(response.items);
        setTrespassTotal(response.total);
      } catch (error) {
        console.error('Failed to load trespasses:', error);
      } finally {
        setTrespassLoading(false);
      }
    };

    loadTrespasses();
  }, [trespassPage, rowsPerPage]);

  // Load bans at working location
  useEffect(() => {
    const loadBans = async () => {
      if (!orgUnitId) return;

      try {
        setBanLoading(true);

        const response = await patronApi.search({
          has_active_bans: true,
          org_unit: orgUnitId,
          page: banPage + 1,
          limit: rowsPerPage,
          sort_lift_date: true,
          sort_dir: 'asc',
        });

        setBans(response.items);
        setBanTotal(response.total);
      } catch (error) {
        console.error('Failed to load bans:', error);
      } finally {
        setBanLoading(false);
      }
    };

    loadBans();
  }, [orgUnitId, banPage, rowsPerPage]);

  return (
    <Card>
      <CardContent>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Active Trespasses" />
          <Tab label="Active Bans" />
        </Tabs>

        <Box sx={{ mt: 2 }}>
          {activeTab === 0 && (
            <PatronTable
              patrons={trespasses}
              total={trespassTotal}
              page={trespassPage}
              rowsPerPage={rowsPerPage}
              loading={trespassLoading}
              emptyMessage="No active trespasses"
              variant="trespasses"
              onPageChange={(page) => setTrespassPage(page)}
              onRowsPerPageChange={(rows) => {
                setRowsPerPage('dashboard-patrons', rows);
                setTrespassPage(0);
              }}
              getRowHref={(patronId) => `/patrons/${patronId}`}
            />
          )}

          {activeTab === 1 && (
            <PatronTable
              patrons={bans}
              total={banTotal}
              page={banPage}
              rowsPerPage={rowsPerPage}
              loading={banLoading}
              emptyMessage={`No active bans at ${orgUnitName}`}
              variant="bans"
              onPageChange={(page) => setBanPage(page)}
              onRowsPerPageChange={(rows) => {
                setRowsPerPage('dashboard-patrons', rows);
                setBanPage(0);
              }}
              getRowHref={(patronId) => `/patrons/${patronId}`}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default PatronStatusTabs;
