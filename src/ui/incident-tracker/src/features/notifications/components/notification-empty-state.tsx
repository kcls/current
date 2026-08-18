import { Box, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { SentimentSatisfiedAlt as EmptyIcon } from '@mui/icons-material';

const Container = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: theme.spacing(6, 3),
}));

const IconContainer = styled(Box)(({ theme }) => ({
  width: 80,
  height: 80,
  borderRadius: '50%',
  backgroundColor: theme.palette.action.hover,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: theme.spacing(2),
}));

export interface NotificationEmptyStateProps {
  message?: string;
}

export const NotificationEmptyState: React.FC<NotificationEmptyStateProps> = ({
  message = 'There are no notifications.',
}) => {
  return (
    <Container>
      <IconContainer>
        <EmptyIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
      </IconContainer>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Container>
  );
};
