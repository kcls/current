import { authApi } from './auth';
import { getApiBaseUrl } from '../utils/api-config';
import { ensureTokenFresh } from '../utils/token-refresh';

/**
 * Signed odo-asset retrieval URLs.
 *
 * `<img>`/`<video>` elements can't send an Authorization header, so file
 * URLs carry their own short-lived credential: odo-asset's `files/sign`
 * returns a URL with an HMAC over the path and an expiry. This keeps the
 * session JWT out of URLs, and a URL stays valid after the access token
 * rotates (which matters for video, where every seek is a new request).
 *
 * Paths requested in the same tick are signed in one batch, and results
 * are cached until shortly before they expire. Components read through
 * `useFileUrl()`; this module has no React dependency.
 */

export interface SignedUrlResult {
  path: string;
  /** Absolute path (no origin), as odo-asset returns it. */
  url: string;
  expires_at: string;
}

export type SignFn = (paths: string[]) => Promise<SignedUrlResult[]>;

type Entry =
  | { kind: 'signed'; url: string; expiresAt: number; refreshAt: number }
  | { kind: 'failed'; retryAt: number };

/** odo-asset's per-request cap. */
const MAX_BATCH = 200;
/** Re-sign this long before expiry (or at half-life, if sooner). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Back-off before retrying a path that failed to sign. */
const FAILURE_RETRY_MS = 60 * 1000;
/**
 * Never re-sign a path more often than this. Expiry is judged by the
 * client clock against a server timestamp, so without a floor a client
 * running fast would see every fresh URL as expired and re-sign in a loop.
 */
const MIN_RESIGN_MS = 30 * 1000;

/**
 * Pre-`current/` asset paths that may still be stored on old rows. Envoy
 * rewrites these on retrieval (odo: k8s/infrastructure/envoy/
 * asset-migration-routes.yaml), but a signature covers the path odo-asset
 * actually serves, so sign the rewritten form.
 */
const LEGACY_PREFIXES: [string, string][] = [
  ['incident-tracker/photos/', 'current/photos/'],
  ['incident-tracker/videos/', 'current/videos/'],
  ['incident-tracker/documents/', 'current/documents/'],
  ['patrons/photos/', 'current/patron/photos/'],
];

export function canonicalAssetPath(path: string): string {
  const trimmed = path.replace(/^\/+/, '');
  for (const [legacy, current] of LEGACY_PREFIXES) {
    if (trimmed.startsWith(legacy)) return current + trimmed.slice(legacy.length);
  }
  return trimmed;
}

export class SignedUrlStore {
  private entries = new Map<string, Entry>();
  private queued = new Set<string>();
  private inFlight = new Set<string>();
  private listeners = new Set<() => void>();
  private flushScheduled = false;
  private version = 0;

  constructor(
    private sign: SignFn,
    private origin: () => string,
    private now: () => number = Date.now,
  ) {}

  /**
   * The signed URL for `path`, or undefined while it is being signed (or
   * if signing failed). Requests signing as a side effect; subscribers are
   * notified when the result lands.
   */
  lookup(path: string): string | undefined {
    const key = canonicalAssetPath(path);
    if (!key) return undefined;
    const entry = this.entries.get(key);
    const now = this.now();

    if (entry?.kind === 'signed' && now < entry.expiresAt) {
      if (now >= entry.refreshAt) this.enqueue(key);
      return entry.url;
    }
    if (entry?.kind === 'failed' && now < entry.retryAt) return undefined;

    this.enqueue(key);
    return undefined;
  }

  /**
   * Sign `path` now, bypassing the cache — for a media element whose URL
   * stopped working mid-playback.
   */
  async refresh(path: string): Promise<string | undefined> {
    const key = canonicalAssetPath(path);
    if (!key) return undefined;
    this.entries.delete(key);
    await this.signBatch([key]);
    const entry = this.entries.get(key);
    return entry?.kind === 'signed' ? entry.url : undefined;
  }

  /** Drop everything, e.g. on logout: URLs are bound to the signing user. */
  clear(): void {
    this.entries.clear();
    this.queued.clear();
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever any entry does; a useSyncExternalStore snapshot. */
  getVersion = (): number => this.version;

  private enqueue(key: string): void {
    if (this.inFlight.has(key) || this.queued.has(key)) return;
    this.queued.add(key);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // Deferred so that every lookup made during one render pass (a list of
    // thumbnails, say) lands in the same batch, and so that lookup() never
    // triggers a store update synchronously during render.
    queueMicrotask(() => {
      this.flushScheduled = false;
      const keys = [...this.queued];
      this.queued.clear();
      for (let i = 0; i < keys.length; i += MAX_BATCH) {
        void this.signBatch(keys.slice(i, i + MAX_BATCH));
      }
    });
  }

  private async signBatch(keys: string[]): Promise<void> {
    keys.forEach(k => this.inFlight.add(k));
    try {
      const results = await this.sign(keys);
      const now = this.now();
      const floor = now + MIN_RESIGN_MS;
      for (const r of results) {
        const expiresAt = Date.parse(r.expires_at);
        const margin = Math.min(REFRESH_MARGIN_MS, (expiresAt - now) / 2);
        this.entries.set(r.path, {
          kind: 'signed',
          url: this.origin() + r.url,
          expiresAt: Math.max(expiresAt, floor),
          refreshAt: Math.max(expiresAt - margin, floor),
        });
      }
      for (const k of keys) {
        if (!this.entries.has(k)) {
          this.entries.set(k, { kind: 'failed', retryAt: now + FAILURE_RETRY_MS });
        }
      }
    } catch (err) {
      if (keys.length > 1) {
        // A single path the user may not read fails the whole batch; sign
        // individually so one bad path doesn't blank every image.
        keys.forEach(k => this.inFlight.delete(k));
        await Promise.all(keys.map(k => this.signBatch([k])));
        return;
      }
      const key = keys[0]!;
      console.warn(`Failed to sign file URL for ${key}:`, err);
      const now = this.now();
      const existing = this.entries.get(key);
      if (existing?.kind === 'signed' && now < existing.expiresAt) {
        // A background refresh failed but the current URL still works.
        existing.refreshAt = now + FAILURE_RETRY_MS;
      } else {
        this.entries.set(key, { kind: 'failed', retryAt: now + FAILURE_RETRY_MS });
      }
    } finally {
      keys.forEach(k => this.inFlight.delete(k));
    }
    this.notify();
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach(l => l());
  }
}

async function signWithOdoAsset(paths: string[]): Promise<SignedUrlResult[]> {
  await ensureTokenFresh();
  const token = authApi.getAuthToken();
  if (!token) throw new Error('No authentication token found');

  const response = await fetch(`${getApiBaseUrl()}/api/v1/odo/asset/files/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ paths }),
  });
  if (response.status === 401) {
    authApi.sessionExpired$.next();
  }
  if (!response.ok) {
    throw new Error(`files/sign failed with status ${response.status}`);
  }
  const data = (await response.json()) as { urls: SignedUrlResult[] };
  return data.urls;
}

export const signedUrls = new SignedUrlStore(signWithOdoAsset, getApiBaseUrl);

authApi.userLoggedOut$.subscribe(() => signedUrls.clear());
