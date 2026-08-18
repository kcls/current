/**
 * API Integration Layer
 * Uses @core API utilities and clients
 */

export {
  orgUnitApi
} from '@core/api/org-units';

// Re-export auth from core
export { authApi } from '@core/api/auth';
export type { User, RoleAssignment } from '@core/api/auth';

export type {
  OrgUnit
} from '@core/api/org-units';

// Export local API adapters
export { incidentApi } from './incidents';
export { templateApi } from './templates';
export { locationApi } from './locations';
export { patronApi } from './patrons';
export { staffApi } from './staff';
