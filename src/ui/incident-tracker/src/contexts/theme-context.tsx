import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useUserPreferences, type ThemeMode } from './user-preferences-context';

type ActiveMode = 'light' | 'dark';

const PRIMARY_COLOR = '#1976d2';
const FONT_SIZE: 'small' | 'medium' | 'large' = 'medium';
const DENSITY: 'compact' | 'comfortable' | 'spacious' = 'comfortable';

interface ThemeContextValue {
  mode: ThemeMode;
  activeMode: ActiveMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  highContrast: boolean;
  setHighContrast: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Get design tokens for light/dark theme
export const getDesignTokens = (
  mode: ActiveMode,
  highContrast: boolean,
  primaryColor: string,
  fontSize: 'small' | 'medium' | 'large',
  density: 'compact' | 'comfortable' | 'spacious'
) => {
  return {
    palette: {
      mode,
      ...(mode === 'light'
        ? {
            primary: {
              main: primaryColor,
            },
            secondary: {
              main: '#dc004e',
            },
            background: {
              default: '#fafafa',
              paper: '#ffffff',
            },
            text: {
              primary: highContrast ? '#000000' : 'rgba(0, 0, 0, 0.87)',
              secondary: highContrast ? '#000000' : 'rgba(0, 0, 0, 0.6)',
              disabled: highContrast ? '#616161' : 'rgba(0, 0, 0, 0.38)',
            },
            ...(highContrast && {
              background: {
                default: '#ffffff',
                paper: '#ffffff',
              },
              divider: '#000000',
              action: {
                hover: 'rgba(0, 0, 0, 0.15)',
                selected: 'rgba(0, 0, 0, 0.20)',
              },
            }),
          }
        : {
            primary: {
              main: primaryColor,
            },
            secondary: {
              main: '#f48fb1',
            },
            background: {
              default: '#121212',
              paper: '#1e1e1e',
            },
            text: {
              primary: highContrast ? '#ffffff' : 'rgba(255, 255, 255, 0.87)',
              secondary: highContrast ? '#ffffff' : 'rgba(255, 255, 255, 0.6)',
              disabled: highContrast ? '#9e9e9e' : 'rgba(255, 255, 255, 0.38)',
            },
            ...(highContrast && {
              background: {
                default: '#000000',
                paper: '#000000',
              },
              divider: '#ffffff',
              action: {
                hover: 'rgba(255, 255, 255, 0.20)',
                selected: 'rgba(255, 255, 255, 0.25)',
              },
            }),
          }),
      divider: highContrast
        ? mode === 'light'
          ? '#000000'
          : '#ffffff'
        : mode === 'light'
        ? 'rgba(0, 0, 0, 0.12)'
        : 'rgba(255, 255, 255, 0.12)',
    },
    typography: {
      fontSize: fontSize === 'small' ? 12 : fontSize === 'large' ? 16 : 14,
      htmlFontSize: fontSize === 'small' ? 14 : fontSize === 'large' ? 18 : 16,
      h1: {
        fontSize: fontSize === 'small' ? '2rem' : fontSize === 'large' ? '2.5rem' : '2.125rem',
        fontWeight: mode === 'light' ? 400 : 300,
      },
      h2: {
        fontSize: fontSize === 'small' ? '1.5rem' : fontSize === 'large' ? '2rem' : '1.75rem',
        fontWeight: mode === 'light' ? 400 : 300,
      },
      h3: {
        fontSize: fontSize === 'small' ? '1.3rem' : fontSize === 'large' ? '1.75rem' : '1.5rem',
        fontWeight: mode === 'light' ? 400 : 300,
      },
      h4: {
        fontSize: fontSize === 'small' ? '1.125rem' : fontSize === 'large' ? '1.5rem' : '1.25rem',
        fontWeight: mode === 'light' ? 400 : 300,
      },
      h5: {
        fontSize: fontSize === 'small' ? '1rem' : fontSize === 'large' ? '1.25rem' : '1.125rem',
      },
      h6: {
        fontSize: fontSize === 'small' ? '0.875rem' : fontSize === 'large' ? '1.125rem' : '1rem',
      },
      body1: {
        fontSize: fontSize === 'small' ? '0.875rem' : fontSize === 'large' ? '1.125rem' : '1rem',
      },
      body2: {
        fontSize: fontSize === 'small' ? '0.75rem' : fontSize === 'large' ? '1rem' : '0.875rem',
      },
      button: {
        fontSize: fontSize === 'small' ? '0.75rem' : fontSize === 'large' ? '1rem' : '0.875rem',
        textTransform: 'none' as const,
      },
      caption: {
        fontSize: fontSize === 'small' ? '0.625rem' : fontSize === 'large' ? '0.875rem' : '0.75rem',
      },
      overline: {
        fontSize: fontSize === 'small' ? '0.625rem' : fontSize === 'large' ? '0.875rem' : '0.75rem',
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarColor: mode === 'light' ? '#959595 #f1f1f1' : '#6b6b6b #2b2b2b',
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
              backgroundColor: mode === 'light' ? '#f1f1f1' : '#2b2b2b',
              width: 12,
            },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
              borderRadius: 8,
              backgroundColor: mode === 'light' ? '#959595' : '#6b6b6b',
              minHeight: 24,
              border: mode === 'light' ? '3px solid #f1f1f1' : '3px solid #2b2b2b',
            },
            '&::-webkit-scrollbar-thumb:hover, & *::-webkit-scrollbar-thumb:hover': {
              backgroundColor: mode === 'light' ? '#555' : '#959595',
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiButton: {
        defaultProps: {
          size: (density === 'compact' ? 'small' : density === 'spacious' ? 'large' : 'medium') as 'small' | 'medium' | 'large',
        },
        styleOverrides: {
          root: {
            textTransform: 'none' as const,
            padding:
              density === 'compact'
                ? '4px 8px'
                : density === 'spacious'
                ? '8px 16px'
                : '6px 16px',
            ...(highContrast && {
              borderWidth: 2,
              '&:hover': {
                borderWidth: 2,
              },
              '&.MuiButton-outlined': {
                borderWidth: 2,
                '&:hover': {
                  borderWidth: 2,
                },
              },
            }),
          },
        },
      },
      MuiFormControl: {
        defaultProps: {
          size: (density === 'compact' ? 'small' : 'medium') as 'small' | 'medium',
          margin: (density === 'compact' ? 'dense' : density === 'spacious' ? 'normal' : 'dense') as 'none' | 'dense' | 'normal',
        },
      },
      MuiTextField: {
        defaultProps: {
          size: (density === 'compact' ? 'small' : 'medium') as 'small' | 'medium',
          margin: (density === 'compact' ? 'dense' : density === 'spacious' ? 'normal' : 'dense') as 'none' | 'dense' | 'normal',
        },
      },
      MuiList: {
        styleOverrides: {
          root: {
            padding: density === 'compact' ? 0 : density === 'spacious' ? '8px 0' : '4px 0',
          },
        },
      },
      MuiListItem: {
        styleOverrides: {
          root: {
            paddingTop: density === 'compact' ? 4 : density === 'spacious' ? 12 : 8,
            paddingBottom: density === 'compact' ? 4 : density === 'spacious' ? 12 : 8,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            padding: density === 'compact' ? 8 : density === 'spacious' ? 24 : 16,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderColor: highContrast
              ? mode === 'dark'
                ? '#ffffff'
                : '#000000'
              : mode === 'dark'
              ? 'rgba(255, 255, 255, 0.23)'
              : undefined,
            ...(highContrast && {
              borderWidth: 2,
              '&.MuiChip-outlined': {
                borderWidth: 2,
              },
            }),
          },
        },
      },
    },
  };
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    appearance,
    setMode: setModePreference,
    setHighContrast: setHighContrastPreference,
  } = useUserPreferences();

