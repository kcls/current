import { parseISO, differenceInCalendarDays, format } from 'date-fns';
import type { BanLetterTemplate } from '@core/types/auto/incidents';
import type { PatronDetails } from '../../types/patron';
import type { Incident } from '../../types';
import { escapeHtml } from './print-service';
import { utcToLocalDate, formatBanDate } from './date-utils';

export interface TemplateProcessingOptions {
  startsAt?: string;
  liftsAt?: string;
  caseNumber?: string;
  lawEnforcementAgency?: string;
  selectedLocationName?: string;
}

/**
 * Build the variable name → value map used by both full template generation
 * and in-place variable updates.  Adding a new template variable here
 * automatically makes it available for live syncing in the letter editor.
 */
export const buildTemplateVars = (
  incident: Incident,
  patronData?: PatronDetails | null,
  options?: TemplateProcessingOptions,
): Record<string, string> => {
  const todayFormatted = formatBanDate(new Date().toISOString(), 'MM/dd/yyyy');

  const toLocal = (v: string): string =>
    v.includes('T') || v.includes('+') ? utcToLocalDate(v) : v;

  const startsAtLocal = options?.startsAt ? toLocal(options.startsAt) : '';
  const liftsAtLocal = options?.liftsAt ? toLocal(options.liftsAt) : '';

  const fmtLocal = (ymd: string): string => {
    const [y = 0, m = 1, d = 1] = ymd.split('-').map(Number);
    return format(new Date(y, m - 1, d), 'MM/dd/yyyy');
  };

  const startDate = startsAtLocal ? fmtLocal(startsAtLocal) : todayFormatted;

  let endDate = '[End Date]';
  if (liftsAtLocal) {
    const [y = 0, m = 1, d = 1] = liftsAtLocal.split('-').map(Number);
    endDate = format(new Date(y, m - 1, d - 1), 'MM/dd/yyyy');
  }

  let duration = 30;
  let durationMonths = 1;
  if (startsAtLocal && liftsAtLocal) {
    duration = differenceInCalendarDays(parseISO(liftsAtLocal), parseISO(startsAtLocal));
    durationMonths = Math.round(duration / 30);
  }

  const streetAddress = patronData?.address?.street || '[Street Address]';
  const addr = patronData?.address;
  const cityParts = [addr?.city, addr?.state].filter(Boolean).join(', ');
  const cityStateZip = cityParts
    ? `${cityParts} ${addr?.zip || ''}`.trim()
    : '[City, State ZIP]';

  const locationName = options?.selectedLocationName || incident.org_unit_name || '[Location]';
  const signature = `${locationName} Library Management Team`;

  // Escape all values to prevent XSS when embedded in letter HTML
  const esc = escapeHtml;

  return {
    date: esc(todayFormatted),
    current_date: esc(todayFormatted),
    today: esc(todayFormatted),
    patron_name: esc(patronData?.display_name || '[Patron Name]'),
    patron_first_name: esc(patronData?.first_name || patronData?.preferred_name || '[Patron First Name]'),
    patron_barcode: esc(patronData?.library_card_number || '[Library Card]'),
    street_address: esc(streetAddress),
    city_state_zip: esc(cityStateZip),
    incident_date: esc(
      incident.occurred_at ? formatBanDate(incident.occurred_at, 'MM/dd/yyyy') : todayFormatted,
    ),
    incident_description: esc(incident.description || incident.title || '[Incident Description]'),
    location_name: esc(locationName),
    locations: esc(locationName),
    branch_name: esc(locationName),
    start_date: esc(startDate),
    end_date: esc(endDate),
    duration: String(duration),
    duration_months: String(durationMonths),
    case_number: esc(options?.caseNumber || '[Case Number]'),
    law_enforcement_agency: esc(options?.lawEnforcementAgency || '[Law Enforcement Agency]'),
    signature: esc(signature),
  };
};

export const processBanLetterTemplate = (
  template: BanLetterTemplate,
  incident: Incident,
  patronData?: PatronDetails | null,
  options?: TemplateProcessingOptions
): string => {
  const vars = buildTemplateVars(incident, patronData, options);
  let processedContent = template.body;

  for (const [varName, value] of Object.entries(vars)) {
    processedContent = processedContent.replace(
      new RegExp(`\\{\\{${varName}\\}\\}`, 'g'),
      `<span data-tmpl-var="${varName}">${value}</span>`,
    );
  }

  return processedContent;
};

export const letterNeedsViolationSelection = (html: string): boolean => {
  if (!html) return false;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  if (!doc.querySelector('.tmpl-violation-item')) return false;
  return !doc.querySelector('.tmpl-violation-item .tmpl-checkbox.tmpl-checked');
};
