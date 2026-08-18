import { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Paper, Collapse } from '@mui/material';
import { ErrorOutline, ExpandMore, Refresh } from '@mui/icons-material';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
      showDetails: false,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
    this.props.onReset?.();
  };

  toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }

      return (
        <Paper sx={{ p: 6, textAlign: 'center', maxWidth: 500, mx: 'auto', mt: 4 }}>
          <ErrorOutline sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Something went wrong
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            An unexpected error occurred. Please try refreshing the page.
          </Typography>
          <Button
            variant="contained"
            startIcon={<Refresh />}
            onClick={() => window.location.reload()}
          >
            Refresh Page
          </Button>

          {import.meta.env.DEV && this.state.error && (
            <>
              <Box sx={{ mt: 3 }}>
                <Button
                  size="small"
                  color="inherit"
                  onClick={this.toggleDetails}
                  endIcon={
                    <ExpandMore
                      sx={{
                        transform: this.state.showDetails ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s',
                      }}
                    />
                  }
                >
                  Details
                </Button>
              </Box>
              <Collapse in={this.state.showDetails}>
                <Box
                  sx={{
                    mt: 2,
                    p: 2,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    textAlign: 'left',
                  }}
                >
                  <Typography variant="body2" fontFamily="monospace" sx={{ mb: 1 }}>
                    {this.state.error?.message}
                  </Typography>
                  {this.state.error?.stack && (
                    <Box
                      component="pre"
                      sx={{
                        fontSize: '0.7rem',
                        overflow: 'auto',
                        maxHeight: 150,
                        m: 0,
                        color: 'text.secondary',
                      }}
                    >
                      {this.state.error.stack}
                    </Box>
                  )}
                </Box>
              </Collapse>
            </>
          )}
        </Paper>
      );
    }

    return this.props.children;
  }
}

// Page-level error boundary with full-screen error display
export class PageErrorBoundary extends ErrorBoundary {
  render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            bgcolor: 'background.default',
          }}
        >
          {super.render()}
        </Box>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;