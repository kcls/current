import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Breadcrumbs as MuiBreadcrumbs, Link, Typography } from '@mui/material';
import { NavigateNext as NavigateNextIcon } from '@mui/icons-material';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Remove default margin bottom. Useful when placing breadcrumbs in a flex container. */
  noMargin?: boolean;
}

/**
 * A simple breadcrumb navigation component.
 *
 * Usage:
 * ```tsx
 * <Breadcrumbs items={[
 *   { label: 'Incidents', href: '/incidents' },
 *   { label: 'Incident #123' }
 * ]} />
 * ```
 */
export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, noMargin }) => {
  return (
    <MuiBreadcrumbs
      separator={<NavigateNextIcon sx={{ fontSize: '1rem' }} />}
      sx={{
        ...(noMargin ? {} : { mb: 3 }),
        height: '40px',
        '& .MuiBreadcrumbs-ol': {
          flexWrap: 'nowrap',
          height: '40px',
          alignItems: 'center',
        },
      }}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        if (isLast || !item.href) {
          return (
            <Typography
              key={index}
              component="span"
              color="text.primary"
              variant="body2"
            >
              {item.label}
            </Typography>
          );
        }

        return (
          <Link
            key={index}
            component={RouterLink}
            to={item.href}
            underline="hover"
            color="primary"
            variant="body2"
          >
            {item.label}
          </Link>
        );
      })}
    </MuiBreadcrumbs>
  );
};

export default Breadcrumbs;
