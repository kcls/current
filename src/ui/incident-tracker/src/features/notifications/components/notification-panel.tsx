import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  CircularProgress,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../../../constants';
import { useNotifications } from '../../../contexts/notification-context';
import { InboxNotification } from '../../../api/notifications';
import { NotificationRow } from './notification-row';
import { NotificationEmptyState } from './notification-empty-state';

const MAX_VISIBLE_NOTIFICATIONS = 10;
const PANEL_WIDTH = 380;
const PANEL_MAX_HEIGHT = 480;

type NotificationTabValue = 'all' | 'unread';

const PanelContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})<{ isMobile: boolean }>(({ theme, isMobile }) => ({
  width: isMobile ? '100%' : PANEL_WIDTH,
  maxHeight: isMobile ? '100vh' : PANEL_MAX_HEIGHT,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: theme.palette.background.paper,
}));

const Header = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2, 2, 1, 2),
}));

const TabsContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(0, 2),
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

const StyledTabs = styled(Tabs)({
  minHeight: 40,
  '& .MuiTab-root': {
    minHeight: 40,
    textTransform: 'none',
    fontSize: '0.875rem',
    fontWeight: 500,
    minWidth: 65,
  },
});

const ListContainer = styled(Box)({
  flex: 1,
  overflow: 'auto',
});

const LoadingContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'center',
  padding: theme.spacing(6, 0),
}));

const SeeAllContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(1.5, 0),
  textAlign: 'center',
  borderTop: `1px solid ${theme.palette.divider}`,
}));

const SeeAllButton = styled(Button)<{ component?: React.ElementType; to?: string }>(({ theme }) => ({
  textTransform: 'none',
  color: theme.palette.text.secondary,
  fontSize: '0.8125rem',
  '&:hover': {
    backgroundColor: 'transparent',
    color: theme.palette.primary.main,
  },
}));

const UnreadBadge = styled(Badge)(({ theme }) => ({
  '& .MuiBadge-badge': {
    position: 'relative',
    transform: 'none',
    fontSize: '0.7rem',
    height: 18,
    borderRadius: 9,
  },
}));

export interface NotificationPanelProps {
  isMobile: boolean;
  onClose: () => void;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  isMobile,
  onClose,
}) => {
  const {
    notifications,
    unreadCount,
    initialLoading,
    markAsRead,
    dismiss,
  } = useNotifications();

  const [activeTab, setActiveTab] = useState<NotificationTabValue>('all');

  const filteredNotifications =
    activeTab === 'unread'
      ? notifications.filter((n) => !n.is_read)
      : notifications;

  const visibleNotifications = filteredNotifications.slice(0, MAX_VISIBLE_NOTIFICATIONS);
  const isLastItem = (index: number) =>
    index === visibleNotifications.length - 1 && filteredNotifications.length <= MAX_VISIBLE_NOTIFICATIONS;

  const getActionHref = (url: string): string => {
    if (url.startsWith('/')) {
      return url;
    }
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  };

  const handleNotificationAction = (notification: InboxNotification) => {
    if (!notification.is_read) {
      markAsRead(notification.delivery_id);
    }
    if (notification.action_url) {
      onClose();
    }
  };

  const handleTabChange = (_: React.SyntheticEvent, value: NotificationTabValue) => {
    setActiveTab(value);
  };

  return (
    <PanelContainer isMobile={isMobile}>
      <Header>
        <Typography variant="h6" fontWeight={600}>
          Notifications
        </Typography>
      </Header>

      <TabsContainer>
        <StyledTabs value={activeTab} onChange={handleTabChange}>
          <Tab label="All" value="all" />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                Unread
                {unreadCount > 0 && (
                  <UnreadBadge badgeContent={unreadCount} color="error" />
                )}
              </Box>
            }
            value="unread"
          />
        </StyledTabs>
      </TabsContainer>

      <ListContainer>
        {initialLoading ? (
          <LoadingContainer>
            <CircularProgress size={24} />
          </LoadingContainer>
        ) : filteredNotifications.length === 0 ? (
          <NotificationEmptyState />
        ) : (
          <>
            {visibleNotifications.map((notification, index) => (
              <NotificationRow
                key={notification.delivery_id}
                notification={notification}
                href={notification.action_url ? getActionHref(notification.action_url) : undefined}
                onAction={() => handleNotificationAction(notification)}
                onDismiss={() => dismiss(notification.delivery_id)}
                isLast={isLastItem(index)}
              />
            ))}

            {filteredNotifications.length > 0 && (
              <SeeAllContainer>
                <SeeAllButton
                  component={RouterLink}
                  to={ROUTES.NOTIFICATIONS}
                  size="small"
                  onClick={onClose}
                >
                  See All Notifications
                </SeeAllButton>
              </SeeAllContainer>
            )}
          </>
        )}
      </ListContainer>
    </PanelContainer>
  );
};
