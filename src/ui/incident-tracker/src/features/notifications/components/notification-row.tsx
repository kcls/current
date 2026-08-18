import { Box, IconButton, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import {
  Close as CloseIcon,
  FiberManualRecord as DotIcon,
} from '@mui/icons-material';
import { InboxNotification } from '../../../api/notifications';
import { formatRelativeTime } from '../../../shared/utils/date-utils';

const RowContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isClickable' && prop !== 'isLast',
})<{ isClickable: boolean; isLast: boolean }>(({ theme, isClickable, isLast }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1.5, 2),
  cursor: isClickable ? 'pointer' : 'default',
  borderBottom: isLast ? 'none' : `1px solid ${theme.palette.divider}`,
  transition: 'background-color 0.15s ease',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

const UnreadIndicator = styled(Box)(({ theme }) => ({
  paddingTop: theme.spacing(0.5),
  width: 8,
  flexShrink: 0,
}));

const ContentContainer = styled(Box)({
  flex: 1,
  minWidth: 0,
});

const TitleText = styled(Typography, {
  shouldForwardProp: (prop) => prop !== 'isRead',
})<{ isRead: boolean }>(({ isRead }) => ({
  fontWeight: isRead ? 400 : 600,
  lineHeight: 1.4,
}));

const BodyText = styled(Typography)(({ theme }) => ({
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  lineHeight: 1.4,
  marginBottom: theme.spacing(0.5),
}));

const DismissButton = styled(IconButton)(({ theme }) => ({
  padding: theme.spacing(1),
  margin: theme.spacing(-0.5),
  color: theme.palette.text.disabled,
  '&:hover': {
    color: theme.palette.text.secondary,
    backgroundColor: theme.palette.action.hover,
  },
}));

export interface NotificationRowProps {
  notification: InboxNotification;
  href?: string;
  onAction: () => void;
  onDismiss: () => void;
  isLast: boolean;
}

export const NotificationRow: React.FC<NotificationRowProps> = ({
  notification,
  href,
  onAction,
  onDismiss,
  isLast,
}) => {
  const handleDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDismiss();
  };

  return (
    <RowContainer
      {...(href ? { component: RouterLink, to: href } : {})}
      onClick={onAction}
      isClickable={Boolean(notification.action_url)}
      isLast={isLast}
      sx={href ? { textDecoration: 'none', color: 'inherit' } : undefined}
    >
      <UnreadIndicator>
        {!notification.is_read && (
          <DotIcon sx={{ fontSize: 8, color: 'primary.main' }} />
        )}
      </UnreadIndicator>

      <ContentContainer>
        <TitleText
          variant="body2"
          color="text.primary"
          isRead={notification.is_read}
          sx={{ mb: notification.body ? 0.25 : 0 }}
        >
          {notification.title}
        </TitleText>

        {notification.body && (
          <BodyText variant="caption" color="text.secondary">
            {notification.body}
          </BodyText>
        )}

        <Typography variant="caption" color="text.disabled" display="block">
          {formatRelativeTime(notification.created_at)}
        </Typography>
      </ContentContainer>

      <DismissButton size="small" onClick={handleDismiss}>
        <CloseIcon sx={{ fontSize: 16 }} />
      </DismissButton>
    </RowContainer>
  );
};
