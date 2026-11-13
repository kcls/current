import React, { useEffect, useRef, useState } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';
import { signedUrls } from '@core/api/signed-urls';
import { useFileUrl } from '../hooks/use-file-url';

/** Don't re-sign after errors more often than this (e.g. a missing file). */
const RECOVERY_INTERVAL_MS = 30 * 1000;

type SignedVideoProps = Omit<
  React.VideoHTMLAttributes<HTMLVideoElement>,
  'src' | 'onError' | 'onLoadedMetadata'
> & {
  /** odo-asset relative path. */
  path: string;
  sx?: SxProps<Theme>;
};

/**
 * A `<video>` backed by a signed odo-asset URL.
 *
 * Unlike an image, a video keeps fetching ranges for as long as it plays,
 * so its URL must not change underneath it: the src is pinned when first
 * signed, and a background refresh of the cached URL does not touch it.
 * If the URL stops working (it expired during a long session), the video
 * re-signs and resumes where it was.
 */
export const SignedVideo: React.FC<SignedVideoProps> = ({ path, sx, children, ...rest }) => {
  const fileUrl = useFileUrl();
  const resolved = fileUrl(path);
  const [pinned, setPinned] = useState<{ path: string; url: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRecovery = useRef(0);
  const resumeAt = useRef<{ time: number; play: boolean } | null>(null);

  useEffect(() => {
    if (resolved && pinned?.path !== path) setPinned({ path, url: resolved });
  }, [path, resolved, pinned]);

  const src = pinned?.path === path ? pinned.url : undefined;

  const handleError = async () => {
    const video = videoRef.current;
    if (!video || !src || Date.now() - lastRecovery.current < RECOVERY_INTERVAL_MS) return;
    lastRecovery.current = Date.now();
    resumeAt.current = { time: video.currentTime, play: !video.paused };

    const url = await signedUrls.refresh(path);
    if (!url) return;
    if (url === src) {
      video.load();
    } else {
      setPinned({ path, url });
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    const resume = resumeAt.current;
    if (!video || !resume) return;
    resumeAt.current = null;
    video.currentTime = resume.time;
    if (resume.play) video.play().catch(() => { /* autoplay may be blocked */ });
  };

  return (
    <Box
      component="video"
      ref={videoRef}
      src={src}
      onError={handleError}
      onLoadedMetadata={handleLoadedMetadata}
      sx={sx}
      {...rest}
    >
      {children}
    </Box>
  );
};
