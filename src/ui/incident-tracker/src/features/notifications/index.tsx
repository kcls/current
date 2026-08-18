import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Alert,
  Tabs,
  Tab,
  Divider,
  Button,
  Skeleton,
  CircularProgress,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  DoneAll as DoneAllIcon,
  ClearAll as ClearAllIcon,
} from '@mui/icons-material';
import { PageContainer } from '../../shared/components/layout';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { useNotifications } from '../../contexts/notification-context';
import { useToast } from '../../contexts/toast-context';
import { NotificationRow } from './components/notification-row';
import { NotificationEmptyState } from './components/notification-empty-state';
import { InboxNotification } from '../../api/notifications';

type TabValue = 'all' | 'unread';
type DateGroup = 'today' | 'yesterday' | 'lastWeek' | 'older';

interface GroupedNotifications {
  today: InboxNotification[];
  yesterday: InboxNotification[];
  lastWeek: InboxNotification[];
  older: InboxNotification[];
}

const HeaderContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: theme.spacing(3),
  [theme.breakpoints.down('sm')]: {
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
}));

const TabsContainer = styled(Box)(({ theme }) => ({
  borderBottom: `1px solid ${theme.palette.divider}`,
  marginBottom: theme.spacing(2),
}));

const ActionsContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
}));

const GroupHeader = styled(Typography)(({ theme }) => ({
  padding: theme.spacing(1.5, 2),
  backgroundColor: theme.palette.action.hover,
  fontWeight: 600,
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: theme.palette.text.secondary,
}));


const LoadMoreContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  textAlign: 'center',
  borderTop: `1px solid ${theme.palette.divider}`,
}));

const getDateGroup = (dateString: string): DateGroup => {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const notificationDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (notificationDate >= today) {
    return 'today';
  } else if (notificationDate >= yesterday) {
    return 'yesterday';
  } else if (notificationDate >= lastWeek) {
    return 'lastWeek';
  }
  return 'older';
};

const groupNotifications = (notifications: InboxNotification[]): GroupedNotifications => {
  const groups: GroupedNotifications = {
    today: [],
    yesterday: [],
    lastWeek: [],
    older: [],
  };

  notifications.forEach(notification => {
    const group = getDateGroup(notification.created_at);
    groups[group].push(notification);
  });

  return groups;
};

const GROUP_LABELS: Record<DateGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  lastWeek: 'Last 7 Days',
  older: 'Older Notifications',
};

