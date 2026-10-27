import type { Category } from '../types';
import { currentPost } from './client';

export interface CategoryInput {
  code: string;
  label: string;
  description: string;
  icon: string;
  display_order: number;
  is_active: boolean;
}

export const categoryApi = {
  /**
   * List template categories, ordered for display
   */
  async list(params: { is_active?: boolean } = {}): Promise<Category[]> {
    const response = await currentPost<Category[]>('/category/list', params);
    return Array.isArray(response) ? response : [];
  },

  /**
   * Create a category
   */
  async create(input: CategoryInput): Promise<Category> {
    return currentPost<Category>('/category/create', input);
  },

  /**
   * Replace a category's values; `code` selects it and cannot change
   */
  async update(input: CategoryInput): Promise<Category> {
    return currentPost<Category>('/category/update', input);
  },
};
