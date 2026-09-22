import { describe, it, expect } from 'vitest';
import { nextSort, type SortState } from '../use-sort-state';

const cleared: SortState = { key: null, dir: 'asc' };

describe('nextSort', () => {
  it('starts a new column ascending', () => {
    expect(nextSort(cleared, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });

  it('switches to descending on the second click of the same column', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({
      key: 'name',
      dir: 'desc',
    });
  });

  it('flips back to ascending on the third click (no unsorted state)', () => {
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({
      key: 'name',
      dir: 'asc',
    });
  });

  it('resets to ascending when switching columns', () => {
    expect(nextSort({ key: 'name', dir: 'desc' }, 'lift_date')).toEqual({
      key: 'lift_date',
      dir: 'asc',
    });
  });
});
