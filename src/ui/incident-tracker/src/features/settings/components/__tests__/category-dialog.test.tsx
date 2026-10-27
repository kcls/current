import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, userEvent } from '../../../../tests/test-utils';
import CategoryDialog, { codeFromLabel } from '../category-dialog';
import { categoryApi } from '../../../../api/categories';
import type { Category } from '../../../../types';

vi.mock('../../../../api/categories', () => ({
  categoryApi: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

describe('codeFromLabel', () => {
  it('derives a snake_case code', () => {
    expect(codeFromLabel('After Hours')).toBe('after_hours');
    expect(codeFromLabel('  Café & Lounge! ')).toBe('caf_lounge');
    expect(codeFromLabel('x'.repeat(60))).toHaveLength(50);
  });
});

describe('CategoryDialog', () => {
  const category: Category = {
    code: 'security',
    label: 'Security',
    description: 'Security incidents',
    icon: '🔒',
    display_order: 1,
    is_active: true,
  };

  const onClose = vi.fn();
  const onSaved = vi.fn();

  const renderDialog = (c: Category | null) =>
    renderWithProviders(
      <CategoryDialog open onClose={onClose} onSaved={onSaved} category={c} />
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates with a code derived from the label', async () => {
    vi.mocked(categoryApi.create).mockResolvedValue({ ...category, code: 'after_hours' });
    const user = userEvent.setup();
    renderDialog(null);

    await user.type(screen.getByLabelText(/Label/), 'After Hours');
    expect(screen.getByLabelText(/Code/)).toHaveValue('after_hours');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(categoryApi.create).toHaveBeenCalledTimes(1));
    expect(categoryApi.create).toHaveBeenCalledWith({
      code: 'after_hours',
      label: 'After Hours',
      description: '',
      icon: '',
      display_order: 0,
      is_active: true,
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps a hand-typed code when the label changes', async () => {
    const user = userEvent.setup();
    renderDialog(null);

    await user.type(screen.getByLabelText(/Code/), 'custom');
    await user.type(screen.getByLabelText(/Label/), 'Something Else');

    expect(screen.getByLabelText(/Code/)).toHaveValue('custom');
  });

  it('rejects an invalid code before saving', async () => {
    const user = userEvent.setup();
    renderDialog(null);

    await user.type(screen.getByLabelText(/Label/), 'x');
    const code = screen.getByLabelText(/Code/);
    await user.clear(code);
    await user.type(code, 'Bad-Code');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/Use 1-50 characters/)).toBeInTheDocument();
    expect(categoryApi.create).not.toHaveBeenCalled();
  });

  it('updates without allowing the code to change', async () => {
    vi.mocked(categoryApi.update).mockResolvedValue({ ...category, is_active: false });
    const user = userEvent.setup();
    renderDialog(category);

    expect(screen.getByLabelText(/Code/)).toBeDisabled();
    await user.click(screen.getByLabelText('Active'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(categoryApi.update).toHaveBeenCalledTimes(1));
    expect(categoryApi.update).toHaveBeenCalledWith({
      code: 'security',
      label: 'Security',
      description: 'Security incidents',
      icon: '🔒',
      display_order: 1,
      is_active: false,
    });
  });

  it('shows the server error and stays open', async () => {
    vi.mocked(categoryApi.create).mockRejectedValue(new Error('Category x already exists'));
    const user = userEvent.setup();
    renderDialog(null);

    await user.type(screen.getByLabelText(/Label/), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Category x already exists')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