  const { mode, highContrast } = appearance;

  const [activeMode, setActiveMode] = useState<ActiveMode>('light');

  // Detect system preference
  useEffect(() => {
    if (mode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      setActiveMode(mediaQuery.matches ? 'dark' : 'light');

      const handler = (e: MediaQueryListEvent) => {
        setActiveMode(e.matches ? 'dark' : 'light');
      };

      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      setActiveMode(mode as ActiveMode);
    }
  }, [mode]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeMode);
    document.documentElement.style.colorScheme = activeMode;
  }, [activeMode]);

  const toggleMode = useCallback(() => {
    const newMode: ThemeMode = activeMode === 'dark' ? 'light' : 'dark';
    setModePreference(newMode);
  }, [activeMode, setModePreference]);

  const theme = useMemo(
    () => createTheme(getDesignTokens(activeMode, highContrast, PRIMARY_COLOR, FONT_SIZE, DENSITY)),
    [activeMode, highContrast]
  );

  const contextValue = useMemo(
    () => ({
      mode,
      activeMode,
      setMode: setModePreference,
      toggleMode,
      highContrast,
      setHighContrast: setHighContrastPreference,
    }),
    [
      mode,
      activeMode,
      setModePreference,
      toggleMode,
      highContrast,
      setHighContrastPreference,
    ]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};
