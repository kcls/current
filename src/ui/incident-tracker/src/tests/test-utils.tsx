import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { AuthProvider } from '../contexts/auth-context';
import { LocationProvider } from '../contexts/location-context';
import { IncidentsProvider } from '../contexts/incidents-context';
import { TemplatesProvider } from '../contexts/templates-context';

interface ExtendedRenderOptions extends Omit<RenderOptions, 'queries'> {
  initialRoute?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    initialRoute = '/',
    ...renderOptions
  }: ExtendedRenderOptions = {}
) {
  const theme = createTheme();

  window.history.pushState({}, 'Test page', initialRoute);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider>
        <LocationProvider>
          <ThemeProvider theme={theme}>
            <BrowserRouter>
              <IncidentsProvider>
                <TemplatesProvider>
                  {children}
                </TemplatesProvider>
              </IncidentsProvider>
            </BrowserRouter>
          </ThemeProvider>
        </LocationProvider>
      </AuthProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

// Re-export everything from Testing Library
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
