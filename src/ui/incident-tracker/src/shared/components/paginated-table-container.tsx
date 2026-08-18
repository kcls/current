import React from 'react';
import {
  Box,
  TableContainer,
  TablePagination,
  Paper,
} from '@mui/material';

interface PaginatedTableContainerProps {
  count: number;
  page: number;
  rowsPerPage: number;
  onPageChange: (newPage: number) => void;
  onRowsPerPageChange: (newRowsPerPage: number) => void;
  rowsPerPageOptions?: number[];
  minWidth?: number | string;
  noPaper?: boolean;
  children: React.ReactNode;
}

export const PaginatedTableContainer: React.FC<PaginatedTableContainerProps> = ({
  count,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  rowsPerPageOptions = [5, 10, 25, 50],
  minWidth = 700,
  noPaper = false,
  children,
}) => {
  const handlePageChange = (_: unknown, newPage: number) => {
    onPageChange(newPage);
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onRowsPerPageChange(parseInt(event.target.value, 10));
  };

  const content = (
    <>
      <Box sx={{ minWidth }}>
        {children}
      </Box>
      <TablePagination
        rowsPerPageOptions={rowsPerPageOptions}
        component="div"
        count={count}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handlePageChange}
        onRowsPerPageChange={handleRowsPerPageChange}
      />
    </>
  );

  if (noPaper) {
    return (
      <TableContainer sx={{ overflowX: 'auto' }}>
        {content}
      </TableContainer>
    );
  }

  return (
    <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
      {content}
    </TableContainer>
  );
};
