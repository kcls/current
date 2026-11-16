import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../../contexts/toast-context';
import EditBanPage from '../edit-ban-page';
import { bansApi } from '../../../api/bans';

vi.mock('../../../api', () => ({
  incidentApi: {
    get: vi.fn().mockResolvedValue({
      id: 7,
      title: 'Moved incident',
      description: 'x',
      org_unit_name: 'Hilltop Branch',
      occurred_at: '2026-11-01T12:00:00Z',
    }),
  },
}));
vi.mock('../../../api/patrons', () => ({
  patronApi: { get: vi.fn().mockResolvedValue({ id: 3, display_name: 'Pat Doe' }) },
}));
vi.mock('../../../api/activity', () => ({
  getBanActivity: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../api/bans', () => ({
  bansApi: {
    getBanLetterTemplates: vi.fn(),
    getBanDetails: vi.fn(),
    getBanLetter: vi.fn().mockResolvedValue({ content: '<p>Banned from Main Street Branch</p>' }),
  },
}));
// The real section renders the letter in an iframe editor; expose the
// content as text instead.
vi.mock('../components/ban-letter-section', () => ({
  BanLetterSection: ({ formData }: { formData: { ban_letter_content: string } }) => (
    <div data-testid="letter">{formData.ban_letter_content}</div>
  ),
}));

const template = { id: 11, name: 'Standard', body: '<p>Banned from {{location_name}}</p>' };

const banDetails = (withLetter: boolean) => ({
  ban: {
    id: 5,
    patron: 3,
    incident: 7,
    org_unit: 'org-hill',
    is_trespass: false,
    starts_at: '2026-11-01T08:00:00Z',
    lifts_at: '2026-12-01T08:00:00Z',
  },
  letters: withLetter ? [{ id: 21, template: 11 }] : [],
});

const renderPage = (state?: unknown) =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[{ pathname: '/bans/5/edit', state }]}>
        <Routes>
          <Route path="/bans/:id/edit" element={<EditBanPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

describe('EditBanPage letter regeneration', () => {
  beforeEach(() => {
    vi.mocked(bansApi.getBanLetterTemplates).mockResolvedValue([template] as any);
  });

  it('keeps the saved letter when opened normally', async () => {
    vi.mocked(bansApi.getBanDetails).mockResolvedValue(banDetails(true) as any);
    renderPage();
    expect(await screen.findByTestId('letter')).toHaveTextContent('Main Street Branch');
    expect(screen.queryByText(/was regenerated/)).not.toBeInTheDocument();
  });

  it('rebuilds the letter for the current location when sent from the move prompt', async () => {
    vi.mocked(bansApi.getBanDetails).mockResolvedValue(banDetails(true) as any);
    renderPage({ regenerateLetter: true });
    expect(await screen.findByText(/was regenerated for Hilltop Branch/)).toBeInTheDocument();
    const letter = screen.getByTestId('letter');
    expect(letter).toHaveTextContent('Hilltop Branch');
    expect(letter).not.toHaveTextContent('Main Street Branch');
  });

  it('says so when there is no letter to regenerate', async () => {
    vi.mocked(bansApi.getBanDetails).mockResolvedValue(banDetails(false) as any);
    renderPage({ regenerateLetter: true });
    expect(await screen.findByText(/no letter on file to regenerate/)).toBeInTheDocument();
  });
});
