import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Incident, InvolvedParty, PatronBan } from '../../../types';
import { patronApi } from '../../../api/patrons';

export interface BanWithDetails extends PatronBan {
  incident_id?: number;
  org_unit_id?: string;
  org_unit_name?: string;
}

const PARTY_TYPE_ORDER: Record<string, number> = { patron: 0, staff: 1, external: 2 };

export interface UseIncidentBansResult {
  parties: InvolvedParty[];
  patronParties: InvolvedParty[];
  bansByPatron: Map<number, BanWithDetails[]>;
  patronPhotos: Map<number, string>;
  loading: boolean;
  refresh: () => void;
}

export function useIncidentBans(incident: Incident | null): UseIncidentBansResult {
  const [bansByPatron, setBansByPatron] = useState<Map<number, BanWithDetails[]>>(new Map());
  const [patronPhotos, setPatronPhotos] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const parties = useMemo(() => {
    if (!incident) return [];
    return (incident.involved_parties || [])
      .filter((p: InvolvedParty) => p.role !== 'creator')
      .sort((a, b) => {
        const typeDiff = (PARTY_TYPE_ORDER[a.party_type ?? ''] ?? 9) - (PARTY_TYPE_ORDER[b.party_type ?? ''] ?? 9);
        if (typeDiff !== 0) return typeDiff;
        const nameA = (a.patron_display?.display_name || '').toLowerCase();
        const nameB = (b.patron_display?.display_name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
  }, [incident?.involved_parties]);

  const patronParties = useMemo(
    () => parties.filter((p) => !!p.patron_id),
    [parties],
  );

  const refresh = useCallback(async () => {
    if (patronParties.length === 0) {
      setBansByPatron(new Map());
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [banResults, photoResults] = await Promise.all([
        Promise.all(
          patronParties.map((p) =>
            patronApi.getPatronBans({ patronId: p.patron_id!, includeArchived: true }).catch(() => [])
          ),
        ),
        Promise.all(
          patronParties.map((p) =>
            patronApi.getDetailSummary(p.patron_id!).then((result) => {
              const primary = result.photos.find((ph) => ph.is_primary);
              return primary?.file_upload_data?.relative_path || null;
            }).catch(() => null)
          ),
        ),
      ]);

      const banMap = new Map<number, BanWithDetails[]>();
      const photoMap = new Map<number, string>();
      patronParties.forEach((p, idx) => {
        const pid = parseInt(p.patron_id!, 10);
        banMap.set(pid, banResults[idx] || []);
        const photoPath = photoResults[idx];
        if (photoPath) {
          photoMap.set(pid, photoPath);
        }
      });
      setBansByPatron(banMap);
      setPatronPhotos(photoMap);
    } catch (err) {
      console.error('Failed to load bans:', err);
    } finally {
      setLoading(false);
    }
  }, [patronParties]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { parties, patronParties, bansByPatron, patronPhotos, loading, refresh };
}
