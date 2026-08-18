import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { IncidentTemplate } from '../types';
import { templateApi } from '../api/templates';

interface TemplatesContextType {
  templates: IncidentTemplate[];
  currentTemplate: IncidentTemplate | null;
  isLoading: boolean;
  error: string | null;
  totalCount: number;
  categories: string[];

  fetchTemplates: (filters?: { category?: string; is_active?: boolean }) => Promise<void>;
  fetchTemplate: (id: number) => Promise<IncidentTemplate>;
  setCurrentTemplate: (template: IncidentTemplate | null) => void;
  clearError: () => void;
}

const TemplatesContext = createContext<TemplatesContextType | null>(null);

export const TemplatesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [templates, setTemplates] = useState<IncidentTemplate[]>([]);
  const [currentTemplate, setCurrentTemplate] = useState<IncidentTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);

  const fetchTemplates = useCallback(async (filters?: { category?: string; is_active?: boolean }) => {
    setIsLoading(true);
    setError(null);
    try {
      let result: IncidentTemplate[];

      if (filters?.is_active === true) {
        result = await templateApi.getActive();
      } else {
        result = await templateApi.getAll();
      }

      if (filters?.category) {
        result = result.filter(t => t.category === filters.category);
      }

      // Extract unique categories
      const uniqueCategories = Array.from(new Set(result.map(t => t.category)));

      setTemplates(result);
      setTotalCount(result.length);
      setCategories(uniqueCategories);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch templates');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchTemplate = useCallback(async (id: number): Promise<IncidentTemplate> => {
    setIsLoading(true);
    setError(null);
    try {
      const template = await templateApi.get(id);
      setCurrentTemplate(template);
      return template;
    } catch (err: any) {
      setError(err.message || 'Failed to fetch template');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <TemplatesContext.Provider value={{
      templates,
      currentTemplate,
      isLoading,
      error,
      totalCount,
      categories,
      fetchTemplates,
      fetchTemplate,
      setCurrentTemplate,
      clearError,
    }}>
      {children}
    </TemplatesContext.Provider>
  );
};

export const useTemplates = (): TemplatesContextType => {
  const context = useContext(TemplatesContext);
  if (!context) {
    throw new Error('useTemplates must be used within a TemplatesProvider');
  }
  return context;
};
