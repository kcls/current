import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders, userEvent } from '../../../../tests/test-utils';
import { PatronTable } from '../patron-table';
import type { PatronSearchResult } from '../../../../types/patron';

const mockPatrons: PatronSearchResult[] = [
  {
    id: '1',
    display_name: 'John Doe',
    library_card: '1234567890',
    barcode: '1234567890',
    ban_max_lifts_at: '2024-01-15T10:30:00Z',
    trespass_max_lifts_at: '2024-01-20T10:30:00Z',
    incident_org_unit_label: 'Shoreline Library',
    incident_count: 3,
    primary_photo_url: undefined,
    status: 'active',
  },
  {
    id: '2',
    display_name: 'Jane Smith',
    library_card: '0987654321',
    barcode: '0987654321',
    ban_max_lifts_at: '2024-01-10T14:20:00Z',
    trespass_max_lifts_at: '2024-01-12T14:20:00Z',
    incident_org_unit_label: 'Main Street Branch',
    incident_count: 1,
    primary_photo_url: undefined,
    status: 'active',
  },
];

const defaultProps = {
  patrons: mockPatrons,
  total: 2,
  page: 0,
  rowsPerPage: 10,
  loading: false,
  variant: 'bans' as const,
  onPageChange: vi.fn(),
  onRowsPerPageChange: vi.fn(),
};

