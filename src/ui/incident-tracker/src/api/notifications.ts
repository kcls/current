/**
 * Notifications API adapter — talks to odo-notify's `/inbox/*` REST
 * endpoints via the shared `notifyPost` helper.
 *
 * The wire response includes an additional `event_id` field the UI
 * doesn't yet model; it's ignored on deserialization because our
 * `InboxNotification` interface is structurally typed.
 */

import { notifyPost } from './client';

export interface InboxNotification {
  delivery_id: number;
  template_code: string | null;
  title: string;
  body: string | null;
  action_url: string | null;
  source_service: string | null;
  source_entity_type: string | null;
  source_entity_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface InboxListResponse {
  notifications: InboxNotification[];
  total: number;
  unread_count: number;
}

export interface InboxListParams {
  limit?: number;
  offset?: number;
}

class NotificationsApi {
  /**
   * Get notifications for the current user
   */
  async list(params: InboxListParams = {}): Promise<InboxListResponse> {
    return await notifyPost<InboxListResponse>('/inbox/list', {
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    });
  }

  /**
   * Mark a single notification as read
   */
  async markRead(deliveryId: number): Promise<void> {
    await notifyPost('/inbox/mark-read', { delivery_id: deliveryId });
  }

  /**
   * Mark all notifications as read
   */
  async markAllRead(): Promise<void> {
    await notifyPost('/inbox/mark-all-read', {});
  }

  /**
   * Dismiss a single notification (hide from inbox)
   */
  async dismiss(deliveryId: number): Promise<void> {
    await notifyPost('/inbox/dismiss', { delivery_id: deliveryId });
  }

  /**
   * Dismiss all notifications
   */
  async dismissAll(): Promise<void> {
    await notifyPost('/inbox/dismiss-all', {});
  }
}

export const notificationsApi = new NotificationsApi();