const Notifications: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const {
    notifications,
    total,
    unreadCount,
    loading,
    initialLoading,
    error,
    markAsRead,
    markAllAsRead,
    dismiss,
    dismissAll,
    loadMore,
    hasMore,
  } = useNotifications();
  const [tab, setTab] = useState<TabValue>('all');
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [isDismissingAll, setIsDismissingAll] = useState(false);
  const [showDismissAllDialog, setShowDismissAllDialog] = useState(false);

  const filteredNotifications = useMemo(() => {
    if (tab === 'unread') {
      return notifications.filter(n => !n.is_read);
    }
    return notifications;
  }, [notifications, tab]);

  const groupedNotifications = useMemo(() => {
    return groupNotifications(filteredNotifications);
  }, [filteredNotifications]);

  const handleTabChange = (_: React.SyntheticEvent, newValue: TabValue) => {
    setTab(newValue);
  };

  const handleNotificationAction = async (notification: InboxNotification) => {
    if (!notification.is_read) {
      await markAsRead(notification.delivery_id);
    }
  };

  const handleDismiss = async (deliveryId: number) => {
    await dismiss(deliveryId);
  };

  const handleLoadMore = () => {
    loadMore();
  };

  const handleMarkAllAsRead = async () => {
    setIsMarkingAllRead(true);
    try {
      await markAllAsRead();
      showSuccess('All notifications marked as read');
    } catch (err) {
      showError('Failed to mark notifications as read');
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const handleDismissAllClick = () => {
    setShowDismissAllDialog(true);
  };

  const handleDismissAllConfirm = async () => {
    setShowDismissAllDialog(false);
    setIsDismissingAll(true);
    try {
      await dismissAll();
      showSuccess('All notifications cleared');
    } catch (err) {
      showError('Failed to clear notifications');
    } finally {
      setIsDismissingAll(false);
    }
  };

  const handleDismissAllCancel = () => {
    setShowDismissAllDialog(false);
  };

  const showLoadMore = tab === 'all' && hasMore;

  const renderNotificationGroups = () => {
    const groups: DateGroup[] = ['today', 'yesterday', 'lastWeek', 'older'];
    const hasAnyNotifications = groups.some(group => groupedNotifications[group].length > 0);

    if (!hasAnyNotifications) {
      return <NotificationEmptyState />;
    }

    return groups.map(group => {
      const groupNotifs = groupedNotifications[group];
      if (groupNotifs.length === 0) return null;

      return (
        <Box key={group}>
          <GroupHeader>{GROUP_LABELS[group]}</GroupHeader>
          {groupNotifs.map((notification, index) => (
            <NotificationRow
              key={notification.delivery_id}
              notification={notification}
              href={notification.action_url || undefined}
              onAction={() => handleNotificationAction(notification)}
              onDismiss={() => handleDismiss(notification.delivery_id)}
              isLast={index === groupNotifs.length - 1}
            />
          ))}
        </Box>
      );
    });
  };

  return (
    <PageContainer maxWidth="md">
      <HeaderContainer>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Notifications
          </Typography>
        </Box>
      </HeaderContainer>

      {/* TODO: re-enable when notification preferences backend is ready */}
      {/* <NotificationPreferences /> */}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Error loading notifications: {error}
        </Alert>
      )}

      <Paper elevation={1}>
        <Box px={2} pt={2} display="flex" justifyContent="space-between" alignItems="center">
          <TabsContainer sx={{ borderBottom: 'none', mb: 0 }}>
            <Tabs
              value={tab}
              onChange={handleTabChange}
              aria-label="notification tabs"
            >
              <Tab
                label="All"
                value="all"
                sx={{ minWidth: 65 }}
              />
              <Tab
                label={`Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
                value="unread"
                sx={{ minWidth: 65 }}
              />
            </Tabs>
          </TabsContainer>

          <ActionsContainer>
            <Button
              size="small"
              startIcon={isMarkingAllRead ? <CircularProgress size={16} /> : <DoneAllIcon />}
              onClick={handleMarkAllAsRead}
              disabled={unreadCount === 0 || isMarkingAllRead}
            >
              {isMarkingAllRead ? 'Marking...' : 'Mark all as read'}
            </Button>
            <Button
              size="small"
              startIcon={isDismissingAll ? <CircularProgress size={16} /> : <ClearAllIcon />}
              onClick={handleDismissAllClick}
              disabled={total === 0 || isDismissingAll}
              sx={{ color: 'text.secondary' }}
            >
              {isDismissingAll ? 'Clearing...' : 'Clear all'}
            </Button>
          </ActionsContainer>
        </Box>

        <Divider />

        {initialLoading ? (
          <Box p={2}>
            {[...Array(5)].map((_, i) => (
              <Box key={i} display="flex" gap={2} mb={2}>
                <Skeleton variant="circular" width={8} height={8} sx={{ mt: 1 }} />
                <Box flex={1}>
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="80%" />
                  <Skeleton variant="text" width="30%" />
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Box>
            {renderNotificationGroups()}

            {showLoadMore && (
              <LoadMoreContainer>
                <Button
                  variant="outlined"
                  onClick={handleLoadMore}
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} /> : null}
                >
                  {loading ? 'Loading...' : 'Load More'}
                </Button>
              </LoadMoreContainer>
            )}
          </Box>
        )}
      </Paper>

      <ConfirmDialog
        open={showDismissAllDialog}
        title="Clear all notifications?"
        message="This will remove all notifications from your inbox. This action cannot be undone."
        confirmLabel="Clear All"
        confirmColor="error"
        onConfirm={handleDismissAllConfirm}
        onCancel={handleDismissAllCancel}
      />
    </PageContainer>
  );
};

export default Notifications;
