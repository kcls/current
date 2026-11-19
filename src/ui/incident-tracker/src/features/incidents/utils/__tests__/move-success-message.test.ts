import { describe, expect, it } from 'vitest';
import { moveSuccessMessage } from '../incident-submit';
import type { MoveIncidentResult } from '../../../../api/incidents';

const move = (review_outcome: MoveIncidentResult['review_outcome']): MoveIncidentResult => ({
  previous_org_unit: '00000000-0000-0000-0000-000000000001',
  review_outcome,
  moved_bans: [],
});

describe('moveSuccessMessage', () => {
  it('reports a resubmission', () => {
    expect(moveSuccessMessage(7, move('resubmitted'))).toBe(
      'Incident #7 moved and resubmitted for review at the new location',
    );
  });

  it('tells the user to resubmit a returned incident', () => {
    expect(moveSuccessMessage(7, move('returned_to_draft'))).toBe(
      'Incident #7 moved and returned to draft; submit it for review at the new location',
    );
  });

  it('is a plain update when review is unchanged or there was no move', () => {
    expect(moveSuccessMessage(7, move('unchanged'))).toBe('Incident #7 updated successfully');
    expect(moveSuccessMessage(7, undefined)).toBe('Incident #7 updated successfully');
  });
});
