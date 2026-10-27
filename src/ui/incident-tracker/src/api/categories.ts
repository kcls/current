import type { Category } from '../types';
import { currentPost } from './client';

export const categoryApi = {
  /**
   * List template categories, ordered for display
   */
  async list(params: { is_active?: boolean } = {}): Promise<Category[]> {
    const response = await currentPost<Category[]>('/category/list', params);
    return Array.isArray(response) ? response : [];
  },
};
