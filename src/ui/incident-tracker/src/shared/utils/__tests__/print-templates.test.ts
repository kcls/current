import { describe, it, expect } from 'vitest';
import { generatePatronReportHtml, getPatronReportStyles } from '../print-templates';
import type { Patron, Incident } from '../../../types';

const mockPatron: Patron = {
  id: 1,
  display_name: 'Alice Smith',
  first_name: 'Alice',
  last_name: 'Smith',
  alias: 'Ali',
  library_card: 'LIB-001',
  is_unknown: false,
  notes: 'Test notes',
  age_range_label: 'Adult',
  metadata: { gender: 'female' },
};

const mockIncident: Incident = {
  id: 101,
  patronId: null,
  template_ids: [],
  title: 'Test Incident',
  description: 'Something happened',
  org_unit: 'org-uuid-1',
  org_unit_name: 'Main Branch',
  created_at: '2025-06-01T00:00:00Z',
  occurred_at: '2025-06-01T00:00:00Z',
  updated_at: '2025-06-01T00:00:00Z',
  created_by: 'user-uuid-1',
  involved_parties: [],
};

describe('generatePatronReportHtml', () => {
  it('renders patron identity fields', () => {
    const html = generatePatronReportHtml({
      patron: mockPatron,
      photoUrl: null,
      incidents: [],
      incidentsTotal: 0,
      activeBanOnlyCount: 0,
      activeTrespassCount: 0,
    });

    expect(html).toContain('Alice Smith');
    expect(html).toContain('LIB-001');
    expect(html).toContain('Ali');
    expect(html).toContain('Adult');
    expect(html).toContain('Female');
  });

  it('renders photo when URL provided', () => {
    const html = generatePatronReportHtml({
      patron: mockPatron,
      photoUrl: '/photos/alice.jpg',
      incidents: [],
      incidentsTotal: 0,
      activeBanOnlyCount: 0,
      activeTrespassCount: 0,
    });

    expect(html).toContain('src="/photos/alice.jpg"');
    expect(html).not.toContain('class="placeholder"');
  });

  it('renders placeholder when no photo', () => {
    const html = generatePatronReportHtml({
      patron: mockPatron,
      photoUrl: null,
      incidents: [],
      incidentsTotal: 0,
      activeBanOnlyCount: 0,
      activeTrespassCount: 0,
    });

    expect(html).toContain('class="placeholder"');
  });

  it('renders ban and trespass chips when active', () => {
    const html = generatePatronReportHtml({
      patron: mockPatron,
      photoUrl: null,
      incidents: [],
      incidentsTotal: 0,
      activeBanOnlyCount: 2,
      activeTrespassCount: 1,
    });

    expect(html).toContain('Active Ban');
    expect(html).toContain('Active Trespass');
  });

  it('omits ban/trespass chips when counts are zero', () => {
    const html = generatePatronReportHtml({
      patron: mockPatron,
      photoUrl: null,
      incidents: [],
      incidentsTotal: 0,
      activeBanOnlyCount: 0,
      activeTrespassCount: 0,
    });

    expect(html).not.toContain('chip-ban');
    expect(html).not.toContain('chip-trespass');
  });

  it('renders incident table rows', () => {
    const html = generatePatronReportHtml({
      patron: mockPatron,
      photoUrl: null,
      incidents: [mockIncident],
      incidentsTotal: 1,
      activeBanOnlyCount: 0,
      activeTrespassCount: 0,
    });

    expect(html).toContain('#101');
    expect(html).toContain('Test Incident');
    expect(html).toContain('Main Branch');
  });

  it('shows empty state when no incidents', () => {
    const html = generatePatronReportHtml({
      patron: mockPatron,
      photoUrl: null,
      incidents: [],
      incidentsTotal: 0,
      activeBanOnlyCount: 0,
      activeTrespassCount: 0,
    });

    expect(html).toContain('No incidents involving this patron');
  });

  it('shows truncation notice when more incidents exist', () => {
    const html = generatePatronReportHtml({
      patron: mockPatron,
      photoUrl: null,
      incidents: [mockIncident],
      incidentsTotal: 50,
      activeBanOnlyCount: 0,
      activeTrespassCount: 0,
    });

    expect(html).toContain('Showing 1 of 50 incidents');
  });

  it('renders unknown patron chip', () => {
    const html = generatePatronReportHtml({
      patron: { ...mockPatron, is_unknown: true },
      photoUrl: null,
      incidents: [],
      incidentsTotal: 0,
      activeBanOnlyCount: 0,
      activeTrespassCount: 0,
    });

    expect(html).toContain('Unknown Patron');
  });

  it('escapes HTML in patron fields', () => {
    const html = generatePatronReportHtml({
      patron: { ...mockPatron, display_name: '<script>xss</script>' },
      photoUrl: null,
      incidents: [],
      incidentsTotal: 0,
      activeBanOnlyCount: 0,
      activeTrespassCount: 0,
    });

    expect(html).not.toContain('<script>xss</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('getPatronReportStyles', () => {
  it('returns CSS string with expected selectors', () => {
    const css = getPatronReportStyles();
    expect(css).toContain('.header');
    expect(css).toContain('.info-grid');
    expect(css).toContain('.chip-ban');
  });
});

