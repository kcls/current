import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Link } from '@mui/material';
import { PatronTable } from './patron-table';
import { patronApi } from '../../../api/patrons';
import { ROUTES } from '../../../constants';
import { useSortState } from '../../../shared/hooks/use-sort-state';
import { useLocations } from '../../../contexts/location-context';
import { getRootOrgUnit } from '../../../shared/utils/location-utils';
import type { PatronSearchResult } from '../../../types/patron';

interface Props {
  variant: 'trespasses' | 'bans';
  orgUnitId: string | null;
  orgUnitName: string;
  rowsPerPage: number;
  onRowsPerPageChange: (rows: number) => void;
}

export const PatronConsequencePanel: React.FC<Props> = ({
  variant,
  orgUnitId,
  orgUnitName,
  rowsPerPage,
  onRowsPerPageChange,
}) => {
  const isTrespass = variant === 'trespasses';
  const { locations } = useLocations();

  const filterHref = useMemo(() => {
    const scopeId = isTrespass ? getRootOrgUnit(locations)?.uuid : orgUnitId;
    const locationCode = locations.find((l) => l.uuid === scopeId)?.code ?? null;
    const params = new URLSearchParams({
      consequence: isTrespass ? 'trespass' : 'ban',
      hide_unknown: 'false',
    });
    if (locationCode) params.set('location', locationCode);
    return `${ROUTES.PATRONS}?${params.toString()}`;
  }, [isTrespass, locations, orgUnitId]);

  const [page, setPage] = useState(0);
  const { sort, toggleSort } = useSortState({ key: 'lift_date', dir: 'asc' });

  const resetPage = () => setPage(0);

  const [patrons, setPatrons] = useState<PatronSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(isTrespass || orgUnitId !== null);

  // Trespasses are unscoped; bans are scoped to the working location
  const effectiveOrgUnit = isTrespass ? undefined : orgUnitId ?? undefined;

  useEffect(() => {
    if (!isTrespass && !effectiveOrgUnit) return;

    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const response = await patronApi.search({
          [isTrespass ? 'has_visible_trespass' : 'has_active_bans']: true,
          org_unit: effectiveOrgUnit,
          page: page + 1,
          limit: rowsPerPage,
          sort_by: sort.key ?? 'lift_date',
          sort_dir: sort.dir,
        });
        if (cancelled) return;
        setPatrons(response.items);
        setTotal(response.total);
      } catch (error) {
        if (!cancelled) console.error(`Failed to load ${variant}:`, error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isTrespass, effectiveOrgUnit, page, rowsPerPage, sort.key, sort.dir, variant]);

  return (
    <>
      <PatronTable
        patrons={patrons}
        total={total}
        page={page}
        rowsPerPage={rowsPerPage}
        loading={loading}
        emptyMessage={isTrespass ? 'No active trespasses' : `No active bans at ${orgUnitName}`}
        variant={variant}
        onPageChange={setPage}
        onRowsPerPageChange={(rows) => {
          onRowsPerPageChange(rows);
          resetPage();
        }}
        getRowHref={(patronId) => `/patrons/${patronId}`}
        sort={sort}
        onSort={(key) => {
          toggleSort(key);
          resetPage();
        }}
      />

      {/* revisit this later
      <Box sx={{ mt: 1.5, textAlign: 'center' }}>
        <Link component={RouterLink} to={filterHref} variant="body2">
          Filter {isTrespass ? 'trespasses' : 'bans'} on the Patrons page
        </Link>
      </Box>
      */}
    </>
  );
};

export default PatronConsequencePanel;
