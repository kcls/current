# Incident Tracker Roles

Roles control which pages and features you can use — nothing more.
Whether you can *approve* an incident is decided separately, by the
[Review Chain](incident-review-chain.md).

| Role | What it unlocks |
|------|-----------------|
| `incident-staff` | Dashboard, create/view incidents, Reviews page |
| `incident-coordinator` | Operations center, patron directory, bans, ban letter templates, incident templates |
| `incident-manager` | Reports, sub-locations, review process configuration |
| `incident-admin` | Everything above, at every location it's scoped to |
| `incident-data` | Read-only access to incident data, for analytics and reporting |

## Independent flags, not a ladder

Except for `incident-admin` — which includes all the others — roles do
**not** build on each other. A coordinator can't see Reports; a manager
can't manage bans. Someone who needs both sets of features is simply
assigned both roles.

Think of each role as a feature flag with its own scope. Coordinators
work system-wide on patron matters, managers work per-location on
settings — chaining one to the other would blur where each applies, so
they stay separate.

A few notes on individual roles:

- `incident-staff` is the base role every staff account receives; new
  hires who can't create incidents are usually missing it.
- `incident-data` does *not* include `incident-staff` — a user with
  only this role can view data but not create incidents.
- A user with **no** incident roles at all cannot log in to Current;
  the login page shows an error.

## Roles are scoped to locations

Every role assignment names a location (org unit) and covers that
location and everything under it. One person can hold multiple roles
at one location, the same role at several locations, or different
roles at different locations.

| Role | Typically assigned at |
|------|-----------------------|
| `incident-staff` | Root — all staff, everywhere |
| `incident-coordinator` | Root — coordinators work system-wide |
| `incident-manager` | A region or branch — manages that area's settings |
| `incident-admin` | Root, or a region for a regionally-scoped admin |
| `incident-data` | Root — analysts need system-wide read access |

## How roles are assigned

The roles themselves are installed into the platform by Current's
registration manifest. Assignments to people happen in the Odo
platform, either automatically — SSO logins map job titles to roles —
or manually by a platform administrator.

## Common questions

| Question | Answer |
|----------|--------|
| I'm a coordinator — why can't I see Reports or Sub-locations? | Those are `incident-manager` features, and the roles are independent. You'd need `incident-manager` at the relevant location (or root) as well. |
| I can see the Reviews page but can't approve anything | Page access comes from the role; approval rights come from being in that location's [review chain](incident-review-chain.md). |
| A new hire can't create incidents | They need the `incident-staff` role. |
| A user can't log in at all | They have no incident roles assigned — every role grants login; none means no access. |
| My role is at Alder region — can I review Shoreline incidents? | Review rights follow the **incident's** location, not your role's. If you're in Shoreline's review chain, yes. |
