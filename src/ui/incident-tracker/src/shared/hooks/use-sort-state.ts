import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string | null;
  dir: SortDir;
}

export function nextSort(prev: SortState, key: string): { key: string; dir: SortDir } {
  if (prev.key !== key) return { key, dir: 'asc' };
  return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
}

export function useSortState(initial: SortState = { key: null, dir: 'asc' }) {
  const [sort, setSort] = useState<SortState>(initial);
  const toggleSort = useCallback(
    (key: string) => setSort((prev) => nextSort(prev, key)),
    []
  );
  return { sort, toggleSort };
}

export function useSortUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = useMemo<SortState>(() => {
    const key = searchParams.get('sort');
    if (!key) return { key: null, dir: 'asc' };
    const dir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
    return { key, dir };
  }, [searchParams]);

  const toggleSort = useCallback(
    (key: string) => {
      const next = nextSort(sort, key);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.delete('page');
          params.set('sort', next.key);
          params.set('dir', next.dir);
          return params;
        },
        { replace: true }
      );
    },
    [sort, setSearchParams]
  );

  return { sort, toggleSort };
}
