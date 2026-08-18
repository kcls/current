import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode, useRef } from 'react';
import { OrgUnit, SubLocation } from '../types';
import { orgUnitApi } from '../api';
import { subLocationApi } from '../api/sub-locations';
import { authApi } from '@core';
import { useAuth } from './auth-context';
import { setLibraryTimezone } from '../shared/utils/date-utils';

interface LocationContextValue {
  locations: OrgUnit[];
  subLocations: SubLocation[];
  isLoading: boolean;
  isLoadingSubLocations: boolean;
  error: string | null;
  fetchLocations: () => Promise<void>;
  fetchSubLocationsByOrgUnit: (orgUnitUuid: string) => Promise<void>;
  getLocationByCode: (code: string) => OrgUnit | undefined;
  getLocationById: (id: number) => OrgUnit | undefined;
}

const LocationContext = createContext<LocationContextValue | null>(null);

const pendingFetches = new Map<string, Promise<SubLocation[]>>();

export function LocationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [locations, setLocations] = useState<OrgUnit[]>([]);
  const [subLocations, setSubLocations] = useState<SubLocation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSubLocations, setIsLoadingSubLocations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);

  const fetchLocationsData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const orgUnitTree = await orgUnitApi.getOrgUnitTree();
      const flattened = orgUnitApi.flattenOrgUnits(orgUnitTree);

      const orgUnits: OrgUnit[] = flattened.map(unit => ({
        id: unit.id,
        uuid: unit.uuid,
        parent: unit.parent,
        label: unit.label,
        code: unit.code,
        display_label: unit.display_label,
        unit_type: unit.unit_type.id,
        unit_type_label: unit.unit_type.label,
        unit_type_object: unit.unit_type,
        deleted_at: unit.deleted_at,
        is_active: unit.deleted_at === null,
        timezone: (unit as any).timezone ?? undefined,
      }));

      setLocations(orgUnits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch locations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchSubLocationsByOrgUnit = useCallback(async (orgUnitUuid: string) => {
    if (pendingFetches.has(orgUnitUuid)) {
      const result = await pendingFetches.get(orgUnitUuid)!;
      setSubLocations(result);
      return;
    }

    setIsLoadingSubLocations(true);
    setError(null);

    const fetchPromise = subLocationApi.getByOrgUnit(orgUnitUuid);
    pendingFetches.set(orgUnitUuid, fetchPromise);

    try {
      const result = await fetchPromise;
      setSubLocations(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sub-locations');
    } finally {
      pendingFetches.delete(orgUnitUuid);
      setIsLoadingSubLocations(false);
    }
  }, []);

  const getLocationByCode = useCallback((code: string) => {
    return locations.find(loc => loc.code === code);
  }, [locations]);

  const getLocationById = useCallback((id: number) => {
    return locations.find(loc => loc.id === id);
  }, [locations]);

  useEffect(() => {
    if (isAuthenticated && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchLocationsData();
    }
    if (!isAuthenticated) {
      hasFetchedRef.current = false;
      setLocations([]);
    }
  }, [isAuthenticated, fetchLocationsData]);

  useEffect(() => {
    if (locations.length === 0) return;
    const orgUnitUuid = authApi.getOrgUnit();
    if (!orgUnitUuid) return;
    const loc = locations.find(l => l.uuid === orgUnitUuid);
    if (loc?.timezone) {
      setLibraryTimezone(loc.timezone);
    }
  }, [locations]);

  const value = useMemo(() => ({
    locations,
    subLocations,
    isLoading,
    isLoadingSubLocations,
    error,
    fetchLocations: fetchLocationsData,
    fetchSubLocationsByOrgUnit,
    getLocationByCode,
    getLocationById,
  }), [locations, subLocations, isLoading, isLoadingSubLocations, error, fetchLocationsData, fetchSubLocationsByOrgUnit, getLocationByCode, getLocationById]);

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocations() {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useLocations must be used within a LocationProvider');
  }
  return context;
}
