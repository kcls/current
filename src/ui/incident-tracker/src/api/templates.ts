import type { IncidentTemplate } from '../types';
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

  // ------------------------------------------------------------------
  // Write operations — not yet supported by the backend.
  // Commented out to prevent accidental use until backend CUD endpoints
  // are implemented.
  // ------------------------------------------------------------------

  /*
  async create(template: Omit<IncidentTemplate, 'id' | 'created_at' | 'updated_at'>): Promise<IncidentTemplate> {
    throw new Error('templates.create not yet implemented');
  },

  async update(id: string | number, updates: Partial<IncidentTemplate>): Promise<IncidentTemplate> {
    throw new Error('templates.update not yet implemented');
  },

  async delete(id: string | number): Promise<void> {
    throw new Error('templates.delete not yet implemented');
  },

  async toggleActive(id: string | number): Promise<IncidentTemplate> {
    throw new Error('templates.toggleActive not yet implemented');
  },

  async incrementUsage(id: string | number): Promise<void> {
    throw new Error('templates.incrementUsage not yet implemented');
  },
  */
};
