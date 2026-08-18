import type { ActivityLogEntry } from '../types';
import { currentPost } from './client';

export async function getBanActivity(banId: number): Promise<ActivityLogEntry[]> {
  const res = await currentPost<{ entries?: ActivityLogEntry[] }>(
    '/ban/activity',
    { ban_id: banId },
  );
  return res.entries ?? [];
}

export async function getIncidentActivity(incidentId: number): Promise<ActivityLogEntry[]> {
  const res = await currentPost<{ entries?: ActivityLogEntry[] }>(
    '/incident/activity',
    { incident_id: incidentId },
  );
  return res.entries ?? [];
}
