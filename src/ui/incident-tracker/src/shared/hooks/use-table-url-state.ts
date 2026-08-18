import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

interface TableUrlStateOptions {
  defaultRowsPerPage?: number;
  defaultPage?: number;
}

interface FilterConfig {
  [key: string]: {
    type: 'string' | 'number' | 'boolean';
    defaultValue?: string | number | boolean | null;
    urlKey?: string;
  };
}

export function useTableUrlState(options: TableUrlStateOptions = {}) {
  const { defaultRowsPerPage = 10, defaultPage = 0 } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const page = useMemo(() => {
    const urlPage = searchParams.get('page');
    if (urlPage !== null) {
      const parsed = parseInt(urlPage, 10);
      return isNaN(parsed) || parsed < 1 ? defaultPage : parsed - 1;
    }
    return defaultPage;
  }, [searchParams, defaultPage]);

  const rowsPerPage = useMemo(() => {
    const urlRows = searchParams.get('rows');
    if (urlRows !== null) {
      const parsed = parseInt(urlRows, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return defaultRowsPerPage;
  }, [searchParams, defaultRowsPerPage]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value === null || value === '') {
            newParams.delete(key);
          } else {
            newParams.set(key, value);
          }
        }
        return newParams;
      }, { replace: true });
    },
    [setSearchParams]
  );

  const setPage = useCallback(
    (newPage: number) => {
      // Don't include page=1 in URL (it's the default first page)
      updateParams({ page: newPage === 0 ? null : String(newPage + 1) });
    },
    [updateParams]
  );

  const setRowsPerPage = useCallback(
    (newRowsPerPage: number, newDefaultRowsPerPage: number = defaultRowsPerPage) => {
      // Don't include rows in URL if it's the default
      const rowsValue = newRowsPerPage === newDefaultRowsPerPage ? null : String(newRowsPerPage);
      updateParams({
        rows: rowsValue,
        page: null, // Reset to first page
      });
    },
    [defaultRowsPerPage, updateParams]
  );

  const resetPage = useCallback(() => {
    updateParams({ page: null });
  }, [updateParams]);

  return {
    page,
    rowsPerPage,
    setPage,
    setRowsPerPage,
    resetPage,
    updateParams,
    searchParams,
  };
}

export function useFilterUrlState<T extends FilterConfig>(config: T) {
  const [searchParams, setSearchParams] = useSearchParams();

  type FilterValues = {
    [K in keyof T]: T[K]['type'] extends 'number'
      ? number | null
      : T[K]['type'] extends 'boolean'
      ? boolean
      : string;
  };

  const filters = useMemo(() => {
    const result: Record<string, any> = {};

    for (const [key, cfg] of Object.entries(config)) {
      const urlKey = cfg.urlKey || key;
      const urlValue = searchParams.get(urlKey);

      if (urlValue === null) {
        result[key] = cfg.defaultValue ?? (cfg.type === 'boolean' ? false : cfg.type === 'number' ? null : '');
      } else if (cfg.type === 'number') {
        const parsed = parseInt(urlValue, 10);
        result[key] = isNaN(parsed) ? cfg.defaultValue ?? null : parsed;
      } else if (cfg.type === 'boolean') {
        result[key] = urlValue === 'true' || urlValue === '1';
      } else {
        result[key] = urlValue;
      }
    }

    return result as FilterValues;
  }, [searchParams, config]);

  const setFilter = useCallback(
    <K extends keyof T>(key: K, value: FilterValues[K]) => {
      const cfg = config[key];
      if (!cfg) return;
      const urlKey = cfg.urlKey || String(key);

      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);

        // Reset page when filter changes
        newParams.delete('page');

        // Determine if value is the default (should be removed from URL)
        const isDefault =
          value === cfg.defaultValue ||
          value === null ||
          value === '';

        if (isDefault) {
          newParams.delete(urlKey);
        } else {
          newParams.set(urlKey, String(value));
        }

        return newParams;
      }, { replace: true });
    },
    [config, setSearchParams]
  );

  const setFilters = useCallback(
    (updates: Partial<FilterValues>) => {
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);

        // Reset page when filters change
        newParams.delete('page');

        for (const [key, value] of Object.entries(updates)) {
          const cfg = config[key];
          if (!cfg) continue;

          const urlKey = cfg.urlKey || key;
          const isDefault =
            value === cfg.defaultValue ||
            value === null ||
            value === '';

          if (isDefault) {
            newParams.delete(urlKey);
          } else {
            newParams.set(urlKey, String(value));
          }
        }

        return newParams;
      }, { replace: true });
    },
    [config, setSearchParams]
  );

  const clearFilters = useCallback(() => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams();
      // Keep pagination params
      const rows = prev.get('rows');
      if (rows) {
        newParams.set('rows', rows);
      }
      return newParams;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    filters,
    setFilter,
    setFilters,
    clearFilters,
  };
}
