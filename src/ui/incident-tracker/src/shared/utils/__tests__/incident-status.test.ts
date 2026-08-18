import { describe, it, expect } from 'vitest';
import {
  getIncidentStatus,
  getStatusLabel,
  getStatusColor,
  type IncidentStatus,
} from '../incident-status';
import type { Incident } from '../../../types';

describe('getIncidentStatus', () => {
  it('should return "resolved" when resolved_at is set', () => {
    const incident: Partial<Incident> = {
      resolved_at: '2024-01-15T10:00:00Z',
    };
    expect(getIncidentStatus(incident)).toBe('resolved');
  });

  it('should return "active" when resolved_at is not set', () => {
    const incident: Partial<Incident> = {};
    expect(getIncidentStatus(incident)).toBe('active');
  });

  it('should return "active" when resolved_at is null', () => {
    const incident: Partial<Incident> = {
      resolved_at: null as any,
    };
    expect(getIncidentStatus(incident)).toBe('active');
  });

  it('should return "active" when resolved_at is undefined', () => {
    const incident: Partial<Incident> = {
      resolved_at: undefined,
    };
    expect(getIncidentStatus(incident)).toBe('active');
  });

  it('should return "active" for empty incident object', () => {
    expect(getIncidentStatus({})).toBe('active');
  });
});

describe('getStatusLabel', () => {
  it('should capitalize first letter for single word statuses', () => {
    expect(getStatusLabel('active')).toBe('Active');
  });

  it('should return "Review Complete" for resolved status', () => {
    expect(getStatusLabel('resolved')).toBe('Review Complete');
  });

  it('should replace underscores with spaces and capitalize first letter', () => {
    expect(getStatusLabel('in_progress' as IncidentStatus)).toBe('In progress');
    expect(getStatusLabel('pending_review' as IncidentStatus)).toBe('Pending review');
  });
});

describe('getStatusColor', () => {
  it('should return "warning" for active status', () => {
    expect(getStatusColor('active')).toBe('warning');
  });

  it('should return "success" for resolved status', () => {
    expect(getStatusColor('resolved')).toBe('success');
  });

  it('should return "default" for unknown status', () => {
    expect(getStatusColor('unknown' as IncidentStatus)).toBe('default');
  });
});
