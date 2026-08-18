import { Patron, Incident } from '../../types';
import { getIncidentStatus, getStatusLabel } from '../utils/incident-status';
import { GENDER_LABELS } from '../../constants';
import { escapeHtml } from './print-service';

interface PatronReportData {
  patron: Patron;
  photoUrl: string | null;
  incidents: Incident[];
  incidentsTotal: number;
  activeBanOnlyCount: number;
  activeTrespassCount: number;
}

export function generatePatronReportHtml(data: PatronReportData): string {
  const {
    patron,
    photoUrl,
    incidents,
    incidentsTotal,
    activeBanOnlyCount,
    activeTrespassCount,
  } = data;

  const metadata = patron.metadata
    ? (typeof patron.metadata === 'string' ? JSON.parse(patron.metadata) : patron.metadata)
    : {};

  const gender = GENDER_LABELS[metadata.gender] || metadata.gender || 'Unspecified';

  const incidentRows = incidents.map(inc => {
    const status = getIncidentStatus(inc);
    return `<tr>
      <td>#${inc.id}</td>
      <td>${escapeHtml(inc.title || inc.description?.substring(0, 50) || 'Untitled')}</td>
      <td><span class="status status-${status}">${getStatusLabel(status)}</span></td>
      <td>${escapeHtml(inc.org_unit_name || '')}</td>
      <td>${new Date(inc.occurred_at).toLocaleDateString()}</td>
    </tr>`;
  }).join('');

  return `
  <div class="header">
    ${photoUrl
      ? `<img src="${escapeHtml(photoUrl)}" alt="Photo" />`
      : '<div class="placeholder">?</div>'}
    <div>
      <h1>${escapeHtml(patron.display_name)}</h1>
      <div class="meta">Patron #${patron.id}${patron.library_card ? ` &middot; Card: ${escapeHtml(patron.library_card)}` : ''}</div>
      <div class="chips">
        ${patron.is_unknown ? '<span class="chip chip-unknown">Unknown Patron</span>' : ''}
        ${activeBanOnlyCount > 0 ? '<span class="chip chip-ban">Active Ban</span>' : ''}
        ${activeTrespassCount > 0 ? '<span class="chip chip-trespass">Active Trespass</span>' : ''}
      </div>
    </div>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="num">${incidentsTotal}</div>
      <div class="label">Incidents</div>
    </div>
    <div class="stat">
      <div class="num${activeBanOnlyCount > 0 ? ' alert' : ''}">${activeBanOnlyCount}</div>
      <div class="label">Active Bans</div>
    </div>
    <div class="stat">
      <div class="num${activeTrespassCount > 0 ? ' alert' : ''}">${activeTrespassCount > 0 ? 'Yes' : 'No'}</div>
      <div class="label">Active Trespass</div>
    </div>
  </div>

  <div class="section">
    <h2>Patron Information</h2>
    <div class="info-grid">
      <div class="info-item"><label>First Name</label><span>${escapeHtml(patron.first_name || '—')}</span></div>
      <div class="info-item"><label>Last Name</label><span>${escapeHtml(patron.last_name || '—')}</span></div>
      <div class="info-item"><label>Nickname / Alias</label><span>${escapeHtml(patron.alias || '—')}</span></div>
      <div class="info-item"><label>Library Card</label><span>${escapeHtml(patron.library_card || '—')}</span></div>
      <div class="info-item"><label>Age Range</label><span>${escapeHtml(patron.age_range_label || '—')}</span></div>
      <div class="info-item"><label>Gender</label><span>${escapeHtml(gender || '—')}</span></div>
    </div>
    <div class="info-grid wide" style="margin-top: 8px;">
      <div class="info-item"><label>Address</label><span>${escapeHtml(patron.address || '—')}</span></div>
      <div class="info-item"><label>Notes</label><span>${escapeHtml(patron.notes || '—')}</span></div>
    </div>
  </div>

  <div class="section">
    <h2>Incident History (${incidentsTotal})</h2>
    ${incidents.length > 0 ? `
    <table>
      <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Location</th><th>Date</th></tr></thead>
      <tbody>${incidentRows}</tbody>
    </table>
    ${incidentsTotal > incidents.length ? `<div class="empty">Showing ${incidents.length} of ${incidentsTotal} incidents</div>` : ''}
    ` : '<div class="empty">No incidents involving this patron.</div>'}
  </div>

  <div class="footer">
    Generated ${new Date().toLocaleString()} &middot; King County Library System
  </div>
  `;
}

export function getPatronReportStyles(): string {
  return `
    .header { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #1a1a1a; }
    .header img { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 2px solid #ccc; }
    .header .placeholder { width: 80px; height: 80px; border-radius: 50%; background: #e0e0e0; display: flex; align-items: center; justify-content: center; font-size: 32px; color: #999; }
    .header h1 { font-size: 22px; font-weight: 600; }
    .header .meta { font-size: 13px; color: #555; margin-top: 2px; }
    .chips { display: flex; gap: 8px; margin-top: 6px; }
    .chip { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
    .chip-ban { background: #fdecea; color: #c62828; }
    .chip-trespass { background: #fce4ec; color: #880e4f; }
    .chip-unknown { background: #fff3e0; color: #e65100; }

    .section { margin-bottom: 20px; }
    .section h2 { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #555; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 24px; }
    .info-grid.wide { grid-template-columns: 1fr; }
    .info-item label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.3px; display: block; }
    .info-item span { font-size: 14px; }

    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; color: #555; padding: 6px 8px; border-bottom: 2px solid #ddd; }
    td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .status { font-size: 11px; padding: 1px 6px; border-radius: 8px; font-weight: 500; }
    .status-active { background: #e3f2fd; color: #1565c0; }
    .status-resolved { background: #e8f5e9; color: #2e7d32; }

    .stats { display: flex; gap: 32px; margin-bottom: 20px; }
    .stat { text-align: center; }
    .stat .num { font-size: 22px; font-weight: 600; }
    .stat .label { font-size: 11px; color: #888; text-transform: uppercase; }
    .stat .num.alert { color: #c62828; }

    .empty { color: #999; font-style: italic; font-size: 13px; padding: 12px 0; }
    .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 11px; color: #999; text-align: center; }
    .page-break { break-before: page; }
  `;
}
