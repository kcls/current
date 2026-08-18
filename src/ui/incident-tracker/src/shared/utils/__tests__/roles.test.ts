import { describe, it, expect } from 'vitest';
import {
  INCIDENT_ROLES,
  STAFF_ROLES,
  COORDINATOR_ROLES,
  MANAGER_ROLES,
  hasAnyRole,
  hasRole,
  canReviewIncident,
  canResubmitIncident,
  canDeleteIncident,
  canEditIncident,
  getReviewLevelLabel,
} from '../roles';
import type { User } from '../../../types';

// Helper to create a mock user with specific roles
function createMockUser(roles: Array<{ role: string; org_unit?: number }>): User {
  return {
    id: 1,
    uuid: 'user-uuid-1',
    username: 'testuser',
    email: 'testuser@test.com',
    display_name: 'Test User',
    roles: roles.map((r, i) => ({
      id: i + 1,
      role: r.role,
      org_unit: r.org_unit ?? 1,
    })),
  };
}

describe('Role Constants', () => {
  it('should define all incident roles', () => {
    expect(INCIDENT_ROLES.STAFF).toBe('incident-staff');
    expect(INCIDENT_ROLES.COORDINATOR).toBe('incident-coordinator');
    expect(INCIDENT_ROLES.MANAGER).toBe('incident-manager');
    expect(INCIDENT_ROLES.ADMIN).toBe('incident-admin');
    expect(INCIDENT_ROLES.DATA).toBe('incident-data');
  });

  it('should define staff roles array with staff and admin', () => {
    expect(STAFF_ROLES).toContain('incident-staff');
    expect(STAFF_ROLES).toContain('incident-admin');
    expect(STAFF_ROLES).toHaveLength(2);
  });

  it('should define coordinator roles array with coordinator and admin', () => {
    expect(COORDINATOR_ROLES).toContain('incident-coordinator');
    expect(COORDINATOR_ROLES).toContain('incident-admin');
    expect(COORDINATOR_ROLES).toHaveLength(2);
  });

  it('should define manager roles array with manager and admin', () => {
    expect(MANAGER_ROLES).toContain('incident-manager');
    expect(MANAGER_ROLES).toContain('incident-admin');
    expect(MANAGER_ROLES).toHaveLength(2);
  });
});

describe('hasRole', () => {
  it('should return true when user has the specified role', () => {
    const user = createMockUser([{ role: 'incident-staff' }]);
    expect(hasRole(user, 'incident-staff')).toBe(true);
  });

  it('should return false when user does not have the specified role', () => {
    const user = createMockUser([{ role: 'incident-staff' }]);
    expect(hasRole(user, 'incident-admin')).toBe(false);
  });

  it('should return false for null user', () => {
    expect(hasRole(null, 'incident-staff')).toBe(false);
  });

  it('should return false for user with no roles', () => {
    const user = createMockUser([]);
    expect(hasRole(user, 'incident-staff')).toBe(false);
  });

  it('should return false for user with undefined roles', () => {
    const user = { id: 1, username: 'test', display_name: 'Test' } as User;
    expect(hasRole(user, 'incident-staff')).toBe(false);
  });
});

describe('hasAnyRole', () => {
  it('should return true when user has one of the specified roles', () => {
    const user = createMockUser([{ role: 'incident-staff' }]);
    expect(hasAnyRole(user, STAFF_ROLES)).toBe(true);
  });

  it('should return true when user has admin role checking staff roles', () => {
    const user = createMockUser([{ role: 'incident-admin' }]);
    expect(hasAnyRole(user, STAFF_ROLES)).toBe(true);
  });

  it('should return false when user has none of the specified roles', () => {
    const user = createMockUser([{ role: 'incident-staff' }]);
    expect(hasAnyRole(user, COORDINATOR_ROLES)).toBe(false);
  });

  it('should return false for null user', () => {
    expect(hasAnyRole(null, STAFF_ROLES)).toBe(false);
  });

  it('should return true when user has multiple roles and one matches', () => {
    const user = createMockUser([
      { role: 'incident-staff' },
      { role: 'incident-coordinator' },
    ]);
    expect(hasAnyRole(user, COORDINATOR_ROLES)).toBe(true);
  });
});

