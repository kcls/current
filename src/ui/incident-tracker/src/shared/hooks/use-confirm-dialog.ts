import { useState, useCallback, useRef } from 'react';

export interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
}

const INITIAL: ConfirmDialogState = {
  open: false,
  title: '',
  message: '',
};

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState>(INITIAL);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback(
    (opts: Omit<ConfirmDialogState, 'open'>): Promise<boolean> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setState({ ...opts, open: true });
      });
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    setState(INITIAL);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setState(INITIAL);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return {
    confirm,
    dialogProps: {
      open: state.open,
      title: state.title,
      message: state.message,
      confirmLabel: state.confirmLabel,
      confirmColor: state.confirmColor,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    },
  };
}
