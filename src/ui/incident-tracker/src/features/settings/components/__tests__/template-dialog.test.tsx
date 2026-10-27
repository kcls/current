import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, userEvent } from '../../../../tests/test-utils';
import TemplateDialog from '../template-dialog';
import { templateApi } from '../../../../api/templates';
import type { IncidentTemplate } from '../../../../types';

vi.mock('../../../../api/templates', () => ({
  templateApi: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

describe('TemplateDialog', () => {
  const template: IncidentTemplate = {
    id: 7,
    name: 'Theft',
    description: 'Property theft',
    category: 'security',
    fields: [{ name: 'item', label: 'Item', type: 'text', required: true }],
    is_active: true,
    requires_patron: true,
    show_called_emergency: false,
  };

  const onClose = vi.fn();
  const onSaved = vi.fn();

  const renderDialog = (t: IncidentTemplate | null) =>
    renderWithProviders(
      <TemplateDialog
        open
        onClose={onClose}
        onSaved={onSaved}
        template={t}
        categories={['behavior', 'security']}
      />
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates with the edited values and keeps the existing fields', async () => {
    vi.mocked(templateApi.update).mockResolvedValue({ ...template, name: 'Theft (edited)' });
    const user = userEvent.setup();
    renderDialog(template);

    const name = screen.getByLabelText(/Name/);
    await user.clear(name);
    await user.type(name, '  Theft (edited) ');
    await user.click(screen.getByLabelText('Requires patron'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(templateApi.update).toHaveBeenCalledTimes(1));
    expect(templateApi.update).toHaveBeenCalledWith(7, {
      name: 'Theft (edited)',
      description: 'Property theft',
      category: 'security',
      fields: template.fields,
      is_active: true,
      requires_patron: false,
      show_called_emergency: false,
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('creates with empty fields and defaults', async () => {
    vi.mocked(templateApi.create).mockResolvedValue({ ...template, id: 8, name: 'New' });
    const user = userEvent.setup();
    renderDialog(null);

    await user.type(screen.getByLabelText(/Name/), 'New');
    await user.click(screen.getByLabelText(/Category/));
    await user.click(await screen.findByRole('option', { name: 'behavior' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(templateApi.create).toHaveBeenCalledTimes(1));
    expect(templateApi.create).toHaveBeenCalledWith({
      name: 'New',
      description: '',
      category: 'behavior',
      fields: [],
      is_active: true,
      requires_patron: true,
      show_called_emergency: true,
    });
  });

  it('requires a name', async () => {
    const user = userEvent.setup();
    renderDialog({ ...template, name: '' });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(templateApi.update).not.toHaveBeenCalled();
  });

  it('shows the server error and stays open', async () => {
    vi.mocked(templateApi.update).mockRejectedValue(new Error('Unknown template category: x'));
    const user = userEvent.setup();
    renderDialog(template);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Unknown template category: x')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
