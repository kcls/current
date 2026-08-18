import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders, userEvent } from '../../../../tests/test-utils';
import { PatronInfoForm } from '../patron-info-form';
import { patronApi } from '../../../../api/patrons';

vi.mock('../../../../api/patrons', () => ({
  patronApi: {
    update: vi.fn(),
  },
}));

describe('PatronInfoForm', () => {
  const mockPatron = {
    id: 1,
    first_name: 'John',
    last_name: 'Doe',
    alias: 'JD',
    library_card: '12345',
    age_range: 4,
    metadata: { gender: 'male' },
    address_line1: '123 Main St',
    address_line2: 'Apt 4',
    city: 'Seattle',
    state_province: 'WA',
    postal_code: '98101',
    notes: 'Test patron notes',
    display_name: 'John Doe',
  };

  const mockOnUpdate = vi.fn();
  const mockOnError = vi.fn();
  const mockOnSuccess = vi.fn();

  const defaultProps = {
    patron: mockPatron,
    onUpdate: mockOnUpdate,
    onError: mockOnError,
    onSuccess: mockOnSuccess,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Read Mode', () => {
    it('should display patron information', () => {
      renderWithProviders(<PatronInfoForm {...defaultProps} />);
      expect(screen.getByText('John')).toBeInTheDocument();
      expect(screen.getByText('Doe')).toBeInTheDocument();
    });

    it('should display empty values with dash', () => {
      const emptyPatron = {
        ...mockPatron,
        alias: '',
        library_card: '',
      };
      renderWithProviders(<PatronInfoForm {...defaultProps} patron={emptyPatron} />);

      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThan(0);
    });
  });

  describe('Edit Mode', () => {
    it('should show edit form when isEditing is true', () => {
      renderWithProviders(<PatronInfoForm {...defaultProps} isEditing={true} />);

      expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    });

    it('should populate fields with current values in edit mode', () => {
      renderWithProviders(<PatronInfoForm {...defaultProps} isEditing={true} />);

      expect(screen.getByLabelText(/first name/i)).toHaveValue('John');
      expect(screen.getByLabelText(/last name/i)).toHaveValue('Doe');
    });

    it('should call onEditCancel when cancel button is clicked', async () => {
      const user = userEvent.setup();
      const mockOnEditCancel = vi.fn();
      renderWithProviders(
        <PatronInfoForm {...defaultProps} isEditing={true} onEditCancel={mockOnEditCancel} />
      );

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockOnEditCancel).toHaveBeenCalled();
    });
  });

  describe('Validation', () => {
    it('should require first name', async () => {
      const user = userEvent.setup();
      renderWithProviders(<PatronInfoForm {...defaultProps} isEditing={true} />);

      const firstNameInput = screen.getByLabelText(/first name/i);
      await user.clear(firstNameInput);
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Please fix the validation errors');
        expect(screen.getByText('First name is required')).toBeInTheDocument();
      });
    });

    it('should validate first name length', async () => {
      const user = userEvent.setup();
      renderWithProviders(<PatronInfoForm {...defaultProps} isEditing={true} />);

      const firstNameInput = screen.getByLabelText(/first name/i);
      fireEvent.change(firstNameInput, { target: { value: 'a'.repeat(101) } });
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Please fix the validation errors');
        expect(screen.getByText('First name must be 100 characters or less')).toBeInTheDocument();
      });
    });

    it('should validate last name length', async () => {
      const user = userEvent.setup();
      renderWithProviders(<PatronInfoForm {...defaultProps} isEditing={true} />);

      const lastNameInput = screen.getByLabelText(/last name/i);
      fireEvent.change(lastNameInput, { target: { value: 'a'.repeat(101) } });
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Please fix the validation errors');
        expect(screen.getByText('Last name must be 100 characters or less')).toBeInTheDocument();
      });
    });

    it('should validate alias length', async () => {
      const user = userEvent.setup();
      renderWithProviders(<PatronInfoForm {...defaultProps} isEditing={true} />);

      const aliasInput = screen.getByLabelText(/nickname\/alias/i);
      fireEvent.change(aliasInput, { target: { value: 'a'.repeat(101) } });
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Please fix the validation errors');
        expect(screen.getByText('Nickname/Alias must be 100 characters or less')).toBeInTheDocument();
      });
    });

    it('should clear error when user starts typing', async () => {
      const user = userEvent.setup();
      renderWithProviders(<PatronInfoForm {...defaultProps} isEditing={true} />);

      const firstNameInput = screen.getByLabelText(/first name/i);
      await user.clear(firstNameInput);
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByText('First name is required')).toBeInTheDocument();
      });

      await user.type(firstNameInput, 'J');

      await waitFor(() => {
        expect(screen.queryByText('First name is required')).not.toBeInTheDocument();
      });
    });
  });

  describe('Save Functionality', () => {
    it('should save successfully', async () => {
      const user = userEvent.setup();
      const mockOnEditCancel = vi.fn();
      vi.mocked(patronApi.update).mockResolvedValue({} as any);
      renderWithProviders(
        <PatronInfoForm {...defaultProps} isEditing={true} onEditCancel={mockOnEditCancel} />
      );

      const firstNameInput = screen.getByLabelText(/first name/i);
      await user.clear(firstNameInput);
      await user.type(firstNameInput, 'Jane');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(patronApi.update).toHaveBeenCalled();
        expect(mockOnSuccess).toHaveBeenCalledWith('Patron information updated');
        expect(mockOnEditCancel).toHaveBeenCalled();
      });
    });

    it('should handle save errors', async () => {
      const user = userEvent.setup();
      vi.mocked(patronApi.update).mockRejectedValue(new Error('Network error'));
      renderWithProviders(<PatronInfoForm {...defaultProps} isEditing={true} />);

      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Network error');
      });
    });
  });
});
