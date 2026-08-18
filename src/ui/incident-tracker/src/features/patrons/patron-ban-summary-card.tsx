import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  Divider,
  Alert,
  Link,
} from '@mui/material';
import {
  Event as EventIcon,
  OpenInNew as OpenInNewIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import type { PatronBan } from '../../types';
import {
  isTimestampPast,
  formatBanDate,
} from '../../shared/utils/date-utils';
import { getBanStatus } from '../../shared/utils/ban-status';

interface PatronBanSummaryCardProps {
  ban: PatronBan;
  patronId?: number;
  patronName?: string;
  orgUnitName?: string;
  showPatronInfo?: boolean;
}

export const PatronBanSummaryCard: React.FC<PatronBanSummaryCardProps> = ({
  ban,
  patronId,
  patronName,
  orgUnitName,
  showPatronInfo = false,
}) => {
  const status = getBanStatus(ban);

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Box display="flex" alignItems="flex-start" mb={2}>
          <Box flex={1}>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <Link
                component={RouterLink}
                to={`/bans/${ban.id}`}
                variant="body1"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
              >
                {ban.is_trespass ? 'Trespass' : `Ban${orgUnitName ? ` at ${orgUnitName}` : ''}`}
                <OpenInNewIcon sx={{ fontSize: 16 }} />
              </Link>
              <Chip
                label={status.label}
                color={status.color}
                size="small"
              />
            </Box>

            {showPatronInfo && patronName && patronId && (
              <Typography variant="body2" color="text.secondary">
                Patron:{' '}
                <Link
                  component={RouterLink}
                  to={`/patrons/${patronId}`}
                  variant="body2"
                  sx={{
                    textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' },
                  }}
                >
                  {patronName}
                </Link>
              </Typography>
            )}
          </Box>
        </Box>

        <Divider sx={{ mb: 2 }} />

        <Box display="flex" flexDirection="column" gap={1.5}>
          <Box display="flex" gap={3} flexWrap="wrap">
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Start Date
              </Typography>
              <Box display="flex" alignItems="center" gap={0.5}>
                <EventIcon fontSize="small" color="action" />
                <Typography variant="body2">
                  {formatBanDate(ban.starts_at)}
                </Typography>
              </Box>
            </Box>

            {ban.lifts_at && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Lift Date
                </Typography>
                <Box display="flex" alignItems="center" gap={0.5}>
                  {ban.lifts_at && isTimestampPast(ban.lifts_at) ? (
                    <>
                      {ban.is_trespass ? (
                        <>
                          <ScheduleIcon fontSize="small" color="warning" />
                          <Typography variant="body2" color="warning.main">
                            {formatBanDate(ban.lifts_at)} (Eligible)
                          </Typography>
                        </>
                      ) : (
                        <>
                          <ScheduleIcon fontSize="small" color="success" />
                          <Typography variant="body2" color="success.main">
                            {formatBanDate(ban.lifts_at)} (Lifted)
                          </Typography>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <ScheduleIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {formatBanDate(ban.lifts_at)}
                      </Typography>
                    </>
                  )}
                </Box>
              </Box>
            )}

            {ban.archives_at && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Archive Date
                </Typography>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <ScheduleIcon fontSize="small" color="action" />
                  <Typography variant="body2">
                    {formatBanDate(ban.archives_at)}
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>

          {ban.comments && (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Comments
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {ban.comments}
              </Typography>
            </Box>
          )}

          {ban.archived_by && (
            <Alert severity="info" sx={{ mt: 1 }}>
              This {ban.is_trespass ? 'trespass' : 'ban'} has been archived.
            </Alert>
          )}
          {ban.lifts_at && isTimestampPast(ban.lifts_at) && !ban.archived_by && !ban.is_trespass && (
            <Alert severity="success" sx={{ mt: 1 }}>
              This ban was automatically lifted on {formatBanDate(ban.lifts_at)}.
            </Alert>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default PatronBanSummaryCard;
