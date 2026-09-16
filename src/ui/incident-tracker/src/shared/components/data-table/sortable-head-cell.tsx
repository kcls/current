import React from 'react';
import { TableCell, TableSortLabel } from '@mui/material';
import type { TableCellProps } from '@mui/material';
import { UnfoldMore as UnfoldMoreIcon } from '@mui/icons-material';
import type { SortState } from '../../hooks/use-sort-state';

interface Props {
  label: React.ReactNode;
  align?: TableCellProps['align'];
  minWidth?: string | number;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
}

export const SortableHeadCell: React.FC<Props> = ({
  label,
  align,
  minWidth,
  sortKey,
  sort,
  onSort,
}) => {
  const isActive = sort.key === sortKey;

  return (
    <TableCell
      align={align}
      sortDirection={isActive ? sort.dir : false}
      sx={{ minWidth }}
    >
      <TableSortLabel
        active={isActive}
        direction={isActive ? sort.dir : 'asc'}
        IconComponent={isActive ? undefined : UnfoldMoreIcon}
        onClick={() => onSort(sortKey)}
        sx={{
          flexDirection: 'row',
          '& .MuiTableSortLabel-icon': { opacity: isActive ? 1 : 0.5 },
        }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );
};

export default SortableHeadCell;
