/* App */
const rawBase = import.meta.env.BASE_URL;
export const APP_BASENAME = rawBase === '/' ? '/' : rawBase.replace(/\/$/, '');

/* Routes (inside BrowserRouter, relative to basename) */
export const ROUTES = {
  // Auth
  LOGIN: '/login',
  SELECT_LOCATION: '/select-location',

  // Main
  HOME: '/',
  DASHBOARD: '/',
  PREFERENCES: '/preferences',
  APPEARANCE: '/preferences/appearance',

  // Incidents
  INCIDENTS: '/incidents',
  INCIDENTS_NEW: '/incidents/new',
  INCIDENT_DETAIL: '/incidents/:id',
  INCIDENT_EDIT: '/incidents/:id/edit',
  INCIDENT_CREATE_BAN: '/incidents/:incidentId/create-ban',
  // Patrons
  PATRONS: '/patrons',
  PATRON_DETAIL: '/patrons/:id',

  // Bans
  BANS: '/bans/:id',
  BAN_EDIT: '/bans/:id/edit',

  // Reviews
  INCIDENT_REVIEWS: '/incident-reviews',

  TEMPLATES: '/templates',
  TEMPLATES_NEW: '/templates/new',
  REPORTS: '/reports',
  NOTIFICATIONS: '/notifications',
  STAFF_MANAGEMENT: '/staff-management',
  ROLE_MANAGEMENT: '/role-management',
  REVIEW_PROCESS: '/review-process',
} as const;

/* Timezone — fallback when the org_unit's timezone is unavailable.
 * Actual timezone is fetched from org_unit.timezone at runtime via setLibraryTimezone(). */
export const DEFAULT_LIBRARY_TIMEZONE = 'America/Los_Angeles';

/* Ban & Trespass */
export const DEFAULT_BAN_LIFT_DAYS = 30;
export const DEFAULT_TRESPASS_LIFT_DAYS = 30;
export const DEFAULT_BAN_ARCHIVE_DAYS = 30;

/* Patron Merge */
export const COMPARED_FIELDS = [
  'first_name',
  'last_name',
  'preferred_name',
  'library_card',
  'alias',
  'address_line1',
  'address_line2',
  'city',
  'state_province',
  'postal_code',
  'age_range_label',
  'gender',
  'notes',
] as const;

export type ComparedField = typeof COMPARED_FIELDS[number];

export const GENDER_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  'non-binary': 'Non-binary',
  other: 'Other',
  'prefer-not-to-say': 'Prefer not to say',
  unspecified: 'Unspecified',
};
