import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Incident, IncidentFormData, ListResponse } from '../types';
import { incidentApi } from '../api/incidents';
import type { ExternalLinkFormData } from '../features/incidents/components/external-link-dialog';

interface IncidentsContextType {
  incidents: Incident[];
  currentIncident: Incident | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  totalCount: number;

  fetchIncidents: (filters?: any) => Promise<void>;
  fetchIncident: (id: number) => Promise<Incident>;
  createIncident: (data: IncidentFormData) => Promise<Incident & {
    created_ban_ids?: number[];
    extended_ban_ids?: number[];
  }>;
  updateIncident: (id: number, data: Partial<Incident>, options?: {
    add_involved_parties?: any[];
    remove_involved_parties?: number[];
    add_external_links?: ExternalLinkFormData[];
    remove_external_links?: number[];
  }) => Promise<Incident>;
  setCurrentIncident: (incident: Incident | null) => void;
  clearError: () => void;
}

const IncidentsContext = createContext<IncidentsContextType | null>(null);

export const IncidentsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [currentIncident, setCurrentIncident] = useState<Incident | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchIncidents = useCallback(async (filters?: any) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await incidentApi.searchV2({
        is_resolved: filters?.status === 'resolved' ? true : filters?.status === 'open' ? false : undefined,
        org_unit: filters?.org_unit || undefined,
        query: filters?.search,
        page: filters?.page || 1,
        limit: filters?.limit || 20,
        with_involved_parties: filters?.with_involved_parties
      });

      setIncidents(result.items);
      setTotalCount(result.total);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch incidents');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchIncident = useCallback(async (id: number): Promise<Incident> => {
    setIsLoading(true);
    setError(null);
    try {
      const incident = await incidentApi.get(id);
      setCurrentIncident(incident);
      return incident;
    } catch (err: any) {
      setError(err.message || 'Failed to fetch incident');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createIncident = useCallback(async (data: IncidentFormData): Promise<Incident & {
    created_ban_ids?: number[];
    extended_ban_ids?: number[];
  }> => {
    setIsSaving(true);
    setError(null);
    try {
      const newIncident = await incidentApi.create(data);
      setIncidents(prev => [newIncident, ...prev]);
      setTotalCount(prev => prev + 1);
      return newIncident;
    } catch (err: any) {
      setError(err.message || 'Failed to create incident');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, []);

  const updateIncident = useCallback(async (
    id: number,
    data: Partial<Incident>,
    options?: {
      add_involved_parties?: any[];
      remove_involved_parties?: number[];
      add_external_links?: ExternalLinkFormData[];
      remove_external_links?: number[];
    }
  ): Promise<Incident> => {
    setIsSaving(true);
    setError(null);
    try {
      const updatedIncident = await incidentApi.update(id, data, options);
      setIncidents(prev => prev.map(i => i.id === id ? updatedIncident : i));
      if (currentIncident?.id === id) {
        setCurrentIncident(updatedIncident);
      }
      return updatedIncident;
    } catch (err: any) {
      setError(err.message || 'Failed to update incident');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [currentIncident?.id]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <IncidentsContext.Provider value={{
      incidents,
      currentIncident,
      isLoading,
      isSaving,
      error,
      totalCount,
      fetchIncidents,
      fetchIncident,
      createIncident,
      updateIncident,
      setCurrentIncident,
      clearError,
    }}>
      {children}
    </IncidentsContext.Provider>
  );
};

export const useIncidents = (): IncidentsContextType => {
  const context = useContext(IncidentsContext);
  if (!context) {
    throw new Error('useIncidents must be used within an IncidentsProvider');
  }
  return context;
};
