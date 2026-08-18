import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { Snackbar, Alert, AlertColor, Slide } from '@mui/material';

interface Toast {
  id: number;
  message: string;
  severity: AlertColor;
}

interface ToastContextType {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

interface ToastProviderProps {
  children: ReactNode;
  autoHideDuration?: number;
}

let toastId = 0;

export const ToastProvider: React.FC<ToastProviderProps> = ({
  children,
  autoHideDuration = 5000,
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, severity: AlertColor) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, severity }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showSuccess = useCallback(
    (message: string) => addToast(message, 'success'),
    [addToast]
  );

  const showError = useCallback(
    (message: string) => addToast(message, 'error'),
    [addToast]
  );

  const value: ToastContextType = {
    showSuccess,
    showError,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.map((toast, index) => (
        <Snackbar
          key={toast.id}
          open
          autoHideDuration={autoHideDuration}
          onClose={(_event, reason) => {
            if (reason === 'clickaway') return;
            removeToast(toast.id);
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          slots={{ transition: Slide }}
          slotProps={{ transition: { direction: 'up' } as never }}
          sx={{ bottom: { xs: 16 + index * 60, sm: 24 + index * 60 } }}
        >
          <Alert
            onClose={() => removeToast(toast.id)}
            severity={toast.severity}
            variant="filled"
            sx={{ width: '100%' }}
          >
            {toast.message}
          </Alert>
        </Snackbar>
      ))}
    </ToastContext.Provider>
  );
};

export default ToastContext;
