import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useFilterUrlState, useTableUrlState } from '../use-table-url-state';

const wrap = ({ children }: React.PropsWithChildren) =>
  React.createElement(MemoryRouter, { initialEntries: ['/'] }, children);

const config = {
  scope: { type: 'number' as const, defaultValue: 0 },
  scopeCode: { type: 'string' as const, defaultValue: '', urlKey: 'loc' },
  type: { type: 'number' as const, defaultValue: 0 },
};

describe('useFilterUrlState', () => {
  it('records a filter change', () => {
    const { result } = renderHook(() => useFilterUrlState(config), { wrapper: wrap });
    act(() => { result.current.setFilter('type', 2); });
    expect(result.current.filters.type).toBe(2);
  });

  it('records several filters at once', () => {
    const { result } = renderHook(() => useFilterUrlState(config), { wrapper: wrap });
    act(() => { result.current.setFilters({ scope: 6, scopeCode: 'BE' }); });
    expect(result.current.filters.scope).toBe(6);
    expect(result.current.filters.scopeCode).toBe('BE');
  });

  it('clears a filter back to its default', () => {
    const { result } = renderHook(() => useFilterUrlState(config), { wrapper: wrap });
    act(() => { result.current.setFilter('type', 2); });
    act(() => { result.current.setFilter('type', 0); });
    expect(result.current.filters.type).toBe(0);
  });

  /**
   * Regression: setFilter and setPage both write the URL through a
   * functional setSearchParams. Called in the same handler, the second
   * reads a `prev` React Router has not committed yet, so it overwrites
   * the first — the filter silently did nothing.
   *
   * setFilter/setFilters already clear the page param, so callers must not
   * pair them with setPage. This test pins that they cannot be combined,
   * so nobody reintroduces the pairing believing it is harmless.
   */
  it('loses the filter if setPage is called in the same handler', () => {
    const { result } = renderHook(
      () => ({
        f: useFilterUrlState(config),
        t: useTableUrlState({ defaultRowsPerPage: 25 }),
      }),
      { wrapper: wrap },
    );

    act(() => {
      result.current.f.setFilter('type', 2);
      result.current.t.setPage(0);
    });

    expect(result.current.f.filters.type).toBe(0);
  });

  it('resets the page on its own, so no setPage pairing is needed', () => {
    const { result } = renderHook(
      () => ({
        f: useFilterUrlState(config),
        t: useTableUrlState({ defaultRowsPerPage: 25 }),
      }),
      { wrapper: wrap },
    );

    act(() => { result.current.t.setPage(3); });
    expect(result.current.t.page).toBe(3);

    act(() => { result.current.f.setFilter('type', 2); });
    expect(result.current.f.filters.type).toBe(2);
    expect(result.current.t.page).toBe(0);
  });
});
