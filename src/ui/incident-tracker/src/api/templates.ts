import type { IncidentTemplate, TemplateField } from '../types';
import { currentPost } from './client';

/**
 * Transform backend row to IncidentTemplate type
 */
const transformToTemplate = (instance: any): IncidentTemplate => {
  return {
    id: typeof instance.id === 'number' ? instance.id : Number(instance.id) || 0,
    name: instance.name || '',
    description: instance.description || '',
    category: instance.category || 'other',
    fields: instance.fields,
    is_active: instance.is_active !== false && instance.active !== false,
    created_at: instance.created_at,
    updated_at: instance.updated_at,
    display_order: instance.display_order,
    usage_count: instance.usage_count,
    requires_patron: instance.requires_patron,
    show_called_emergency: instance.show_called_emergency,
    resolution_checklist: instance.resolution_checklist
  };
};

export interface TemplateInput {
  name: string;
  description: string;
  category: string;
  fields?: TemplateField[];
  is_active: boolean;
  requires_patron: boolean;
  show_called_emergency: boolean;
}

async function listTemplates(params: {
  id?: number;
  is_active?: boolean;
  category?: string[];
}): Promise<IncidentTemplate[]> {
  const response = await currentPost<IncidentTemplate[]>('/template/list', params);
  return Array.isArray(response) ? response.map(transformToTemplate) : [];
}

export const templateApi = {
  /**
   * Get all templates
   */
  async getAll(): Promise<IncidentTemplate[]> {
    return listTemplates({});
  },

  /**
   * Get active templates
   */
  async getActive(): Promise<IncidentTemplate[]> {
    return listTemplates({ is_active: true });
  },

  /**
   * Get a single template by ID
   */
  async get(id: string | number): Promise<IncidentTemplate> {
    const results = await listTemplates({ id: Number(id) });
    const template = results[0];
    if (!template) throw new Error(`Template ${id} not found`);
    return template;
  },

  /**
   * Get templates by category
   */
  async getByCategory(category: string): Promise<IncidentTemplate[]> {
    return listTemplates({ category: [category], is_active: true });
  },

  /**
   * Create a template
   */
  async create(input: TemplateInput): Promise<IncidentTemplate> {
    const response = await currentPost<IncidentTemplate>('/template/create', input);
    return transformToTemplate(response);
  },

  /**
   * Replace a template's values. The server overwrites every field it is
   * sent, so `fields` must carry the template's existing form definition
   * or it is reset to empty.
   */
  async update(id: number, input: TemplateInput): Promise<IncidentTemplate> {
    const response = await currentPost<IncidentTemplate>('/template/update', { id, ...input });
    return transformToTemplate(response);
  },

  /**
   * Soft-delete a template
   */
  async delete(id: number): Promise<void> {
    await currentPost('/template/delete', { id });
  },
};