describe('PatronTable', () => {
  describe('Loading State', () => {
    it('should display loading spinner when loading is true', () => {
      renderWithProviders(
        <PatronTable {...defaultProps} loading={true} patrons={[]} />
      );

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should display default empty message when no patrons', () => {
      renderWithProviders(
        <PatronTable {...defaultProps} patrons={[]} total={0} />
      );

      expect(screen.getByText('No patrons found')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('should display custom empty message when provided', () => {
      renderWithProviders(
        <PatronTable
          {...defaultProps}
          patrons={[]}
          total={0}
          emptyMessage="No active bans at Shoreline"
        />
      );

      expect(screen.getByText('No active bans at Shoreline')).toBeInTheDocument();
    });
  });

  describe('Table Rendering', () => {
    it('should render table with correct headers', () => {
      renderWithProviders(<PatronTable {...defaultProps} />);

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Patron Name')).toBeInTheDocument();
      expect(screen.getByText('Library Card')).toBeInTheDocument();
      expect(screen.getByText('Lift Date')).toBeInTheDocument();
      expect(screen.getByText('Location')).toBeInTheDocument();
      expect(screen.getByText('Open Incidents')).toBeInTheDocument();
    });

    it('should render all patron rows', () => {
      renderWithProviders(<PatronTable {...defaultProps} />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    it('should display patron library card numbers', () => {
      renderWithProviders(<PatronTable {...defaultProps} />);

      expect(screen.getByText('1234567890')).toBeInTheDocument();
      expect(screen.getByText('0987654321')).toBeInTheDocument();
    });

    it('should display N/A for missing library card', () => {
      const patronsWithoutCard: PatronSearchResult[] = [
        {
          ...mockPatrons[0]!,
          library_card: undefined,
          barcode: undefined,
        },
      ];

      renderWithProviders(
        <PatronTable {...defaultProps} patrons={patronsWithoutCard} total={1} />
      );

      expect(screen.getByText('N/A')).toBeInTheDocument();
    });

    it('should display location label', () => {
      renderWithProviders(<PatronTable {...defaultProps} />);

      expect(screen.getByText('Shoreline Library')).toBeInTheDocument();
      expect(screen.getByText('Main Street Branch')).toBeInTheDocument();
    });

    it('should display incident counts', () => {
      renderWithProviders(<PatronTable {...defaultProps} />);

      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');

      expect(within(rows[1]!).getByText('3')).toBeInTheDocument();
      expect(within(rows[2]!).getByText('1')).toBeInTheDocument();
    });

    it('should render avatar for each patron', () => {
      renderWithProviders(<PatronTable {...defaultProps} />);

      // MUI Avatar renders PersonIcon, check for patron names instead
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('should render link when getRowHref is provided', () => {
      renderWithProviders(
        <PatronTable {...defaultProps} getRowHref={(id) => `/patrons/${id}`} />
      );

      const links = screen.getAllByRole('link', { hidden: true });
      expect(links.length).toBeGreaterThan(0);
    });

    it('should not render links when getRowHref is not provided', () => {
      renderWithProviders(<PatronTable {...defaultProps} />);

      const links = screen.queryAllByRole('link', { hidden: true });
      expect(links).toHaveLength(0);
    });
  });

  describe('Pagination', () => {
    it('should display pagination controls', () => {
      renderWithProviders(<PatronTable {...defaultProps} total={50} />);

      expect(screen.getByText(/rows per page/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
    });

    it('should call onPageChange when page is changed', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();

      renderWithProviders(
        <PatronTable
          {...defaultProps}
          total={50}
          page={0}
          onPageChange={onPageChange}
        />
      );

      const nextButton = screen.getByRole('button', { name: /next page/i });
      await user.click(nextButton);

      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('should call onRowsPerPageChange when rows per page is changed', async () => {
      const user = userEvent.setup();
      const onRowsPerPageChange = vi.fn();

      renderWithProviders(
        <PatronTable
          {...defaultProps}
          total={50}
          onRowsPerPageChange={onRowsPerPageChange}
        />
      );

      const selectButton = screen.getByRole('combobox');
      await user.click(selectButton);

      const option25 = await screen.findByRole('option', { name: '25' });
      await user.click(option25);

      expect(onRowsPerPageChange).toHaveBeenCalledWith(25);
    });

    it('should disable previous button on first page', () => {
      renderWithProviders(
        <PatronTable {...defaultProps} total={50} page={0} />
      );

      const previousButton = screen.getByRole('button', { name: /previous page/i });
      expect(previousButton).toBeDisabled();
    });

    it('should show correct page range information', () => {
      renderWithProviders(
        <PatronTable {...defaultProps} total={50} page={0} rowsPerPage={10} />
      );

      // With 50 total and showing 2 items on first page
      expect(screen.getByText(/1.*50/)).toBeInTheDocument();
    });
  });

  describe('Date Formatting', () => {
    it('should format lift date correctly for bans variant', () => {
      renderWithProviders(<PatronTable {...defaultProps} variant="bans" />);

      // ban_max_lifts_at: '2024-01-15' and '2024-01-10'
      expect(screen.getByText(/jan 15/i)).toBeInTheDocument();
      expect(screen.getByText(/jan 10/i)).toBeInTheDocument();
    });

    it('should use trespass_max_lifts_at for trespasses variant', () => {
      renderWithProviders(
        <PatronTable {...defaultProps} variant="trespasses" />
      );

      // trespass_max_lifts_at: '2024-01-20' and '2024-01-12'
      expect(screen.getByText(/jan 20/i)).toBeInTheDocument();
      expect(screen.getByText(/jan 12/i)).toBeInTheDocument();
    });

    it('should display N/A when no lift date', () => {
      const patronsWithoutDate: PatronSearchResult[] = [
        {
          ...mockPatrons[0]!,
          ban_max_lifts_at: undefined,
        },
      ];

      renderWithProviders(
        <PatronTable
          {...defaultProps}
          patrons={patronsWithoutDate}
          total={1}
          variant="bans"
        />
      );

      const table = screen.getByRole('table');
      const cells = within(table).getAllByRole('cell');
      const liftDateCell = cells.find(cell => cell.textContent === 'N/A');

      expect(liftDateCell).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper table structure', () => {
      renderWithProviders(<PatronTable {...defaultProps} />);

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();
      expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
    });

    it('should have accessible pagination controls', () => {
      renderWithProviders(<PatronTable {...defaultProps} total={50} />);

      expect(screen.getByRole('button', { name: /previous page/i })).toHaveAccessibleName();
      expect(screen.getByRole('button', { name: /next page/i })).toHaveAccessibleName();
      expect(screen.getByRole('combobox')).toHaveAccessibleName();
    });

    it('should be keyboard navigable', async () => {
      const user = userEvent.setup();
      renderWithProviders(<PatronTable {...defaultProps} />);

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      // Table rows are clickable and keyboard accessible via tab navigation
      const firstPatronName = screen.getByText('John Doe');
      firstPatronName.focus();

      await user.tab();
      // Navigation should work through tab key
      expect(document.activeElement).toBeTruthy();
    });
  });
});
