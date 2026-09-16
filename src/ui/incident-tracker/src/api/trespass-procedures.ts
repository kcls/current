/**
 * Trespass procedure checklist API adapter
 */

import { currentPost } from './client';
import type { TrespassProcedureItem } from '../types';

export const trespassProceduresApi = {
  async list(): Promise<TrespassProcedureItem[]> {
    const response = await currentPost<{ items?: TrespassProcedureItem[] }>(
      '/trespass-procedure/list',
      {},
    );
    return response.items ?? [];
  },
};
