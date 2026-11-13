import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { authApi } from '@core';
import { renderWithProviders } from '../../../tests/test-utils';
import { ToastProvider } from '../../../contexts/toast-context';
import CategoryList from '../category-list';
import { categoryApi } from '../../../api/categories';
import { templateApi } from '../../../api/templates';
import type { Category, IncidentTemplate } from '../../../types';

vi.mock('../../../api/categories', () => ({
  categoryApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../../api/templates', () => ({
  templateApi: {
    getAll: vi.fn(),
    getActive: vi.fn(),
  },
}));

const categories: Category[] = [
  { code: 'security', label: 'Security', description: '', icon: '', display_order: 1, is_active: true },
  { code: 'retired', label: 'Retired', description: '', icon: '', display_order: 2, is_active: false },
];

const templates = [
  { id: 1, category: 'security' },
  { id: 2, category: 'security' },
] as unknown as IncidentTemplate[];

const renderPage = () =>
  renderWithProviders(
    <ToastProvider>
      <CategoryList />
    </ToastProvider>
  );

describe('CategoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(templateApi.getAll).mockResolvedValue(templates);
    (authApi as any).userHasPerm = vi.fn().mockResolvedValue(false);
  });

  it('lists categories with their template counts and status', async () => {
    vi.mocked(categoryApi.list).mockResolvedValue(categories);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Incident Categories' })).toBeInTheDocument();

    const security = (await screen.findByText('Security')).closest('tr')!;
    expect(await within(security).findByText('2')).toBeInTheDocument();
    expect(within(security).getByText('Active')).toBeInTheDocument();

    const retired = screen.getByText('Retired').closest('tr')!;
    expect(within(retired).getByText('0')).toBeInTheDocument();
    expect(within(retired).getByText('Inactive')).toBeInTheDocument();
  });

  it('hides create and edit without the write permission', async () => {
    vi.mocked(categoryApi.list).mockResolvedValue(categories);
    renderPage();
    await screen.findByText('Security');
    expect(screen.queryByRole('button', { name: /New Category/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows create and edit with the write permission', async () => {
    (authApi as any).userHasPerm = vi.fn().mockResolvedValue(true);
    vi.mocked(categoryApi.list).mockResolvedValue(categories);
    renderPage();
    expect(await screen.findByRole('button', { name: /New Category/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
  });

  it('reports a failed load instead of an empty table', async () => {
    vi.mocked(categoryApi.list).mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('No categories found')).not.toBeInTheDocument();
  });
});