describe('canReviewIncident', () => {
  describe('final reviewer', () => {
    it('should return true when user is final reviewer regardless of level', () => {
      expect(canReviewIncident(1, 5, false, 0, true)).toBe(true);
      expect(canReviewIncident(0, 5, false, 0, true)).toBe(true);
      expect(canReviewIncident(null, 5, false, 0, true)).toBe(true);
    });
  });

  describe('no review level', () => {
    it('should return false when user has no review level (null)', () => {
      expect(canReviewIncident(null, 1, false, 0, false)).toBe(false);
    });

    it('should return false when user has no review level (undefined)', () => {
      expect(canReviewIncident(undefined, 1, false, 0, false)).toBe(false);
    });

    it('should return false when user has review level 0', () => {
      expect(canReviewIncident(0, 1, false, 0, false)).toBe(false);
    });
  });

  describe('normal review (not returned)', () => {
    it('should return true when user level >= min review level', () => {
      expect(canReviewIncident(3, 2, false, 0, false)).toBe(true);
      expect(canReviewIncident(2, 2, false, 0, false)).toBe(true);
    });

    it('should return false when user level < min review level', () => {
      expect(canReviewIncident(1, 2, false, 0, false)).toBe(false);
    });
  });

  describe('returned incident', () => {
    it('should return true when user level >= creator level', () => {
      expect(canReviewIncident(3, 5, true, 2, false)).toBe(true);
      expect(canReviewIncident(2, 5, true, 2, false)).toBe(true);
    });

    it('should return false when user level < creator level', () => {
      expect(canReviewIncident(1, 5, true, 2, false)).toBe(false);
    });
  });
});

describe('canResubmitIncident', () => {
  describe('creator', () => {
    it('should allow creator to resubmit regardless of level', () => {
      expect(canResubmitIncident(true, 0, 0, false)).toBe(true);
      expect(canResubmitIncident(true, null, 0, false)).toBe(true);
      expect(canResubmitIncident(true, 1, 1, false)).toBe(true);
    });
  });

  describe('same-level peer', () => {
    it('should allow same-level non-final peer to resubmit', () => {
      // User at L1, creator at L1
      expect(canResubmitIncident(false, 1, 1, false)).toBe(true);
      // User at L2, creator at L2
      expect(canResubmitIncident(false, 2, 2, false)).toBe(true);
    });

    it('should not allow final reviewer to resubmit even at same level', () => {
      expect(canResubmitIncident(false, 3, 3, true)).toBe(false);
    });
  });

  describe('higher-level reviewer', () => {
    it('should not allow higher-level peer to resubmit (they see review actions)', () => {
      // User at L2, creator at L1
      expect(canResubmitIncident(false, 2, 1, false)).toBe(false);
      // User at L3, creator at L1
      expect(canResubmitIncident(false, 3, 1, false)).toBe(false);
    });
  });

  describe('no review level', () => {
    it('should not allow non-creator with null review level', () => {
      expect(canResubmitIncident(false, null, 1, false)).toBe(false);
    });

    it('should not allow non-creator with undefined review level', () => {
      expect(canResubmitIncident(false, undefined, 1, false)).toBe(false);
    });

    it('should not allow non-creator with review level 0', () => {
      expect(canResubmitIncident(false, 0, 0, false)).toBe(false);
    });
  });

  describe('edge: creator not in chain', () => {
    it('should not allow L1 peer when creator is level 0', () => {
      // Creator is regular staff (level 0), L1 reviewer should see review actions, not resubmit
      expect(canResubmitIncident(false, 1, 0, false)).toBe(false);
    });
  });
});

describe('canDeleteIncident', () => {
  describe('creator with returned incident', () => {
    it('should return true when user is creator and incident is returned', () => {
      expect(canDeleteIncident(0, 5, true, 2, false, true)).toBe(true);
    });

    it('should return true even if creator has no review level', () => {
      expect(canDeleteIncident(null, 5, true, 2, false, true)).toBe(true);
    });
  });

  describe('non-creator', () => {
    it('should fall back to canReviewIncident logic', () => {
      // Has sufficient review level
      expect(canDeleteIncident(3, 2, false, 0, false, false)).toBe(true);
      // Insufficient review level
      expect(canDeleteIncident(1, 2, false, 0, false, false)).toBe(false);
    });

    it('should allow final reviewer to delete', () => {
      expect(canDeleteIncident(0, 5, false, 0, true, false)).toBe(true);
    });
  });

  describe('creator with non-returned incident', () => {
    it('should still require review permission', () => {
      // Creator but incident not returned, needs review level
      expect(canDeleteIncident(0, 1, false, 0, false, true)).toBe(false);
      expect(canDeleteIncident(1, 1, false, 0, false, true)).toBe(true);
    });
  });
});

