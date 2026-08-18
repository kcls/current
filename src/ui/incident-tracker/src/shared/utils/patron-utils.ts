/**
 * Utility functions for working with patrons and involved parties
 */

import type { Incident, InvolvedParty, PatronSearchResult } from '../../types';

// Strip surrounding quotes/parentheses/whitespace from an alias for display.
// Staff sometimes wrap aliases in `"..."` or `(...)`; we normalize so the
// UI never shows `""Tape Guy""` or `((Tape Guy))`.
export function formatAlias(alias?: string | null): string | undefined {
  if (!alias) return undefined;
  const cleaned = alias.replace(/^["'(\s]+|["')\s]+$/g, '');
  return cleaned || undefined;
}

/**
 * Create a temporary PatronSearchResult for UI display before saving to DB.
 *
 * This is ONLY for creating a temporary object to display in Autocomplete components.
 *
 * @param id - Temporary ID like "unknown-123456" for new patrons
 * @returns A temporary PatronSearchResult for UI display
 */
export function createTempUnknownPatron(id?: string): PatronSearchResult {
  const tempId = id || `unknown-${Date.now()}`;

  return {
    id: tempId,
    display_name: 'Unknown Patron',
    status: 'active',
    is_banned: false,
    incident_count: 0,
    is_unknown: true,
    is_new_unsaved: true,
  };
}

/**
 * Extract ALL patrons' display names from an incident
 * @param incident - The incident object with involved_parties
 * @param maxDisplay - Maximum number of names to display before truncating (default: 2)
 * @param defaultValue - The default value to return if no patrons found (default: '-')
 * @returns Comma-separated display names with ellipsis if truncated
 */
export function getPatronNames(
  incident?: Incident | null,
  maxDisplay: number = 2,
  defaultValue: string = '-'
): string {
  if (!incident?.involved_parties || incident.involved_parties.length === 0) {
    return defaultValue;
  }

  const patrons = incident.involved_parties.filter(
    (party: InvolvedParty) => party.party_type === 'patron' && party.patron_id
  );

  if (patrons.length === 0) {
    return defaultValue;
  }

  const names = patrons.map(patron => {
    // Try patron_display_name first (from API join)
    if ((patron as any).patron_display_name) {
      return (patron as any).patron_display_name;
    }
    // Fall back to patron_display object
    if (patron.patron_display?.display_name) {
      return patron.patron_display.display_name;
    }
    return 'Unknown';
  });

  if (names.length <= maxDisplay) {
    return names.join(', ');
  }

  const displayedNames = names.slice(0, maxDisplay);
  const remainingCount = names.length - maxDisplay;
  return `${displayedNames.join(', ')}... (+${remainingCount})`;
}
