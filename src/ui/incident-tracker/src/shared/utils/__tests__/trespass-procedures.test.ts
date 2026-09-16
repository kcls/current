import { describe, it, expect } from 'vitest';
import type { TrespassProcedureItem } from '../../../types';
import {
  getMissingProcedureLabels,
  isTrespassProceduresComplete,
  isEscapeHatchChecked,
  isItemWaived,
} from '../trespass-procedures';

const item = (
  code: string,
  required: boolean,
  account_dependent: boolean,
  is_escape_hatch = false,
): TrespassProcedureItem => ({
  id: 0,
  code,
  label: code,
  required,
  account_dependent,
  is_escape_hatch,
  display_order: 0,
  is_active: true,
});

const kcls: TrespassProcedureItem[] = [
  item('police_letter_issued', true, false),
  item('letter_mailed', false, false),
  item('evergreen_alert_set', true, true),
  item('account_barred', true, true),
  item('no_computer_access', true, true),
  item('holds_cancelled', true, true),
  item('no_evergreen_account', false, false, true),
];

const allChecked = {
  police_letter_issued: true,
  evergreen_alert_set: true,
  account_barred: true,
  no_computer_access: true,
  holds_cancelled: true,
};

describe('trespass procedures completeness', () => {
  it('passes when all required items checked', () => {
    expect(isTrespassProceduresComplete(kcls, allChecked)).toBe(true);
    expect(getMissingProcedureLabels(kcls, allChecked)).toEqual([]);
  });

  it('optional letter_mailed is not required', () => {
    expect(isTrespassProceduresComplete(kcls, { ...allChecked, letter_mailed: false })).toBe(true);
  });

  it('escape hatch waives account-dependent items', () => {
    const state = { police_letter_issued: true, no_evergreen_account: true };
    expect(isEscapeHatchChecked(kcls, state)).toBe(true);
    expect(isTrespassProceduresComplete(kcls, state)).toBe(true);
  });

  it('escape hatch does not waive the police letter', () => {
    const state = { no_evergreen_account: true };
    expect(isTrespassProceduresComplete(kcls, state)).toBe(false);
    expect(getMissingProcedureLabels(kcls, state)).toContain('police_letter_issued');
  });

  it('missing an account step without escape hatch fails', () => {
    const state = { ...allChecked, holds_cancelled: false };
    expect(isTrespassProceduresComplete(kcls, state)).toBe(false);
    expect(getMissingProcedureLabels(kcls, state)).toEqual(['holds_cancelled']);
  });

  it('empty state fails (nothing checked)', () => {
    expect(isTrespassProceduresComplete(kcls, {})).toBe(false);
  });

  it('no configured items means trivially complete', () => {
    expect(isTrespassProceduresComplete([], {})).toBe(true);
  });

  it('an escape-hatch item marked required is never itself required (config hardening)', () => {
    const cfg: TrespassProcedureItem[] = [
      item('police_letter_issued', true, false),
      item('no_evergreen_account', true, false, true),
    ];
    expect(isTrespassProceduresComplete(cfg, { police_letter_issued: true })).toBe(true);
    expect(getMissingProcedureLabels(cfg, { police_letter_issued: true })).toEqual([]);
  });

  it('with no escape-hatch configured, account steps are always required', () => {
    const cfg: TrespassProcedureItem[] = [
      item('police_letter_issued', true, false),
      item('alert', true, true),
    ];
    expect(isTrespassProceduresComplete(cfg, { police_letter_issued: true })).toBe(false);
    expect(getMissingProcedureLabels(cfg, { police_letter_issued: true, alert: true })).toEqual([]);
  });

  it('isItemWaived flags account-dependent items only when escape hatch checked', () => {
    const evergreen = kcls[2]!;
    const police = kcls[0]!;
    const withEscape = { no_evergreen_account: true };
    expect(isItemWaived(evergreen, kcls, withEscape)).toBe(true);
    expect(isItemWaived(police, kcls, withEscape)).toBe(false);
    expect(isItemWaived(evergreen, kcls, {})).toBe(false);
  });
});
