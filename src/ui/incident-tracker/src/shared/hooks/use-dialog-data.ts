import { useState, useEffect, useCallback } from 'react';

/**
 * Keeps dialog data visible during the MUI close animation.
 *
 * MUI Dialog animates out after `open` becomes false, but the data prop
 * (e.g. the selected incident) is typically set to null at the same time,
 * causing the content to flash-disappear before the fade finishes.
 *
 * This hook snapshots the data when it arrives and only clears it after
 * the exit animation completes via the returned `onExited` callback.
 *
 * Usage:
 *   const { data, open, onExited } = useDialogData(incident);
 *   <Dialog open={open} TransitionProps={{ onExited }}>
 *     {data && <Content data={data} />}
 *   </Dialog>
 */
export function useDialogData<T>(value: T | null) {
  const [snapshot, setSnapshot] = useState<T | null>(null);

  useEffect(() => {
    if (value !== null) {
      setSnapshot(value);
    }
  }, [value]);

  const onExited = useCallback(() => {
    setSnapshot(null);
  }, []);

  return {
    data: value ?? snapshot,
    open: value !== null,
    onExited,
  };
}
