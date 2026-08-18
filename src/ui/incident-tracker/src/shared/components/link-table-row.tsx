/**
 * Makes table rows behave as real links (right-click, cmd-click, etc.)
 *
 * Use LinkTableRow instead of TableRow, LinkTableCell instead of TableCell
 * For cells that shouldn't be links (checkbox, action buttons), use plain TableCell
 */
import React, { createContext, useContext, useRef } from 'react';
import { TableRow, TableCell, type TableRowProps, type TableCellProps } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { styled } from '@mui/material/styles';

const RowLinkContext = createContext<{
  to: string;
  isFirstCell: React.RefObject<boolean>;
} | null>(null);

interface LinkTableRowProps extends TableRowProps {
  to: string;
}

export const LinkTableRow = React.forwardRef<HTMLTableRowElement, LinkTableRowProps>(
  ({ to, children, ...props }, ref) => {
    const isFirstCell = useRef(true);
    // Reset on each render
    isFirstCell.current = true;

    return (
      <RowLinkContext.Provider value={{ to, isFirstCell }}>
        <StyledRow ref={ref} {...props}>
          {children}
        </StyledRow>
      </RowLinkContext.Provider>
    );
  }
);

LinkTableRow.displayName = 'LinkTableRow';

const StyledRow = styled(TableRow)({
  cursor: 'pointer',
});

const VERTICAL_STRETCH = 9999;

const CellLink = styled(RouterLink)({
  display: 'block',
  color: 'inherit',
  textDecoration: 'none',
  // Horizontal: cancel td padding (16px) and re-apply on the <a>
  marginLeft: -16,
  marginRight: -16,
  paddingLeft: 16,
  paddingRight: 16,
  // Vertical: stretch to fill cell height regardless of content
  marginTop: -VERTICAL_STRETCH,
  marginBottom: -VERTICAL_STRETCH,
  paddingTop: VERTICAL_STRETCH,
  paddingBottom: VERTICAL_STRETCH,
});

export const LinkTableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ children, sx, ...props }, ref) => {
    const ctx = useContext(RowLinkContext);

    if (!ctx) {
      return <TableCell ref={ref} sx={sx} {...props}>{children}</TableCell>;
    }

    const isFirst = ctx.isFirstCell.current;
    if (isFirst) {
      ctx.isFirstCell.current = false;
    }

    return (
      <TableCell
        ref={ref}
        sx={{ overflow: 'hidden', ...(sx as any) }}
        {...props}
      >
        <CellLink
          to={ctx.to}
          tabIndex={isFirst ? 0 : -1}
          aria-hidden={!isFirst || undefined}
        >
          {children}
        </CellLink>
      </TableCell>
    );
  }
);

LinkTableCell.displayName = 'LinkTableCell';
