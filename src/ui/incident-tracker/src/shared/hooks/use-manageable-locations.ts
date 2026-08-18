import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/auth-context';
import { useLocations } from '../../contexts/location-context';
import { orgUnitApi } from '@core/api/org-units';
import { MANAGER_ROLES } from '../utils/roles';
import type { OrgUnit } from '../../types';

interface UseManageableLocationsReturn {
  manageableLocations: OrgUnit[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to get locations that the current user can manage based on their roles.
 * Returns org units where user has manager roles, filtered to only include
 * locations that can have patrons (e.g., branches, not administrative units).
 */
export function useManageableLocations(): UseManageableLocationsReturn {
  const { user } = useAuth();
  const { locations, isLoading: locationsLoading } = useLocations();
  const [manageableLocations, setManageableLocations] = useState<OrgUnit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const loadManageableLocations = async () => {
      if (!locations.length || !user?.roles) {
        setManageableLocations([]);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const byRoles = await orgUnitApi.getAccessibleOrgUnits(
          locations,
          user.roles,
          [...MANAGER_ROLES]
        ) as OrgUnit[];
        const filtered = byRoles.filter(
          (loc: OrgUnit) => loc.unit_type_object?.can_have_patrons === true
        );
        setManageableLocations(filtered);
      } catch (err) {
        console.error('Failed to load manageable locations:', err);
        setError(err instanceof Error ? err : new Error('Failed to load manageable locations'));
        setManageableLocations([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadManageableLocations();
  }, [user?.roles, locations]);

  return {
    manageableLocations,
    isLoading: locationsLoading || isLoading,
    error,
  };
}