describe('canEditIncident', () => {
  const adminUser = createMockUser([{ role: 'incident-admin' }]);
  const staffUser = createMockUser([{ role: 'incident-staff' }]);

  describe('admin user', () => {
    it('should always return true for admin users', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: 'user-uuid-999',
        current_review_level: 5,
        latest_review_result: 'approved',
      };
      expect(canEditIncident(adminUser, incident)).toBe(true);
    });
  });

  describe('null checks', () => {
    it('should return false for null user', () => {
      expect(canEditIncident(null, { org_unit: 'org-uuid-1', created_by: 'user-uuid-1' })).toBe(false);
    });

    it('should return false for null incident', () => {
      expect(canEditIncident(staffUser, null as any)).toBe(false);
    });
  });

  describe('no reviews yet', () => {
    it('should allow creator to edit their own incident', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: staffUser.uuid!,
        current_review_level: 0,
      };
      expect(canEditIncident(staffUser, incident)).toBe(true);
    });

    it('should allow reviewer with higher level than creator to edit', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: 'user-uuid-999',
        current_review_level: 0,
        creator_level: 1,
        user_review_level: 2,
      };
      expect(canEditIncident(staffUser, incident)).toBe(true);
    });

    it('should not allow non-creator with same or lower level to edit', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: 'user-uuid-999',
        current_review_level: 0,
        creator_level: 2,
        user_review_level: 1,
      };
      expect(canEditIncident(staffUser, incident)).toBe(false);
    });
  });

  describe('returned incident', () => {
    it('should allow creator to edit returned incident', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: staffUser.uuid!,
        current_review_level: 2,
        latest_review_result: 'returned',
      };
      expect(canEditIncident(staffUser, incident)).toBe(true);
    });

    it('should allow reviewer to edit based on canReviewIncident rules', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: 'user-uuid-999',
        current_review_level: 2,
        latest_review_result: 'returned',
        creator_level: 1,
        user_review_level: 2,
      };
      expect(canEditIncident(staffUser, incident)).toBe(true);
    });

    it('should allow same-level peer to edit returned incident (level reset to 0)', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: 'user-uuid-999', // Level 1A created it
        current_review_level: 0, // reset after return
        latest_review_result: 'returned',
        creator_level: 1,
        user_review_level: 1, // Level 1B — same level as creator
      };
      expect(canEditIncident(staffUser, incident)).toBe(true);
    });

    it('should deny edit for non-reviewer on returned incident', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: 'user-uuid-999',
        current_review_level: 0,
        latest_review_result: 'returned',
        creator_level: 1,
        user_review_level: 0, // not in review chain
      };
      expect(canEditIncident(staffUser, incident)).toBe(false);
    });
  });

  describe('approved/in-review incident', () => {
    it('should allow edit based on review level for approved incidents', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: 'user-uuid-999',
        current_review_level: 2,
        latest_review_result: 'approved',
        user_review_level: 3,
      };
      expect(canEditIncident(staffUser, incident)).toBe(true);
    });

    it('should deny edit when user review level is insufficient', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: 'user-uuid-999',
        current_review_level: 3,
        latest_review_result: 'approved',
        user_review_level: 2,
      };
      expect(canEditIncident(staffUser, incident)).toBe(false);
    });

    it('should allow final reviewer to edit', () => {
      const incident = {
        org_unit: 'org-uuid-1',
        created_by: 'user-uuid-999',
        current_review_level: 5,
        latest_review_result: 'approved',
        user_review_level: 1,
        is_final_review: true,
      };
      expect(canEditIncident(staffUser, incident)).toBe(true);
    });
  });
});

describe('getReviewLevelLabel', () => {
  it('should return "Initial Submission" for level 0', () => {
    expect(getReviewLevelLabel(0)).toBe('Initial Submission');
  });

  it('should return "Review Level N" for positive levels', () => {
    expect(getReviewLevelLabel(1)).toBe('Review Level 1');
    expect(getReviewLevelLabel(2)).toBe('Review Level 2');
    expect(getReviewLevelLabel(5)).toBe('Review Level 5');
  });
});
