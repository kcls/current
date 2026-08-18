import type { Incident } from '../../types';

export type IncidentStatus = 'active' | 'resolved';

/**
 * Compute incident status from timestamp fields
 *
 * Status derivation logic:
 * - 'resolved': When resolved_at is set (incident was resolved)
 * - 'active': Otherwise (incident is active/in-progress/pending review)
 */
export function getIncidentStatus(incident: Partial<Incident>): IncidentStatus {
  if (incident.resolved_at) {
    return 'resolved';
  }
  return 'active';
}

export function getStatusLabel(status: IncidentStatus): string {
  if (status === 'resolved') {
    return 'Review Complete';
  }
  const label = status.replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function getStatusColor(status: IncidentStatus): 'error' | 'warning' | 'info' | 'success' | 'default' {
  switch (status) {
    case 'active':
      return 'warning';
    case 'resolved':
      return 'success';
    default:
      return 'default';
  }
}
