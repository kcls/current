import { describe, it, expect } from 'vitest';
import { calculateExternalLinksChanges } from '../incident-form-utils';
import type { Incident } from '../../../../types';
import type { ExternalLinkFormData } from '../../components/external-link-dialog';

function makeIncident(links: Incident['external_links'] = []): Incident {
  return { external_links: links } as Incident;
}

describe('calculateExternalLinksChanges', () => {
  it('returns empty add/remove when nothing changed', () => {
    const current = makeIncident([
      { id: 1, url: 'https://a.com', title: 'A', description: 'desc' },
    ]);
    const form: ExternalLinkFormData[] = [
      { id: 1, url: 'https://a.com', title: 'A', description: 'desc' },
    ];
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: form });
    expect(result.add).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it('detects new links (no id)', () => {
    const current = makeIncident([]);
    const form: ExternalLinkFormData[] = [
      { url: 'https://new.com', title: 'New', description: '' },
    ];
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: form });
    expect(result.add).toEqual([{ url: 'https://new.com', title: 'New', description: '' }]);
    expect(result.remove).toEqual([]);
  });

  it('detects removed links', () => {
    const current = makeIncident([
      { id: 1, url: 'https://a.com', title: 'A', description: '' },
      { id: 2, url: 'https://b.com', title: 'B', description: '' },
    ]);
    const form: ExternalLinkFormData[] = [
      { id: 1, url: 'https://a.com', title: 'A', description: '' },
    ];
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: form });
    expect(result.add).toEqual([]);
    expect(result.remove).toEqual([2]);
  });

  it('handles edited link (url changed) as remove + add', () => {
    const current = makeIncident([
      { id: 1, url: 'https://old.com', title: 'Link', description: '' },
    ]);
    const form: ExternalLinkFormData[] = [
      { id: 1, url: 'https://new.com', title: 'Link', description: '' },
    ];
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: form });
    expect(result.remove).toEqual([1]);
    expect(result.add).toEqual([{ url: 'https://new.com', title: 'Link', description: '' }]);
  });

  it('handles edited link (title changed) as remove + add', () => {
    const current = makeIncident([
      { id: 1, url: 'https://a.com', title: 'Old', description: '' },
    ]);
    const form: ExternalLinkFormData[] = [
      { id: 1, url: 'https://a.com', title: 'New', description: '' },
    ];
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: form });
    expect(result.remove).toEqual([1]);
    expect(result.add).toEqual([{ url: 'https://a.com', title: 'New', description: '' }]);
  });

  it('handles edited link (description changed) as remove + add', () => {
    const current = makeIncident([
      { id: 1, url: 'https://a.com', title: 'A', description: '' },
    ]);
    const form: ExternalLinkFormData[] = [
      { id: 1, url: 'https://a.com', title: 'A', description: 'updated' },
    ];
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: form });
    expect(result.remove).toEqual([1]);
    expect(result.add).toEqual([{ url: 'https://a.com', title: 'A', description: 'updated' }]);
  });

  it('treats null and empty description as equivalent (no change)', () => {
    const current = makeIncident([
      { id: 1, url: 'https://a.com', title: 'A', description: undefined },
    ]);
    const form: ExternalLinkFormData[] = [
      { id: 1, url: 'https://a.com', title: 'A', description: '' },
    ];
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: form });
    expect(result.add).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it('handles mix of add, remove, and edit', () => {
    const current = makeIncident([
      { id: 1, url: 'https://keep.com', title: 'Keep', description: '' },
      { id: 2, url: 'https://edit.com', title: 'Edit', description: '' },
      { id: 3, url: 'https://remove.com', title: 'Remove', description: '' },
    ]);
    const form: ExternalLinkFormData[] = [
      { id: 1, url: 'https://keep.com', title: 'Keep', description: '' },
      { id: 2, url: 'https://edit.com', title: 'Edited', description: '' },
      { url: 'https://new.com', title: 'New', description: 'brand new' },
    ];
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: form });
    expect(result.remove).toEqual([3, 2]);
    expect(result.add).toEqual([
      { url: 'https://edit.com', title: 'Edited', description: '' },
      { url: 'https://new.com', title: 'New', description: 'brand new' },
    ]);
  });

  it('removes all when form is empty', () => {
    const current = makeIncident([
      { id: 1, url: 'https://a.com', title: 'A', description: '' },
      { id: 2, url: 'https://b.com', title: 'B', description: '' },
    ]);
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: [] });
    expect(result.remove).toEqual([1, 2]);
    expect(result.add).toEqual([]);
  });

  it('adds all when current is empty', () => {
    const current = makeIncident([]);
    const form: ExternalLinkFormData[] = [
      { url: 'https://a.com', title: 'A', description: '' },
      { url: 'https://b.com', title: 'B', description: 'desc' },
    ];
    const result = calculateExternalLinksChanges({ currentIncident: current, externalLinks: form });
    expect(result.remove).toEqual([]);
    expect(result.add).toHaveLength(2);
  });
});
