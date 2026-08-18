import { currentGet, currentPost } from './client';
import type {
  ReviewGroupWithMembers,
  ReviewChainEntry,
} from '../types';

export const reviewGroupApi = {
  async get(id: number): Promise<ReviewGroupWithMembers> {
    return currentGet<ReviewGroupWithMembers>(`/review-group/${id}`);
  },
};

export const reviewChainApi = {
  async list(orgUnit: string): Promise<ReviewChainEntry[]> {
    return currentPost<ReviewChainEntry[]>('/review-chain/list', { org_unit: orgUnit });
  },

  async save(
    orgUnit: string,
    levels: Array<{
      id?: number;
      reviewer_group?: number;
      require_peer_review?: boolean;
      members: Array<{ usr: string }>;
    }>
  ): Promise<{ saved: boolean; level_count: number }> {
    return currentPost('/review-chain/save', { org_unit: orgUnit, levels });
  },

  async hasReviewChain(orgUnit: string): Promise<boolean> {
    return currentPost<boolean>('/review-chain/has', { org_unit: orgUnit });
  },
};
