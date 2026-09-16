/**
 * Shift Notes API adapter — see design-docs/shift-notes.md
 */

import { currentPost } from './client';
import type {
  ShiftNote,
  ShiftNoteConductArea,
  ShiftNoteListParams,
  ShiftNoteListResponse,
  ShiftNoteType,
  ShiftNoteWriteParams,
} from '../types';

export const shiftNotesApi = {
  /**
   * Notes at or below `org_unit`, newest first.
   *
   * Pass `since` (the newest `created_at` already displayed) to poll
   * cheaply — a quiet poll comes back with no rows.
   */
  async list(params: ShiftNoteListParams): Promise<ShiftNoteListResponse> {
    return currentPost<ShiftNoteListResponse>('/shift-note/list', params);
  },

  async create(params: ShiftNoteWriteParams): Promise<{ id: number }> {
    return currentPost<{ id: number }>('/shift-note/create', params);
  },

  /**
   * Edit a note. `org_unit` is not editable — a note stays filed where it
   * happened. Omitted `conduct_areas`/`attachments` clear the set.
   */
  async update(
    id: number,
    params: Omit<ShiftNoteWriteParams, 'org_unit'>,
  ): Promise<{ id: number }> {
    return currentPost<{ id: number }>('/shift-note/update', { id, ...params });
  },

  async remove(id: number): Promise<{ id: number; deleted: boolean }> {
    return currentPost<{ id: number; deleted: boolean }>('/shift-note/delete', { id });
  },

  async listTypes(): Promise<ShiftNoteType[]> {
    const response = await currentPost<{ items?: ShiftNoteType[] }>(
      '/shift-note/type/list',
      {},
    );
    return response.items ?? [];
  },

  async listConductAreas(): Promise<ShiftNoteConductArea[]> {
    const response = await currentPost<{ items?: ShiftNoteConductArea[] }>(
      '/shift-note/conduct-area/list',
      {},
    );
    return response.items ?? [];
  },
};

export type { ShiftNote };
