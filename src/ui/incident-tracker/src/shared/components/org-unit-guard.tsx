import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authApi } from '@core';
import { ROUTES } from '../../constants';

const OrgUnitGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [hasOrgUnit, setHasOrgUnit] = useState<boolean | null>(null);

  useEffect(() => {
    const checkOrgUnit = () => {
      const sessionData = authApi.getSessionData();
      const orgUnit = sessionData?.org_unit;
      setHasOrgUnit(!!orgUnit);
    };

    checkOrgUnit();
  }, []);

  if (hasOrgUnit === null) {
    return <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh'
    }}>
      Loading...
    </div>;
  }

  if (!hasOrgUnit) {
    return <Navigate to={ROUTES.SELECT_LOCATION} state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default OrgUnitGuard;
