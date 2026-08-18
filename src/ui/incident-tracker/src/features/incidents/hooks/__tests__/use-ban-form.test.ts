import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBanForm, getDefaultPerPatronData, type PerPatronFormData } from '../use-ban-form';

const uncheckedViolations = `
  <div class="tmpl-violation-item"><span class="tmpl-checkbox"></span><span>Unsafe behavior</span></div>
  <div class="tmpl-violation-item"><span class="tmpl-checkbox"></span><span>Illegal behavior</span></div>`;

const checkedViolations = `
  <div class="tmpl-violation-item"><span class="tmpl-checkbox tmpl-checked"></span><span>Unsafe behavior</span></div>
  <div class="tmpl-violation-item"><span class="tmpl-checkbox"></span><span>Illegal behavior</span></div>`;

function setup(data: Partial<PerPatronFormData>) {
  const hook = renderHook(() =>
    useBanForm({ templates: [], incident: null, patronDetailsMap: {} }),
  );
  act(() => {
    hook.result.current.setFormDataPerPatron({
      p1: { ...getDefaultPerPatronData(), ...data },
    });
    hook.result.current.setCurrentPatronId('p1');
  });
  return hook;
}

describe('useBanForm validateForm', () => {
  it('requires start and lift dates when cleared', () => {
    const { result } = setup({ starts_at: '', lifts_at: '' });

    let valid = true;
    act(() => {
      valid = result.current.validateForm(['p1'], false);
    });

    expect(valid).toBe(false);
    expect(result.current.errorsPerPatron.p1?.starts_at).toBe('Start date is required');
    expect(result.current.errorsPerPatron.p1?.lifts_at).toBe('Lift date is required');
  });

  it('rejects a lift date before the start date', () => {
    const { result } = setup({ starts_at: '2026-07-10', lifts_at: '2026-07-01' });

    let valid = true;
    act(() => {
      valid = result.current.validateForm(['p1'], false);
    });

    expect(valid).toBe(false);
    expect(result.current.errorsPerPatron.p1?.lifts_at).toBe('Lift date cannot be before start date');
  });

  it('requires a violation selection when the letter has an unchecked violation list', () => {
    const { result } = setup({ ban_letter_template: 1, ban_letter_content: uncheckedViolations });

    let valid = true;
    act(() => {
      valid = result.current.validateForm(['p1'], false);
    });

    expect(valid).toBe(false);
    expect(result.current.errorsPerPatron.p1?.ban_letter_violations).toBe(
      'Please select at least one violation to issue letter',
    );
  });

  it('passes when dates are set and a violation is checked', () => {
    const { result } = setup({ ban_letter_template: 1, ban_letter_content: checkedViolations });

    let valid = false;
    act(() => {
      valid = result.current.validateForm(['p1'], false);
    });

    expect(valid).toBe(true);
    expect(result.current.errorsPerPatron.p1).toBeUndefined();
  });

  it('validates the provided data snapshot over stale state', () => {
    const { result } = setup({ ban_letter_template: 1, ban_letter_content: checkedViolations });

    let valid = true;
    act(() => {
      valid = result.current.validateForm(['p1'], false, {
        p1: {
          ...getDefaultPerPatronData(),
          ban_letter_template: 1,
          ban_letter_content: uncheckedViolations,
        },
      });
    });

    expect(valid).toBe(false);
    expect(result.current.errorsPerPatron.p1?.ban_letter_violations).toBeDefined();
  });

  it('clears the violation error once a violation is checked', () => {
    const { result } = setup({ ban_letter_template: 1, ban_letter_content: uncheckedViolations });

    act(() => {
      result.current.validateForm(['p1'], false);
    });
    expect(result.current.errorsPerPatron.p1?.ban_letter_violations).toBeDefined();

    act(() => {
      result.current.updatePatronData('p1', { ban_letter_content: checkedViolations });
    });
    expect(result.current.errorsPerPatron.p1?.ban_letter_violations).toBeUndefined();
  });
});
