import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocations } from '../../contexts/location-context';
import { authApi as coreAuthApi } from '@core';
import { getRegionOrgUnit } from '../utils/location-utils';

interface UseLocationFilterOptions<K extends string = string> {
  urlParamKey?: K;
  autoSetDefault?: boolean;
  setFilter: (key: K, value: string) => void;
  filterValue: string;
}

interface UseLocationFilterReturn {
  locationCode: string;
  /** Selected location's org-unit uuid (null = all locations). */
  locationId: string | null;
  setLocationCode: (code: string | null) => void;
  setLocationId: (id: string | null) => void;
  userDefaultCode: string | null;
  userDefaultId: string | null;
  isInitialized: boolean;
  resetToDefault: () => void;
}

export function useLocationFilter<K extends string = 'location'>({
  urlParamKey = 'location' as K,
  autoSetDefault = true,
  setFilter,
  filterValue,
}: UseLocationFilterOptions<K>): UseLocationFilterReturn {
  const { locations } = useLocations();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const sessionData = coreAuthApi.getSessionData();
  const userOrgUnitId = sessionData?.org_unit ?? null;

  const userDefaultId = useMemo(() => {
    if (!userOrgUnitId || locations.length === 0) return null;
    return getRegionOrgUnit(userOrgUnitId, locations);
  }, [userOrgUnitId, locations]);

  const userDefaultCode = useMemo(() => {
    if (!userDefaultId || locations.length === 0) return null;
    const loc = locations.find(l => l.uuid === userDefaultId);
    return loc?.code ?? null;
  }, [userDefaultId, locations]);

  useEffect(() => {
    if (locations.length === 0) return;

    if (!filterValue && autoSetDefault && userDefaultCode) {
      setFilter(urlParamKey, userDefaultCode);
      setLocationId(userDefaultId);
    } else if (filterValue) {
      const loc = locations.find(l => l.code === filterValue);
      if (loc) setLocationId(loc.uuid);
    } else {
      setLocationId(null);
    }

    if (!isInitialized) setIsInitialized(true);
  }, [locations, filterValue, autoSetDefault, userDefaultCode, userDefaultId, setFilter, urlParamKey, isInitialized]);

  const setLocationCode = useCallback((code: string | null) => {
    setFilter(urlParamKey, code || '');
    if (code) {
      const loc = locations.find(l => l.code === code);
      if (loc) setLocationId(loc.uuid);
    } else {
      setLocationId(null);
    }
  }, [setFilter, urlParamKey, locations]);

  const resetToDefault = useCallback(() => {
    if (userDefaultCode) {
      setFilter(urlParamKey, userDefaultCode);
      setLocationId(userDefaultId);
    }
  }, [setFilter, urlParamKey, userDefaultCode, userDefaultId]);

  return {
    locationCode: filterValue,
    locationId,
    setLocationCode,
    setLocationId,
    userDefaultCode,
    userDefaultId,
    isInitialized,
    resetToDefault,
  };
}
