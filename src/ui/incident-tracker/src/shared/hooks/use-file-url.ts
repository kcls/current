import { useCallback, useSyncExternalStore } from 'react';
import { signedUrls } from '@core/api/signed-urls';

/**
 * Returns a resolver from an odo-asset relative path to a signed retrieval
 * URL. The resolver returns undefined until the URL has been signed; the
 * component re-renders when it arrives. Safe to call inside `.map()`.
 */
export function useFileUrl(): (path: string | null | undefined) => string | undefined {
  // The version snapshot is what re-renders the caller when any URL lands
  // or refreshes; the resolver identity changes with it so memoized
  // children see the update too.
  const version = useSyncExternalStore(signedUrls.subscribe, signedUrls.getVersion);
  return useCallback(
    (path: string | null | undefined) => (path ? signedUrls.lookup(path) : undefined),
    [version],
  );
}
