import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { authApi } from '@core';
import * as authContext from '../../../contexts/auth-context';
import { usePerm, useWorkingLocationPerm } from '../use-perm';

vi.mock('../../../contexts/auth-context', async () => {
  const actual = await vi.importActual('../../../contexts/auth-context');
  return { ...actual, useAuth: vi.fn() };
});

const mockUseAuth = vi.mocked(authContext.useAuth);
// Both are vi.fn()s from the global @core mock in tests/setup.ts.
const hasPerm = vi.mocked(authApi.userHasPerm);
const getOrgUnit = vi.mocked(authApi.getOrgUnit);

function signedIn(uuid = 'user-1') {
  mockUseAuth.mockReturnValue({
    user: { id: 1, uuid, username: 'u', email: 'u@example.org' },
  } as unknown as ReturnType<typeof authContext.useAuth>);
}

describe('usePerm', () => {
  beforeEach(() => {
    hasPerm.mockReset().mockResolvedValue(false);
    signedIn();
  });

  it('asks the server at the given org unit and returns its answer', async () => {
    hasPerm.mockResolvedValue(true);
    const { result } = renderHook(() => usePerm('current.ban.write', 'ou-1'));

    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(hasPerm).toHaveBeenCalledWith('current.ban.write', 'ou-1');
  });

  it('checks with no org unit when given null', async () => {
    hasPerm.mockResolvedValue(true);
    const { result } = renderHook(() => usePerm('current.patron.write', null));

    await waitFor(() => expect(result.current).toBe(true));
    expect(hasPerm).toHaveBeenCalledWith('current.patron.write', undefined);
  });

  it('asks nothing and stays false while the org unit is unknown', () => {
    const { result } = renderHook(() => usePerm('current.ban.write', undefined));

    expect(result.current).toBe(false);
    expect(hasPerm).not.toHaveBeenCalled();
  });

  it('stays false when the server says no', async () => {
    hasPerm.mockResolvedValue(false);
    const { result } = renderHook(() => usePerm('current.incident.write', 'ou-1'));

    await waitFor(() => expect(hasPerm).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('asks nothing when nobody is signed in', () => {
    mockUseAuth.mockReturnValue({ user: null } as unknown as ReturnType<typeof authContext.useAuth>);
    const { result } = renderHook(() => usePerm('current.incident.write', 'ou-1'));

    expect(result.current).toBe(false);
    expect(hasPerm).not.toHaveBeenCalled();
  });

  it('re-asks when the org unit changes, dropping the old answer', async () => {
    hasPerm.mockImplementation(async (_perm: string, ou?: string) => ou === 'ou-1');
    const { result, rerender } = renderHook(
      ({ ou }: { ou: string }) => usePerm('current.ban.write', ou),
      { initialProps: { ou: 'ou-1' } },
    );
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ ou: 'ou-2' });
    expect(result.current).toBe(false);
    await waitFor(() => expect(hasPerm).toHaveBeenCalledWith('current.ban.write', 'ou-2'));
    expect(result.current).toBe(false);
  });
});

describe('useWorkingLocationPerm', () => {
  beforeEach(() => {
    hasPerm.mockReset().mockResolvedValue(false);
    signedIn();
  });

  it('checks at the working location', async () => {
    getOrgUnit.mockReturnValue('working-ou');
    hasPerm.mockResolvedValue(true);
    const { result } = renderHook(() => useWorkingLocationPerm('current.incident.write'));

    await waitFor(() => expect(result.current).toBe(true));
    expect(hasPerm).toHaveBeenCalledWith('current.incident.write', 'working-ou');
  });

  it('is false without asking when there is no working location', () => {
    getOrgUnit.mockReturnValue(undefined);
    const { result } = renderHook(() => useWorkingLocationPerm('current.incident.write'));

    expect(result.current).toBe(false);
    expect(hasPerm).not.toHaveBeenCalled();
  });
});
