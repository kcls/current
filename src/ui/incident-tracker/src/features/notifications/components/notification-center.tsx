import { useState } from 'react';
import {
  Badge,
  Drawer,
  IconButton,
  Popover,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { Notifications as NotificationsIcon } from '@mui/icons-material';
import { useNotifications } from '../../../contexts/notification-context';
import { NotificationPanel } from './notification-panel';

const BellBadge = styled(Badge)({
  '& .MuiBadge-badge': {
    fontSize: '0.65rem',
    height: 16,
    minWidth: 16,
  },
});

const NotificationCenter: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { unreadCount } = useNotifications();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isOpen = isMobile ? drawerOpen : Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    if (isMobile) {
      setDrawerOpen(true);
    } else {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
    setDrawerOpen(false);
  };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton color="inherit" onClick={handleOpen} sx={{ mr: 1 }}>
          <BellBadge badgeContent={unreadCount} color="error" max={99}>
            <NotificationsIcon />
          </BellBadge>
        </IconButton>
      </Tooltip>

      {!isMobile && (
        <Popover
          open={isOpen}
          anchorEl={anchorEl}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{
            paper: {
              elevation: 4,
              sx: { mt: 1, borderRadius: 2, overflow: 'hidden' },
            },
          }}
        >
          <NotificationPanel isMobile={false} onClose={handleClose} />
        </Popover>
      )}

      {isMobile && (
        <Drawer
          anchor="right"
          open={drawerOpen}
          onClose={handleClose}
          PaperProps={{ sx: { width: '100%', maxWidth: 400 } }}
        >
          <NotificationPanel isMobile onClose={handleClose} />
        </Drawer>
      )}
    </>
  );
};

export default NotificationCenter;
