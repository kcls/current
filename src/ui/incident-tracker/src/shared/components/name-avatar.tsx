import React from 'react';
import { Avatar, type AvatarProps } from '@mui/material';

const PALETTE = [
  '#1976d2', // blue
  '#388e3c', // green
  '#d32f2f', // red
  '#7b1fa2', // purple
  '#f57c00', // orange
  '#0097a7', // teal
  '#5d4037', // brown
  '#455a64', // blue-grey
  '#c2185b', // pink
  '#00796b', // dark teal
];

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }
  return (parts[0]?.[0] || '?').toUpperCase();
}

interface NameAvatarProps extends Omit<AvatarProps, 'children'> {
  name: string;
  photoUrl?: string;
}

export const NameAvatar: React.FC<NameAvatarProps> = ({
  name,
  photoUrl,
  sx,
  ...rest
}) => {
  if (photoUrl) {
    return (
      <Avatar
        src={photoUrl}
        sx={{ width: 32, height: 32, fontSize: '0.85rem', ...sx as any }}
        {...rest}
      />
    );
  }

  const bgcolor = stringToColor(name);
  const initials = getInitials(name);

  return (
    <Avatar
      sx={{
        width: 32,
        height: 32,
        fontSize: '0.85rem',
        bgcolor,
        color: '#fff',
        ...sx as any,
      }}
      {...rest}
    >
      {initials}
    </Avatar>
  );
};

export default NameAvatar;
