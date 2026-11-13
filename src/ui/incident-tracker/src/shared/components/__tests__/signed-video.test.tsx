import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';

// A real store over a fake signer: each sign call yields a distinct URL so
// tests can tell a pinned src from a refreshed one.
const h = vi.hoisted(() => ({ counter: 0, now: Date.parse('2026-10-21T12:00:00Z') }));

vi.mock('@core/api/signed-urls', async () => {
  const actual = await vi.importActual<typeof import('@core/api/signed-urls')>(
    '@core/api/signed-urls',
  );
  const store = new actual.SignedUrlStore(
    async (paths: string[]) =>
      paths.map(p => ({
        path: p,
        url: `/files/${p}?v=${++h.counter}`,
        expires_at: new Date(h.now + 60 * 60 * 1000).toISOString(),
      })),
    () => '',
    () => h.now,
  );
  return { ...actual, signedUrls: store };
});

import { signedUrls } from '@core/api/signed-urls';
import { SignedVideo } from '../signed-video';

const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

describe('SignedVideo', () => {
  beforeEach(() => {
    signedUrls.clear();
    h.counter = 0;
    h.now = Date.parse('2026-10-21T12:00:00Z');
  });

  it('pins its src across background refreshes of the cached URL', async () => {
    const { container } = render(<SignedVideo path="current/videos/a.mp4" controls />);
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBeNull();

    await settle();
    expect(video.getAttribute('src')).toBe('/files/current/videos/a.mp4?v=1');

    // Another consumer triggers a re-sign inside the refresh margin.
    h.now += 56 * 60 * 1000;
    act(() => { signedUrls.lookup('current/videos/a.mp4'); });
    await settle();
    expect(signedUrls.lookup('current/videos/a.mp4')).toBe('/files/current/videos/a.mp4?v=2');
    expect(video.getAttribute('src')).toBe('/files/current/videos/a.mp4?v=1');
  });

  it('re-signs on error and resumes from the same position', async () => {
    const { container } = render(<SignedVideo path="current/videos/a.mp4" controls />);
    const video = container.querySelector('video')!;
    await settle();

    video.currentTime = 42;
    fireEvent.error(video);
    await settle();
    expect(video.getAttribute('src')).toBe('/files/current/videos/a.mp4?v=2');

    video.currentTime = 0;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(42);

    // A second error straight away does not re-sign again.
    fireEvent.error(video);
    await settle();
    expect(video.getAttribute('src')).toBe('/files/current/videos/a.mp4?v=2');
  });
});
