import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';

export interface BanNeedingLetter {
  banId: number;
  isTrespass: boolean;
  patronName: string;
}

interface BanLetterPromptDialogProps {
  open: boolean;
  bans: BanNeedingLetter[];
  locationName: string;
  /** Open the ban's edit page, where a new letter can be generated. */
  onGenerate: (banId: number) => void;
  onSkip: () => void;
}

/**
 * Shown after an incident with active bans or trespasses moves to another
 * location. Letters already generated stay on file (patrons may hold a
 * printed copy) but name the old location, so staff are offered a new one.
 */
export const BanLetterPromptDialog: React.FC<BanLetterPromptDialogProps> = ({
  open,
  bans,
  locationName,
  onGenerate,
  onSkip,
}) => (
  <Dialog open={open} onClose={onSkip} maxWidth="sm" fullWidth>
    <DialogTitle>Generate new ban letters?</DialogTitle>
    <DialogContent>
      <DialogContentText sx={{ mb: 1 }}>
        {bans.length === 1 ? 'This incident’s ban/trespass now applies' : 'This incident’s bans/trespasses now apply'}{' '}
        at {locationName}. Letters printed before the move are kept on file but still name the
        previous location. Generating opens each letter rebuilt for the new location, ready to
        review and save.
      </DialogContentText>
      <List dense>
        {bans.map((b) => (
          <ListItem
            key={b.banId}
            secondaryAction={
              <Button size="small" variant="outlined" onClick={() => onGenerate(b.banId)}>
                Generate letter
              </Button>
            }
          >
            <ListItemText
              primary={b.patronName}
              secondary={`${b.isTrespass ? 'Trespass' : 'Ban'} #${b.banId}`}
            />
          </ListItem>
        ))}
      </List>
    </DialogContent>
    <DialogActions>
      <Button onClick={onSkip}>Later</Button>
    </DialogActions>
  </Dialog>
);
