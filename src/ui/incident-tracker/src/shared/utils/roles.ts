import type { User } from '../../types';
import {
  hasAnyRole as coreHasAnyRole,
  hasRole as coreHasRole,
} from '@core/utils';

export const INCIDENT_ROLES = {
  STAFF: 'incident-staff',
  COORDINATOR: 'incident-coordinator',
  MANAGER: 'incident-manager',
  ADMIN: 'incident-admin',
  DATA: 'incident-data',
} as const;

export const STAFF_ROLES = [
  INCIDENT_ROLES.STAFF,
  INCIDENT_ROLES.ADMIN,
] as const;

export const COORDINATOR_ROLES = [
  INCIDENT_ROLES.COORDINATOR,
  INCIDENT_ROLES.ADMIN,
] as const;

export const MANAGER_ROLES = [
  INCIDENT_ROLES.MANAGER,
  INCIDENT_ROLES.ADMIN,
] as const;

// TODO: Add data analytics support for incident-data role
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DATA_ROLES = [
  INCIDENT_ROLES.DATA,
  INCIDENT_ROLES.ADMIN,
] as const;

export function hasAnyRole(user: User | null, roles: readonly string[]): boolean {
  return coreHasAnyRole(user?.roles, roles);
}

export function hasRole(user: User | null, role: string): boolean {
  return coreHasRole(user?.roles, role);
}

export interface IncidentEditContext {
  org_unit: string;
  created_by: string;
  creator_level?: number;
  current_review_level?: number;
  latest_review_result?: string;
  user_review_level?: number;
  is_final_review?: boolean;
}

export function canReviewIncident(
  userReviewLevel: number | null | undefined,
  minReviewLevel: number,
  isReturned: boolean,
  creatorLevel: number = 0,
  isFinalReviewer: boolean = false
): boolean {
  if (isFinalReviewer) return true;
  if (userReviewLevel === null || userReviewLevel === undefined || userReviewLevel === 0) return false;
  if (isReturned) {
    return userReviewLevel >= creatorLevel;
  }
  return userReviewLevel >= minReviewLevel;
}

export function canDeleteIncident(
  userReviewLevel: number | null | undefined,
  minReviewLevel: number,
  isReturned: boolean,
  creatorLevel: number = 0,
  isFinalReviewer: boolean = false,
  isCreator: boolean = false
): boolean {
  if (isReturned && isCreator) return true;
  return canReviewIncident(userReviewLevel, minReviewLevel, isReturned, creatorLevel, isFinalReviewer);
}

export function canEditIncident(
  user: User | null,
  incident: IncidentEditContext,
): boolean {
  if (!user || !incident) return false;
  if (hasAnyRole(user, [INCIDENT_ROLES.ADMIN])) return true;

  const currentLevel = incident.current_review_level ?? 0;
  const hasReviews = currentLevel > 0;
  const latestResult = incident.latest_review_result;
  const isReturned = latestResult === 'returned';
  const isCreator = !!user.uuid && incident.created_by === user.uuid;
  const userReviewLevel = incident.user_review_level ?? 0;
  const creatorLevel = incident.creator_level ?? 0;

  if (isReturned) {
    if (isCreator) return true;
    return canReviewIncident(
      incident.user_review_level,
      currentLevel,
      isReturned,
      creatorLevel,
      incident.is_final_review ?? false
    );
  }

  if (!hasReviews || !latestResult) {
    return isCreator || (userReviewLevel > creatorLevel);
  }

  return canReviewIncident(
    incident.user_review_level,
    currentLevel,
    isReturned,
    creatorLevel,
    incident.is_final_review ?? false
  );
}

export function canResubmitIncident(
  isCreator: boolean,
  userReviewLevel: number | null | undefined,
  creatorLevel: number,
  isFinalReviewer: boolean
): boolean {
  if (isCreator) return true;
  if (isFinalReviewer) return false;
  if (userReviewLevel == null || userReviewLevel === 0) return false;
  return userReviewLevel === creatorLevel;
}

export function canSubmitForReview(
  user: User | null,
  isCreator: boolean,
  userReviewLevel: number | null | undefined
): boolean {
  if (!user) return false;
  if (hasAnyRole(user, [INCIDENT_ROLES.ADMIN])) return true;
  if (isCreator) return true;
  if (userReviewLevel !== null && userReviewLevel !== undefined && userReviewLevel >= 1) return true;
  return false;
}

export function getReviewLevelLabel(sequence: number): string {
  if (sequence === 0) return 'Initial Submission';
  return `Review Level ${sequence}`;
}
