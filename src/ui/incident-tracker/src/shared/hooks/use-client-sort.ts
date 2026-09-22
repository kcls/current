import { useMemo } from 'react';
import { useSortState, type SortState } from './use-sort-state';

export type SortValueAccessor<T> = (row: T, key: string) => unknown;

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function useClientSort<T>(
  items: T[],
  getValue: SortValueAccessor<T>,
  initial: SortState = { key: null, dir: 'asc' }
) {
  const { sort, toggleSort } = useSortState(initial);

  const sorted = useMemo(() => {
    if (!sort.key) return items;
    const key = sort.key;
    const copy = [...items];
    copy.sort((a, b) => {
      const av = getValue(a, key);
      const bv = getValue(b, key);
      // Nulls sort last regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const base = compareValues(av, bv);
      return sort.dir === 'asc' ? base : -base;
    });
    return copy;
  }, [items, sort, getValue]);

  return { sorted, sort, toggleSort };
}
