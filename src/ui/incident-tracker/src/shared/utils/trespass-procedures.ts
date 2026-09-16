import type { TrespassProcedureItem } from '../../types';

export type ProcedureState = Record<string, boolean>;

export function isEscapeHatchChecked(
  items: TrespassProcedureItem[],
  state: ProcedureState,
): boolean {
  return items.some((it) => it.is_escape_hatch && !!state[it.code]);
}

export function getMissingProcedureLabels(
  items: TrespassProcedureItem[],
  state: ProcedureState,
): string[] {
  const escapeChecked = isEscapeHatchChecked(items, state);
  const missing: string[] = [];
  for (const it of items) {
    if (it.is_escape_hatch) continue; // an opt-out, never itself a required step
    if (!it.required) continue;
    if (state[it.code]) continue;
    if (it.account_dependent && escapeChecked) continue;
    missing.push(it.label);
  }
  return missing;
}

export function isTrespassProceduresComplete(
  items: TrespassProcedureItem[],
  state: ProcedureState,
): boolean {
  return getMissingProcedureLabels(items, state).length === 0;
}

export function isItemWaived(
  item: TrespassProcedureItem,
  items: TrespassProcedureItem[],
  state: ProcedureState,
): boolean {
  return (
    item.account_dependent &&
    !item.is_escape_hatch &&
    isEscapeHatchChecked(items, state)
  );
}
