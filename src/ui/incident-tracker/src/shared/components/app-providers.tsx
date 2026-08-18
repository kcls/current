import { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '../../contexts/theme-context';
import { ToastProvider } from '../../contexts/toast-context';
import { NotificationProvider } from '../../contexts/notification-context';
import { UserPreferencesProvider } from '../../contexts/user-preferences-context';
import { LocationProvider } from '../../contexts/location-context';
import { AuthProvider } from '../../contexts/auth-context';
import { IncidentsProvider } from '../../contexts/incidents-context';
import { TemplatesProvider } from '../../contexts/templates-context';
import { APP_BASENAME } from '../../constants';

interface AppProvidersProps {
  children: ReactNode;
}

// Compose multiple providers in the correct order (outermost to innermost)
const AppProviders = ({ children }: AppProvidersProps) => {
  const providers = [
    AuthProvider,
    LocationProvider,
    UserPreferencesProvider,
    ThemeProvider,
    ToastProvider,
    NotificationProvider,
    IncidentsProvider,
    TemplatesProvider,
  ];

  const wrapped = providers.reduceRight(
    (acc, Provider) => <Provider>{acc}</Provider>,
    <BrowserRouter basename={APP_BASENAME}>{children}</BrowserRouter>
  );

  return wrapped;
};

export default AppProviders;
