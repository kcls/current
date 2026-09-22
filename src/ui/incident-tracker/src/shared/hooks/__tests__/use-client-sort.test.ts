import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClientSort } from '../use-client-sort';

interface Row {
  id: number;
  name: string;
  score: number | null;
}

const rows: Row[] = [
  { id: 3, name: 'Charlie', score: 10 },
  { id: 1, name: 'alice', score: null },
  { id: 2, name: 'Bob', score: 5 },
];

const getValue = (row: Row, key: string) =>
  key === 'name' ? row.name : key === 'score' ? row.score : row.id;

describe('useClientSort', () => {
  it('returns the original order when no column is active', () => {
    const { result } = renderHook(() => useClientSort(rows, getValue));
    expect(result.current.sorted.map((r) => r.id)).toEqual([3, 1, 2]);
  });

  it('sorts strings case-insensitively via locale compare', () => {
    const { result } = renderHook(() => useClientSort(rows, getValue));
    act(() => result.current.toggleSort('name'));
    expect(result.current.sorted.map((r) => r.name)).toEqual(['alice', 'Bob', 'Charlie']);
  });

  it('flips direction on the second toggle', () => {
    const { result } = renderHook(() => useClientSort(rows, getValue));
    act(() => result.current.toggleSort('id'));
    act(() => result.current.toggleSort('id'));
    expect(result.current.sorted.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it('keeps nulls last regardless of direction', () => {
    const { result } = renderHook(() => useClientSort(rows, getValue));
    act(() => result.current.toggleSort('score')); // asc
    expect(result.current.sorted.map((r) => r.id)).toEqual([2, 3, 1]);
    act(() => result.current.toggleSort('score')); // desc
    expect(result.current.sorted.map((r) => r.id)).toEqual([3, 2, 1]);
  });
});
