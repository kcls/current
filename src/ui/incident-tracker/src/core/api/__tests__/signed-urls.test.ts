import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignedUrlStore, canonicalAssetPath, type SignedUrlResult } from '../signed-urls';

const HOUR = 60 * 60 * 1000;
const ORIGIN = 'https://api.example.org';

/** Let queued microtasks and the sign promise chain settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('canonicalAssetPath', () => {
  it('maps legacy prefixes to current/', () => {
    expect(canonicalAssetPath('incident-tracker/photos/a.jpg')).toBe('current/photos/a.jpg');
    expect(canonicalAssetPath('incident-tracker/videos/a.mp4')).toBe('current/videos/a.mp4');
    expect(canonicalAssetPath('incident-tracker/documents/a.pdf')).toBe('current/documents/a.pdf');
    expect(canonicalAssetPath('patrons/photos/a.jpg')).toBe('current/patron/photos/a.jpg');
  });

  it('leaves current paths alone and strips a leading slash', () => {
    expect(canonicalAssetPath('current/photos/a.jpg')).toBe('current/photos/a.jpg');
    expect(canonicalAssetPath('/current/photos/a.jpg')).toBe('current/photos/a.jpg');
    // Prefix match is on whole segments.
    expect(canonicalAssetPath('patrons/photosx/a.jpg')).toBe('patrons/photosx/a.jpg');
  });
});

describe('SignedUrlStore', () => {
  let now: number;
  let expiresIn: number;
  let deny: Set<string>;
  let omit: Set<string>;
  let sign: ReturnType<typeof vi.fn<(paths: string[]) => Promise<SignedUrlResult[]>>>;
  let store: SignedUrlStore;

  beforeEach(() => {
    now = Date.parse('2026-10-21T12:00:00Z');
    expiresIn = HOUR;
    deny = new Set();
    omit = new Set();
    sign = vi.fn(async (paths: string[]) => {
      if (paths.some(p => deny.has(p))) throw new Error('403');
      return paths
        .filter(p => !omit.has(p))
        .map(p => ({
          path: p,
          url: `/api/v1/odo/asset/files/${p}?sig=${now}`,
          expires_at: new Date(now + expiresIn).toISOString(),
        }));
    });
    store = new SignedUrlStore(sign, () => ORIGIN, () => now);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('batches lookups from one tick into a single sign call', async () => {
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.lookup('current/photos/a.jpg')).toBeUndefined();
    expect(store.lookup('current/photos/b.jpg')).toBeUndefined();
    expect(store.lookup('current/photos/a.jpg')).toBeUndefined();
    await settle();

    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith(['current/photos/a.jpg', 'current/photos/b.jpg']);
    expect(listener).toHaveBeenCalled();
    expect(store.lookup('current/photos/a.jpg')).toBe(
      `${ORIGIN}/api/v1/odo/asset/files/current/photos/a.jpg?sig=${now}`,
    );
  });

  it('serves from cache until the refresh margin', async () => {
    store.lookup('p/a.jpg');
    await settle();
    const first = store.lookup('p/a.jpg');

    now += 50 * 60 * 1000; // 10 minutes left: still before the 5-minute margin
    expect(store.lookup('p/a.jpg')).toBe(first);
    await settle();
    expect(sign).toHaveBeenCalledTimes(1);

    now += 6 * 60 * 1000; // inside the margin: keep serving, re-sign in background
    expect(store.lookup('p/a.jpg')).toBe(first);
    await settle();
    expect(sign).toHaveBeenCalledTimes(2);
    expect(store.lookup('p/a.jpg')).not.toBe(first);
  });

  it('stops serving an expired URL', async () => {
    store.lookup('p/a.jpg');
    await settle();
    now += HOUR;
    expect(store.lookup('p/a.jpg')).toBeUndefined();
  });

  it('isolates a path the user may not read', async () => {
    deny.add('p/secret.jpg');
    store.lookup('p/a.jpg');
    store.lookup('p/secret.jpg');
    store.lookup('p/b.jpg');
    await settle();

    expect(store.lookup('p/a.jpg')).toBeDefined();
    expect(store.lookup('p/b.jpg')).toBeDefined();
    expect(store.lookup('p/secret.jpg')).toBeUndefined();

    // Not retried until the back-off passes.
    const calls = sign.mock.calls.length;
    store.lookup('p/secret.jpg');
    await settle();
    expect(sign.mock.calls.length).toBe(calls);

    now += 61 * 1000;
    store.lookup('p/secret.jpg');
    await settle();
    expect(sign.mock.calls.length).toBe(calls + 1);
  });

  it('keeps a still-valid URL when a background refresh fails', async () => {
    store.lookup('p/a.jpg');
    await settle();
    const url = store.lookup('p/a.jpg');

    now += 56 * 60 * 1000;
    deny.add('p/a.jpg');
    store.lookup('p/a.jpg');
    await settle();
    expect(store.lookup('p/a.jpg')).toBe(url);
  });

  it('does not re-request a path the server left out of its response', async () => {
    omit.add('p/a.jpg');
    store.lookup('p/a.jpg');
    await settle();
    store.lookup('p/a.jpg');
    await settle();
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('does not loop when the client clock runs ahead of the server', async () => {
    expiresIn = -5 * 60 * 1000; // already "expired" by the client clock
    store.lookup('p/a.jpg');
    await settle();

    expect(store.lookup('p/a.jpg')).toBeDefined();
    await settle();
    expect(store.lookup('p/a.jpg')).toBeDefined();
    await settle();
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('maps legacy paths before signing', async () => {
    store.lookup('patrons/photos/a.jpg');
    await settle();
    expect(sign).toHaveBeenCalledWith(['current/patron/photos/a.jpg']);
    expect(store.lookup('patrons/photos/a.jpg')).toContain('current/patron/photos/a.jpg');
  });

  it('refresh() re-signs regardless of the cache', async () => {
    store.lookup('p/a.jpg');
    await settle();
    now += 1000;
    const url = await store.refresh('p/a.jpg');
    expect(sign).toHaveBeenCalledTimes(2);
    expect(url).toBe(`${ORIGIN}/api/v1/odo/asset/files/p/a.jpg?sig=${now}`);
  });

  it('clear() drops cached URLs', async () => {
    store.lookup('p/a.jpg');
    await settle();
    store.clear();
    expect(store.lookup('p/a.jpg')).toBeUndefined();
  });
});
