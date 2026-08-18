import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { STORAGE_KEYS } from '../shared/utils/storage';

type ThemeMode = 'light' | 'dark' | 'system';

interface AppearancePreferences {
  mode: ThemeMode;
  highContrast: boolean;
}

interface TablePreferences {
  rowsPerPage: number;
}

interface UserPreferencesState {
  tables: Record<string, TablePreferences>;
  appearance: AppearancePreferences;
}

const defaultState: UserPreferencesState = {
  tables: {},
  appearance: { mode: 'system', highContrast: false },
};

interface UserPreferencesContextType {
  appearance: AppearancePreferences;
  getRowsPerPage: (tableId: string, defaultValue?: number) => number;
  setRowsPerPage: (tableId: string, value: number) => void;
  setMode: (mode: ThemeMode) => void;
  setHighContrast: (value: boolean) => void;
}

const UserPreferencesContext = createContext<UserPreferencesContextType | undefined>(undefined);

export const useUserPreferences = (): UserPreferencesContextType => {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider');
  }
  return context;
};

interface UserPreferencesProviderProps {
  children: ReactNode;
}

const loadFromStorage = (): UserPreferencesState => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        tables: parsed.tables ?? {},
        appearance: { ...defaultState.appearance, ...parsed.appearance },
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...defaultState };
};

const saveToStorage = (state: UserPreferencesState): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
};

export function UserPreferencesProvider({ children }: UserPreferencesProviderProps): React.ReactElement {
  const [state, setState] = useState<UserPreferencesState>(loadFromStorage);

  useEffect(() => {
    saveToStorage(state);
  }, [state]);

  const getRowsPerPage = useCallback(
    (tableId: string, defaultValue: number = 10): number => {
      return state.tables[tableId]?.rowsPerPage ?? defaultValue;
    },
    [state.tables]
  );

  const setRowsPerPage = useCallback((tableId: string, value: number): void => {
    setState((prev) => ({
      ...prev,
      tables: {
        ...prev.tables,
        [tableId]: { rowsPerPage: value },
      },
    }));
  }, []);

  const setMode = useCallback((mode: ThemeMode): void => {
    setState((prev) => ({
      ...prev,
      appearance: { ...prev.appearance, mode },
    }));
  }, []);

  const setHighContrast = useCallback((highContrast: boolean): void => {
    setState((prev) => ({
      ...prev,
      appearance: { ...prev.appearance, highContrast },
    }));
  }, []);

  const value: UserPreferencesContextType = {
    appearance: state.appearance,
    getRowsPerPage,
    setRowsPerPage,
    setMode,
    setHighContrast,
  };

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
}

export type { ThemeMode, AppearancePreferences };
