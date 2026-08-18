import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { useAuth } from './auth-context';
import { notificationsApi, InboxNotification, InboxListResponse } from '../api/notifications';

interface NotificationContextType {
  notifications: InboxNotification[];
  total: number;
  unreadCount: number;
  loading: boolean;
  initialLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markAsRead: (deliveryId: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismiss: (deliveryId: number) => Promise<void>;
  dismissAll: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: ReactNode;
  pollInterval?: number;
}

// TODO: in long term, consider pushed-based updates instead of polling
const DEFAULT_POLL_INTERVAL = 30000; // 30 seconds
const PAGE_SIZE = 50;

export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
  pollInterval = DEFAULT_POLL_INTERVAL,
}) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const hasFetchedRef = useRef(false);

  const fetchNotifications = useCallback(async (fetchOffset = 0, append = false) => {
    if (!user) return;

    const isInitialFetch = !hasFetchedRef.current;

    try {
      setLoading(true);
      setError(null);

      const response: InboxListResponse = await notificationsApi.list({
        limit: PAGE_SIZE,
        offset: fetchOffset,
      });

      if (!isMountedRef.current) return;

      if (append) {
        setNotifications(prev => [...prev, ...response.notifications]);
      } else {
        setNotifications(response.notifications);
      }
      setTotal(response.total);
      setUnreadCount(response.unread_count);
      setOffset(fetchOffset + response.notifications.length);
      hasFetchedRef.current = true;
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('Failed to fetch notifications:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch notifications');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        if (isInitialFetch) {
          setInitialLoading(false);
        }
      }
    }
  }, [user]);

  const refresh = useCallback(async () => {
    setOffset(0);
    await fetchNotifications(0, false);
  }, [fetchNotifications]);

  const loadMore = useCallback(async () => {
    if (loading || notifications.length >= total) return;
    await fetchNotifications(offset, true);
  }, [loading, notifications.length, total, offset, fetchNotifications]);

  const markAsRead = useCallback(async (deliveryId: number) => {
    try {
      await notificationsApi.markRead(deliveryId);

      setNotifications(prev =>
        prev.map(n =>
          n.delivery_id === deliveryId ? { ...n, is_read: true } : n
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
      // Refresh to get correct state
      await refresh();
    }
  }, [refresh]);

  const markAllAsRead = useCallback(async () => {
    try {
      await notificationsApi.markAllRead();

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
      await refresh();
    }
  }, [refresh]);

  const dismiss = useCallback(async (deliveryId: number) => {
    try {
      await notificationsApi.dismiss(deliveryId);

      setNotifications(prev => prev.filter(n => n.delivery_id !== deliveryId));
      setTotal(prev => Math.max(0, prev - 1));

      // Also update unread count if it was unread
      const notification = notifications.find(n => n.delivery_id === deliveryId);
      if (notification && !notification.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Failed to dismiss notification:', err);
      await refresh();
    }
  }, [notifications, refresh]);

  const dismissAll = useCallback(async () => {
    try {
      await notificationsApi.dismissAll();

      setNotifications([]);
      setTotal(0);
      setUnreadCount(0);
      setOffset(0);
    } catch (err) {
      console.error('Failed to dismiss all notifications:', err);
      await refresh();
    }
  }, [refresh]);

  // Initial fetch when user logs in
  useEffect(() => {
    isMountedRef.current = true;

    if (user) {
      fetchNotifications(0, false);
    } else {
      // Clear state when user logs out
      setNotifications([]);
      setTotal(0);
      setUnreadCount(0);
      setOffset(0);
      setInitialLoading(true);
      hasFetchedRef.current = false;
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [user, fetchNotifications]);

  // Set up polling
  useEffect(() => {
    if (!user || pollInterval <= 0) return;

    pollingRef.current = setInterval(() => {
      fetchNotifications(0, false);
    }, pollInterval);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [user, pollInterval, fetchNotifications]);

  const hasMore = notifications.length < total;

  const value: NotificationContextType = {
    notifications,
    total,
    unreadCount,
    loading,
    initialLoading,
    error,
    refresh,
    markAsRead,
    markAllAsRead,
    dismiss,
    dismissAll,
    loadMore,
    hasMore,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export default NotificationContext;
