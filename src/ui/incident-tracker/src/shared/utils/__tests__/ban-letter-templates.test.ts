import { describe, it, expect } from 'vitest';
import { format } from 'date-fns';
import {
  processBanLetterTemplate,
  buildTemplateVars,
  letterNeedsViolationSelection,
} from '../ban-letter-templates';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { Incident, PatronDetails } from '../../../types';

describe('processBanLetterTemplate', () => {
  const mockTemplate: BanLetterTemplate = {
    id: 1,
    subject: 'Test Subject',
    body: `Dear {{patron_name}},

You are hereby notified that you are banned from {{location_name}} effective {{start_date}} through {{end_date}}.

Your address on file:
{{street_address}}
{{city_state_zip}}

Ban duration: {{duration}} days ({{duration_months}} months)

If you have questions, contact {{signature}}.

Law enforcement agency: {{law_enforcement_agency}}

Date: {{date}}`,
    is_default: false,
    is_trespass: false,
    operation_type: 'created',
    name: 'Ban Letter',
    created_by: 'user-uuid-1',
    created_at: '2024-01-01',
    updated_by: 'user-uuid-1',
    updated_at: '2024-01-01',
    deleted_by: null,
    deleted_at: null,
  };

  const mockIncident: Incident = {
    id: 1,
    patronId: null,
    title: 'Test Incident',
    description: 'Test incident description',
    org_unit: '10',
    org_unit_name: 'Main Library',
    template_ids: [],
    created_at: '2024-01-15T10:00:00Z',
    occurred_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    created_by: 'user-uuid-1',
    involved_parties: [],
  };

  const mockPatronData: PatronDetails = {
    id: '123',
    barcode: 'P123456',
    display_name: 'John Doe',
    first_name: 'John',
    last_name: 'Doe',
    preferred_name: 'Johnny',
    library_card_number: 'P123456',
    status: 'active',
    address: {
      street: '123 Main St\nApt 4B',
      city: 'Seattle',
      state: 'WA',
      zip: '98101',
      country: 'US',
    },
    notes: '',
    bans: [],
    photos: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  /** Strip <span data-tmpl-var="...">...</span> wrappers to get plain text for assertions */
  const stripVarSpans = (html: string) =>
    html.replace(/<span data-tmpl-var="[^"]*">([\s\S]*?)<\/span>/g, '$1');

  it('should replace patron variables correctly', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('Dear John Doe');
    expect(plain).toContain('123 Main St\nApt 4B');
    expect(plain).toContain('Seattle, WA 98101');
  });

  it('should replace incident variables correctly', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('Main Library');
  });

  it('should calculate duration correctly', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-02',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('Ban duration: 30 days (1 months)');
  });

  it('should handle missing patron data with placeholders', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, null, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    expect(result).toContain('[Patron Name]');
    expect(result).toContain('[Street Address]');
    expect(result).toContain('[City, State ZIP]');
  });

  it('should use location name with Library Management Team for signature', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('contact Main Library Library Management Team');
  });

  it('should use fallback location in signature when org_unit_name is missing', () => {
    const incidentWithoutLocation: Incident = {
      ...mockIncident,
      org_unit_name: undefined,
    };
    const result = processBanLetterTemplate(mockTemplate, incidentWithoutLocation, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('contact [Location] Library Management Team');
  });

  it('should handle law enforcement agency', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
      lawEnforcementAgency: 'Seattle Police Department',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('Law enforcement agency: Seattle Police Department');
  });

  it('should use fallback values when options are not provided', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData);

    expect(result).toContain('[Law Enforcement Agency]');
    const plain = stripVarSpans(result);
    expect(plain).toContain('Main Library Library Management Team');
  });

  it('should handle date formatting', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    const today = format(new Date(), 'MM/dd/yyyy');
    const plain = stripVarSpans(result);
    expect(plain).toContain(`Date: ${today}`);
  });

  it('should calculate end date as lifts_at minus 1 day (UTC timestamps)', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData, {
      startsAt: '2024-02-01T08:00:00+00:00',
      liftsAt: '2024-03-01T08:00:00+00:00',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('through 02/29/2024');
  });

  it('should calculate end date as lifts_at minus 1 day (YYYY-MM-DD dates)', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('effective 02/01/2024 through 02/29/2024');
  });

  it('should handle missing address gracefully', () => {
    const patronWithoutAddress: PatronDetails = {
      ...mockPatronData,
      address: undefined,
    };

    const result = processBanLetterTemplate(mockTemplate, mockIncident, patronWithoutAddress, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    expect(result).toContain('[Street Address]');
    expect(result).toContain('[City, State ZIP]');
  });

  it('should handle partial address (city only, no state)', () => {
    const patronCityOnly: PatronDetails = {
      ...mockPatronData,
      address: {
        street: '123 Main St',
        city: 'Seattle',
        state: '',
        zip: '',
        country: 'US',
      },
    };

    const result = processBanLetterTemplate(mockTemplate, mockIncident, patronCityOnly, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('Seattle');
    expect(plain).not.toContain('[City, State ZIP]');
  });

  it('should use first_name for patron_first_name placeholder', () => {
    const template: BanLetterTemplate = {
      ...mockTemplate,
      body: 'Dear {{patron_first_name}},',
    };

    const result = processBanLetterTemplate(template, mockIncident, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('Dear John,');
  });

  it('should handle full ISO timestamps for starts_at and lifts_at', () => {
    const result = processBanLetterTemplate(mockTemplate, mockIncident, mockPatronData, {
      startsAt: '2024-02-01T07:35:53+00:00',
      liftsAt: '2024-03-02T06:35:53+00:00',
    });

    const plain = stripVarSpans(result);
    expect(plain).toContain('Ban duration: 30 days (1 months)');
    expect(plain).not.toContain('NaN');
    expect(plain).not.toContain('Invalid Date');
  });

  it('should wrap each variable in a span with data-tmpl-var attribute', () => {
    const tmpl: BanLetterTemplate = {
      ...mockTemplate,
      body: '{{patron_name}} at {{location_name}} case {{case_number}} agency {{law_enforcement_agency}} sig {{signature}}',
    };
    const result = processBanLetterTemplate(tmpl, mockIncident, mockPatronData, {
      startsAt: '2024-02-01',
      liftsAt: '2024-03-01',
      caseNumber: 'C-123',
      lawEnforcementAgency: 'SPD',
      selectedLocationName: 'Shoreline',
    });

    expect(result).toContain('data-tmpl-var="patron_name">John Doe</span>');
    expect(result).toContain('data-tmpl-var="location_name">Shoreline</span>');
    expect(result).toContain('data-tmpl-var="case_number">C-123</span>');
    expect(result).toContain('data-tmpl-var="law_enforcement_agency">SPD</span>');
    expect(result).toContain('data-tmpl-var="signature">Shoreline Library Management Team</span>');
  });
});

describe('buildTemplateVars', () => {
  const mockIncident: Incident = {
    id: 1,
    patronId: null,
    title: 'Test Incident',
    description: 'Test desc',
    org_unit: '10',
    org_unit_name: 'Main Library',
    template_ids: [],
    created_at: '2024-01-15T10:00:00Z',
    occurred_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    created_by: 'user-uuid-1',
    involved_parties: [],
  };

  it('should return a map of all template variables', () => {
    const vars = buildTemplateVars(mockIncident, null, {
      caseNumber: 'C-999',
      lawEnforcementAgency: 'FBI',
      selectedLocationName: 'Bothell',
    });

    expect(vars.case_number).toBe('C-999');
    expect(vars.law_enforcement_agency).toBe('FBI');
    expect(vars.location_name).toBe('Bothell');
    expect(vars.locations).toBe('Bothell');
    expect(vars.branch_name).toBe('Bothell');
    expect(vars.signature).toBe('Bothell Library Management Team');
    expect(vars.patron_name).toBe('[Patron Name]');
  });

  it('should fall back to incident org_unit_name for location', () => {
    const vars = buildTemplateVars(mockIncident, null);
    expect(vars.location_name).toBe('Main Library');
    expect(vars.signature).toBe('Main Library Library Management Team');
  });
});

describe('letterNeedsViolationSelection', () => {
  const violationItem = (text: string, checked = false) =>
    `<div class="tmpl-violation-item">
       <span class="tmpl-checkbox${checked ? ' tmpl-checked' : ''}"></span>
       <span>${text}</span>
     </div>`;

  it('returns true when the letter has violations but none checked', () => {
    const html = `<p>Dear Patron,</p>${violationItem('Unsafe behavior')}${violationItem('Illegal behavior')}`;
    expect(letterNeedsViolationSelection(html)).toBe(true);
  });

  it('returns false when at least one violation is checked', () => {
    const html = `<p>Dear Patron,</p>${violationItem('Unsafe behavior', true)}${violationItem('Illegal behavior')}`;
    expect(letterNeedsViolationSelection(html)).toBe(false);
  });

  it('returns false when the letter has no violation list', () => {
    expect(letterNeedsViolationSelection('<p>Dear Patron, you are banned.</p>')).toBe(false);
  });

  it('returns false for empty content', () => {
    expect(letterNeedsViolationSelection('')).toBe(false);
  });
});
