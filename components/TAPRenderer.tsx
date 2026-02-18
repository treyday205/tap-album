
import React, { useEffect, useState, useRef, memo } from 'react';
import { Music2, Instagram, Twitter, Video, Facebook, Play, Pause } from 'lucide-react';
import { Project, Track, EventType } from '../types';
import { StorageService } from '../services/storage';
import { toSafeTrackPlaybackErrorMessage } from '../services/trackAudio';
import TrackRow from './TrackRow';
import GoLiveAlbumHeader from './GoLiveAlbumHeader';
import ResponsiveImage from './ResponsiveImage';

interface TAPRendererProps {
  project: Project;
  tracks: Track[];
  isPreview?: boolean;
  showCover?: boolean;
  showMeta?: boolean;
  showAllTracks?: boolean;
  coverSizes?: string;
  useGoLiveHeader?: boolean;
  resolveAssetUrl?: (value: string) => string;
  resolveTrackAudioUrl?: (
    track: Track,
    options?: { forceRefresh?: boolean; reason?: 'manual' | 'probe' | 'stalled' | 'waiting' | 'error' }
  ) => Promise<string>;
  onPlayerStateChange?: (state: { isPlaying: boolean; currentTrackId: string | null }) => void;
  showInstallButton?: boolean;
  onInstallClick?: () => void;
  suppressBenignPlaybackErrors?: boolean;
}

const formatTime = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

const STALL_RECOVERY_COOLDOWN_MS = 2500;
const STALL_RECOVERY_MAX_ATTEMPTS = 3;

const TAPRenderer: React.FC<TAPRendererProps> = ({
  project,
  tracks,
  isPreview = false,
  showCover = false,
  showMeta = false,
  showAllTracks = false,
  coverSizes,
  useGoLiveHeader = false,
  resolveAssetUrl,
  resolveTrackAudioUrl,
  onPlayerStateChange,
  showInstallButton = false,
  onInstallClick,
  suppressBenignPlaybackErrors = false
}) => {
  const [currentlyPlayingTrackId, setCurrentlyPlayingTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeTrackRef = useRef<Track | null>(null);
  const manualPauseRef = useRef(false);
  const stallRetryTimerRef = useRef<number | null>(null);
  const isRecovering = useRef(false);
  const stallRecoveryAttemptsRef = useRef(0);
  const lastTimeUpdateLogSecondRef = useRef(-1);

  const clearStallRecoveryTimer = () => {
    if (typeof window !== 'undefined' && stallRetryTimerRef.current !== null) {
      window.clearTimeout(stallRetryTimerRef.current);
    }
    stallRetryTimerRef.current = null;
    stallRecoveryAttemptsRef.current = 0;
    isRecovering.current = false;
  };

  const resolveUrl = (value: string) => {
    if (!value) return '';
    return resolveAssetUrl ? resolveAssetUrl(value) : value;
  };

  const getTrackAudioValue = (track: Track) =>
    String(track.audioUrl || track.mp3Url || '').trim();

  const isAudioAssetRef = (value: string) => {
    const trimmed = String(value || '').trim().toLowerCase();
    if (!trimmed.startsWith('asset:')) return false;
    return (
      trimmed.endsWith('.mp3') ||
      trimmed.endsWith('.wav') ||
      trimmed.endsWith('.m4a') ||
      trimmed.endsWith('.aac') ||
      trimmed.endsWith('.ogg') ||
      trimmed.endsWith('.flac')
    );
  };

  const isPlayableAudioUrl = (value: string) => {
    const url = String(value || '').trim();
    const isHttp = url.startsWith('http://') || url.startsWith('https://');
    const isRelative = url.startsWith('/');
    const isBlob = url.startsWith('blob:');
    return url.length > 5 && (
      url.startsWith('data:audio/') ||
      isBlob ||
      url.includes('p.scdn.co') ||
      ((isHttp || isRelative) && !url.includes('open.spotify.com'))
    );
  };

  const normalizeRuntimeAudioUrl = (value: string) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (typeof window === 'undefined') return raw;
    try {
      return new URL(raw, window.location.origin).toString();
    } catch {
      return raw;
    }
  };

  const isBenignSwitchPlaybackError = (value: unknown): boolean => {
    const errorName = String((value as { name?: string } | null)?.name || '').trim().toLowerCase();
    const message = String((value as { message?: string } | null)?.message || value || '')
      .trim()
      .toLowerCase();
    return (
      errorName === 'aborterror' ||
      message.includes('interrupted by a call to pause') ||
      message.includes('the play() request was interrupted') ||
      message.includes('play() request was interrupted')
    );
  };

  const canPlayTrack = (track: Track, resolvedUrl: string) => {
    if (isPlayableAudioUrl(resolvedUrl)) return true;
    if (String(track.audioPath || track.storagePath || '').trim()) return true;
    const raw = getTrackAudioValue(track);
    const normalizedRaw = raw.toLowerCase();
    if (normalizedRaw.startsWith('bank:')) {
      return false;
    }
    if (isAudioAssetRef(raw)) return true;
    return (
      normalizedRaw.includes('.mp3') ||
      normalizedRaw.includes('.wav') ||
      normalizedRaw.includes('.m4a') ||
      normalizedRaw.includes('.aac') ||
      normalizedRaw.includes('.ogg') ||
      normalizedRaw.includes('.flac')
    );
  };

  const logAudioEvent = (
    event: string,
    audio: HTMLAudioElement | null,
    details: Record<string, unknown> = {}
  ) => {
    const currentTrack = activeTrackRef.current;
    console.log('[AUDIO]', {
      event,
      projectId: project.projectId,
      trackId: currentTrack?.trackId || currentlyPlayingTrackId || null,
      title: currentTrack?.title || null,
      paused: audio?.paused ?? null,
      ended: audio?.ended ?? null,
      currentTime: audio ? Number(audio.currentTime || 0) : null,
      duration: audio && Number.isFinite(audio.duration) ? Number(audio.duration) : null,
      readyState: audio?.readyState ?? null,
      networkState: audio?.networkState ?? null,
      errorCode: audio?.error?.code ?? null,
      isRecovering: isRecovering.current,
      recoveryAttempts: stallRecoveryAttemptsRef.current,
      ...details
    });
  };

  const rangeCheckPlayableUrl = async (url: string, track: Track) => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store'
      });
      if (response.body) {
        void response.body.cancel().catch(() => undefined);
      }
      const ok = response.status === 200 || response.status === 206;
      console.log('[AUDIO]', {
        event: 'url-health-check',
        method: 'GET',
        range: 'bytes=0-0',
        projectId: project.projectId,
        trackId: track.trackId,
        status: response.status,
        ok,
        url
      });
      return ok ? null : `Track unavailable (HTTP ${response.status})`;
    } catch (error: any) {
      console.log('[AUDIO]', {
        event: 'url-health-check',
        method: 'GET',
        range: 'bytes=0-0',
        projectId: project.projectId,
        trackId: track.trackId,
        status: 0,
        ok: false,
        url,
        error: String(error?.message || error || 'network error')
      });
      return 'Track unavailable (network)';
    }
  };

  const attemptStallRecovery = async (triggerEvent: 'stalled' | 'waiting' | 'error') => {
    if (isRecovering.current) return;

    const audio = audioRef.current;
    const track = activeTrackRef.current;
    if (!audio || !track) {
      clearStallRecoveryTimer();
      return;
    }
    if (manualPauseRef.current || audio.ended) {
      clearStallRecoveryTimer();
      return;
    }

    if (stallRecoveryAttemptsRef.current >= STALL_RECOVERY_MAX_ATTEMPTS) {
      logAudioEvent('recovery-exhausted', audio, {
        triggerEvent,
        maxAttempts: STALL_RECOVERY_MAX_ATTEMPTS
      });
      setPlaybackError('Playback stalled. Tap play to retry.');
      clearStallRecoveryTimer();
      return;
    }

    stallRecoveryAttemptsRef.current += 1;
    const attempt = stallRecoveryAttemptsRef.current;
    isRecovering.current = true;
    let recovered = false;
    let shouldRetry = false;

    try {
      if (!audio.paused && !audio.ended && !audio.error && audio.readyState >= 3) {
        recovered = true;
        clearStallRecoveryTimer();
        return;
      }

      try {
        await audio.play();
        setPlaybackError(null);
        logAudioEvent('recovery-play-success', audio, {
          triggerEvent,
          strategy: 'play',
          attempt
        });
        recovered = true;
        clearStallRecoveryTimer();
        return;
      } catch (playError: any) {
        logAudioEvent('recovery-play-failed', audio, {
          triggerEvent,
          strategy: 'play',
          attempt,
          error: String(playError?.message || playError || 'play failed')
        });
        shouldRetry = true;
      }

      if (!resolveTrackAudioUrl) {
        shouldRetry = true;
        return;
      }

      const canReplaceSource = audio.paused || audio.ended || Boolean(audio.error);
      if (!canReplaceSource) {
        logAudioEvent('recovery-refresh-skipped', audio, {
          triggerEvent,
          attempt,
          reason: 'active-playback-no-error'
        });
        shouldRetry = true;
        return;
      }

      let refreshedUrl = '';
      try {
        const next = await resolveTrackAudioUrl(track, {
          forceRefresh: true,
          reason: triggerEvent
        });
        refreshedUrl = String(next || '').trim();
      } catch (refreshError: any) {
        logAudioEvent('recovery-refresh-failed', audio, {
          triggerEvent,
          attempt,
          error: String(refreshError?.message || refreshError || 'refresh failed')
        });
        shouldRetry = true;
        return;
      }

      if (!isPlayableAudioUrl(refreshedUrl)) {
        logAudioEvent('recovery-refresh-invalid-url', audio, { triggerEvent, attempt });
        shouldRetry = true;
        return;
      }

      const currentSrc = normalizeRuntimeAudioUrl(String(audio.currentSrc || audio.src || ''));
      const nextSrc = normalizeRuntimeAudioUrl(refreshedUrl);
      const shouldReplaceSource = Boolean(nextSrc) && nextSrc !== currentSrc;
      if (!shouldReplaceSource && !audio.error) {
        logAudioEvent('recovery-refresh-not-needed', audio, { triggerEvent });
        recovered = true;
        clearStallRecoveryTimer();
        return;
      }

      const resumeTime = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.src = refreshedUrl;
      audio.load();
      if (resumeTime > 0) {
        const restoreTime = () => {
          try {
            const maxTime = Number.isFinite(audio.duration) && audio.duration > 0
              ? Math.max(0, audio.duration - 0.2)
              : resumeTime;
            audio.currentTime = Math.min(resumeTime, maxTime);
          } catch {
            // Some mobile browsers may block seek until metadata settles.
          }
        };
        audio.addEventListener('loadedmetadata', restoreTime, { once: true });
      }

      await audio.play();
      setPlaybackError(null);
      logAudioEvent('recovery-refresh-success', audio, {
        triggerEvent,
        strategy: 'refresh-src',
        replacedSource: true,
        attempt,
        resumeTime
      });
      recovered = true;
      clearStallRecoveryTimer();
    } catch (recoveryError: any) {
      shouldRetry = true;
      logAudioEvent('recovery-attempt-error', audio, {
        triggerEvent,
        attempt,
        error: String(recoveryError?.message || recoveryError || 'unknown recovery error')
      });
    } finally {
      isRecovering.current = false;
      if (!recovered && shouldRetry) {
        if (stallRecoveryAttemptsRef.current >= STALL_RECOVERY_MAX_ATTEMPTS) {
          logAudioEvent('recovery-exhausted', audio, {
            triggerEvent,
            maxAttempts: STALL_RECOVERY_MAX_ATTEMPTS
          });
          setPlaybackError('Playback stalled. Tap play to retry.');
          clearStallRecoveryTimer();
        } else {
          const nextAttempt = stallRecoveryAttemptsRef.current + 1;
          logAudioEvent('recovery-retry-scheduled', audio, {
            triggerEvent,
            attempt,
            nextAttempt,
            cooldownMs: STALL_RECOVERY_COOLDOWN_MS
          });
          if (typeof window !== 'undefined') {
            if (stallRetryTimerRef.current !== null) {
              window.clearTimeout(stallRetryTimerRef.current);
            }
            stallRetryTimerRef.current = window.setTimeout(() => {
              stallRetryTimerRef.current = null;
              void attemptStallRecovery(triggerEvent);
            }, STALL_RECOVERY_COOLDOWN_MS);
          }
        }
      }
    }
  };

  const startStallRecovery = (triggerEvent: 'stalled' | 'waiting' | 'error') => {
    const audio = audioRef.current;
    if (!audio || !activeTrackRef.current || manualPauseRef.current) return;
    stallRecoveryAttemptsRef.current = 0;
    isRecovering.current = false;
    if (typeof window !== 'undefined' && stallRetryTimerRef.current !== null) {
      window.clearTimeout(stallRetryTimerRef.current);
      stallRetryTimerRef.current = null;
    }
    logAudioEvent('recovery-loop-start', audio, {
      triggerEvent,
      cooldownMs: STALL_RECOVERY_COOLDOWN_MS,
      maxAttempts: STALL_RECOVERY_MAX_ATTEMPTS
    });
    if (typeof window !== 'undefined') {
      stallRetryTimerRef.current = window.setTimeout(() => {
        stallRetryTimerRef.current = null;
        void attemptStallRecovery(triggerEvent);
      }, STALL_RECOVERY_COOLDOWN_MS);
    }
  };

  useEffect(() => {
    if (!onPlayerStateChange) return;
    onPlayerStateChange({
      isPlaying,
      currentTrackId: currentlyPlayingTrackId
    });
  }, [isPlaying, currentlyPlayingTrackId, onPlayerStateChange]);

  useEffect(() => {
    return () => {
      clearStallRecoveryTimer();
      activeTrackRef.current = null;
      manualPauseRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
    };
  }, []);

  const handleTogglePlay = async (track: Track) => {
    if (!audioRef.current) return;

    const audio = audioRef.current;
    setPlaybackError(null);

    if (currentlyPlayingTrackId === track.trackId && isPlaying) {
      manualPauseRef.current = true;
      clearStallRecoveryTimer();
      audio.pause();
      setIsPlaying(false);
      logAudioEvent('pause', audio, { reason: 'user-toggle' });
      return;
    }

    manualPauseRef.current = false;
    activeTrackRef.current = track;

    try {
      const rawUrl = getTrackAudioValue(track);
      const fallbackUrl = resolveUrl(rawUrl);
      let playableUrl = fallbackUrl;

      if (resolveTrackAudioUrl) {
        const resolved = await resolveTrackAudioUrl(track, { reason: 'manual' });
        playableUrl = String(resolved || '').trim() || fallbackUrl;
      }

      if (!isPlayableAudioUrl(playableUrl)) {
        throw new Error('Audio URL is missing or invalid.');
      }

      let probeError = await rangeCheckPlayableUrl(playableUrl, track);
      if (probeError && resolveTrackAudioUrl) {
        const refreshed = await resolveTrackAudioUrl(track, {
          forceRefresh: true,
          reason: 'probe'
        });
        playableUrl = String(refreshed || '').trim() || playableUrl;
        if (isPlayableAudioUrl(playableUrl)) {
          probeError = await rangeCheckPlayableUrl(playableUrl, track);
        }
      }
      if (probeError) {
        throw new Error(probeError);
      }

      const shouldReplaceSource =
        currentlyPlayingTrackId !== track.trackId ||
        normalizeRuntimeAudioUrl(String(audio.currentSrc || '')) !== normalizeRuntimeAudioUrl(playableUrl);
      const canReplaceSource =
        currentlyPlayingTrackId !== track.trackId ||
        audio.paused ||
        audio.ended ||
        Boolean(audio.error);
      const isSwitchingTracks = currentlyPlayingTrackId !== track.trackId;

      if (shouldReplaceSource && canReplaceSource) {
        clearStallRecoveryTimer();
        if (isPlaying && isSwitchingTracks) {
          audio.pause();
        }
        audio.removeAttribute('src');
        audio.load();
        audio.src = playableUrl;
        audio.load();
        setCurrentTime(0);
        setDuration(0);
      } else if (shouldReplaceSource && !canReplaceSource) {
        logAudioEvent('source-refresh-skipped', audio, {
          reason: 'active-playback-no-error'
        });
      }

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      clearStallRecoveryTimer();
      setIsPlaying(true);
      setCurrentlyPlayingTrackId(track.trackId);
      logAudioEvent('play', audio, { reason: 'user-toggle' });
      if (!isPreview) StorageService.logEvent(project.projectId, EventType.TRACK_PLAY, track.title);
    } catch (err: any) {
      const message = toSafeTrackPlaybackErrorMessage(err);
      const isBenignSwitchError = isBenignSwitchPlaybackError(err);
      if (suppressBenignPlaybackErrors && isBenignSwitchError) {
        setPlaybackError(null);
        console.debug('[AUDIO] benign playback interruption suppressed', {
          projectId: project.projectId,
          trackId: track.trackId,
          error: message
        });
      } else {
        setPlaybackError(message);
      }
      setIsPlaying(false);
      clearStallRecoveryTimer();
      if (currentlyPlayingTrackId === track.trackId) {
        setCurrentlyPlayingTrackId(null);
        activeTrackRef.current = null;
      }
      logAudioEvent('error', audio, {
        reason: 'toggle-play-failed',
        trackId: track.trackId,
        error: message
      });
      console.warn('[AUDIO] track playback failed', {
        projectId: project.projectId,
        trackId: track.trackId,
        error: message
      });
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (!Number.isFinite(next) || !audioRef.current) return;
    audioRef.current.currentTime = next;
    setCurrentTime(next);
  };

  const mp3Tracks = tracks.filter((track) => {
    const rawUrl = getTrackAudioValue(track);
    const resolvedUrl = resolveUrl(rawUrl);
    const storagePath = String(track.audioPath || track.storagePath || '').trim();
    const normalizedRaw = rawUrl.toLowerCase();
    const normalizedResolved = resolvedUrl.toLowerCase();
    return (
      Boolean(storagePath) ||
      isAudioAssetRef(rawUrl) ||
      normalizedResolved.startsWith('blob:') ||
      normalizedResolved.startsWith('data:audio/mpeg') ||
      normalizedResolved.startsWith('data:audio/mp3') ||
      normalizedResolved.includes('p.scdn.co') ||
      normalizedResolved.includes('.mp3') ||
      normalizedResolved.includes('.wav') ||
      normalizedResolved.includes('.m4a') ||
      normalizedResolved.includes('.aac') ||
      normalizedResolved.includes('.ogg') ||
      normalizedResolved.includes('.flac') ||
      normalizedRaw.includes('.mp3') ||
      normalizedRaw.includes('.wav') ||
      normalizedRaw.includes('.m4a') ||
      normalizedRaw.includes('.aac') ||
      normalizedRaw.includes('.ogg') ||
      normalizedRaw.includes('.flac')
    );
  });
  const displayTracks = showAllTracks ? tracks : mp3Tracks;

  const listWrapperClass = isPreview ? 'px-0 pb-10' : 'px-3 pb-8';
  const listClass = isPreview
    ? 'space-y-3 bg-slate-900/40 border border-slate-800/70 rounded-none p-3 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur'
    : 'space-y-2';

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[DEBUG] TAPRenderer', {
        projectId: project.projectId,
        slug: project.slug,
        totalTracks: tracks.length,
        mp3Tracks: mp3Tracks.length
      });
    }
  }, [project.projectId, project.slug, tracks.length, mp3Tracks.length]);

  const resolvedCover = resolveUrl(project.coverImageUrl || '');
  const coverSrc = resolvedCover || '';

  const nowPlayingTrack = currentlyPlayingTrackId
    ? displayTracks.find((track) => track.trackId === currentlyPlayingTrackId) || tracks.find((track) => track.trackId === currentlyPlayingTrackId) || null
    : null;
  const nowPlayingArtwork = nowPlayingTrack
    ? (resolveUrl(nowPlayingTrack.artworkUrl || '') || coverSrc)
    : coverSrc;
  const progressMax = duration > 0 ? duration : 1;
  const progressValue = Math.min(progressMax, Math.max(0, currentTime));

  const normalizeSocialUrl = (value: string, provider: string): string => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    const cleaned = raw.replace(/^@/, '');
    if (/[./]/.test(cleaned)) {
      return `https://${cleaned}`;
    }
    switch (provider) {
      case 'instagram':
        return `https://www.instagram.com/${cleaned}`;
      case 'twitter':
        return `https://x.com/${cleaned}`;
      case 'tiktok':
        return `https://www.tiktok.com/@${cleaned}`;
      case 'youtube':
        return `https://www.youtube.com/@${cleaned}`;
      case 'facebook':
        return `https://www.facebook.com/${cleaned}`;
      default:
        return '';
    }
  };

  const socialBadges = [
    { key: 'instagramUrl', provider: 'instagram', label: 'Instagram', icon: <Instagram size={18} />, color: 'text-pink-400' },
    { key: 'twitterUrl', provider: 'twitter', label: 'X', icon: <Twitter size={18} />, color: 'text-blue-400' },
    { key: 'tiktokUrl', provider: 'tiktok', label: 'TikTok', icon: <Music2 size={18} />, color: 'text-white' },
    { key: 'youtubeUrl', provider: 'youtube', label: 'YouTube', icon: <Video size={18} />, color: 'text-red-500' },
    { key: 'facebookUrl', provider: 'facebook', label: 'Facebook', icon: <Facebook size={18} />, color: 'text-blue-500' }
  ]
    .map((badge) => {
      const raw = (project as any)[badge.key] as string | undefined;
      const url = normalizeSocialUrl(raw || '', badge.provider);
      return url ? { ...badge, url } : null;
    })
    .filter(Boolean) as Array<{ label: string; url: string; icon: React.ReactNode; color: string }>;

  const normalizeCtaUrl = (value: string): string => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    return `https://${trimmed}`;
  };

  const ticketsUrl = normalizeCtaUrl(project.ticketsUrl || '');
  const merchUrl = normalizeCtaUrl(project.merchUrl || '');

  return (
    <div className={`${isPreview ? 'w-full h-full bg-slate-950 overflow-y-auto scrollbar-hide text-slate-100 flex flex-col' : 'relative w-full tap-full-height bg-slate-950 text-slate-100 flex flex-col'}`}>
      <audio
        ref={audioRef}
        onEnded={(event) => {
          clearStallRecoveryTimer();
          activeTrackRef.current = null;
          manualPauseRef.current = false;
          lastTimeUpdateLogSecondRef.current = -1;
          setIsPlaying(false);
          setCurrentlyPlayingTrackId(null);
          setCurrentTime(0);
          logAudioEvent('ended', event.currentTarget);
        }}
        onPlay={(event) => {
          manualPauseRef.current = false;
          clearStallRecoveryTimer();
          setIsPlaying(true);
          logAudioEvent('play', event.currentTarget, { reason: 'audio-event' });
        }}
        onPause={(event) => {
          setIsPlaying(false);
          logAudioEvent('pause', event.currentTarget, { reason: manualPauseRef.current ? 'user-pause' : 'audio-event' });
        }}
        onStalled={(event) => {
          logAudioEvent('stalled', event.currentTarget);
          startStallRecovery('stalled');
        }}
        onWaiting={(event) => {
          logAudioEvent('waiting', event.currentTarget);
          startStallRecovery('waiting');
        }}
        onError={(event) => {
          const code = event.currentTarget.error?.code || 0;
          logAudioEvent('error', event.currentTarget, { reason: 'audio-element-error', code });
          setPlaybackError(`Playback error (code ${code || 'unknown'})`);
          startStallRecovery('error');
        }}
        onTimeUpdate={(event) => {
          const next = Number(event.currentTarget.currentTime);
          const normalized = Number.isFinite(next) ? next : 0;
          setCurrentTime(normalized);
          const wholeSeconds = Math.floor(normalized);
          if (wholeSeconds !== lastTimeUpdateLogSecondRef.current) {
            lastTimeUpdateLogSecondRef.current = wholeSeconds;
            logAudioEvent('timeupdate', event.currentTarget);
          }
        }}
        onLoadedMetadata={(event) => {
          const next = Number(event.currentTarget.duration);
          setDuration(Number.isFinite(next) ? next : 0);
          logAudioEvent('loadedmetadata', event.currentTarget);
        }}
        onDurationChange={(event) => {
          const next = Number(event.currentTarget.duration);
          setDuration(Number.isFinite(next) ? next : 0);
          logAudioEvent('durationchange', event.currentTarget);
        }}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        className="hidden"
      />

      <div className={`${isPreview ? 'h-full overflow-y-auto scrollbar-hide' : 'flex-1 overflow-y-auto tap-native-scroll pb-44'}`}>
        {!isPreview && showMeta && (
          useGoLiveHeader ? (
            <GoLiveAlbumHeader
              title={project.title}
              artist={project.artistName}
              trackCount={displayTracks.length}
              showInstallButton={showInstallButton}
              onInstallClick={onInstallClick}
            />
          ) : (
            <div className="sticky top-0 z-20 px-4 tap-safe-top pb-3 bg-gradient-to-b from-slate-950/95 via-slate-950/90 to-slate-950/70 backdrop-blur-xl border-b border-white/5">
              <p className="text-[10px] uppercase tracking-[0.35em] font-black text-slate-500">Now Streaming</p>
              <div className="flex items-end justify-between mt-2">
                <div className="min-w-0">
                  <h1 className="text-[18px] font-black tracking-tight text-white truncate">{project.title}</h1>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-green-400 mt-1 truncate">{project.artistName}</p>
                </div>
                <span className="text-[10px] uppercase tracking-[0.28em] font-black text-slate-500 flex-shrink-0 pl-3">{displayTracks.length} tracks</span>
              </div>
            </div>
          )
        )}

        {showCover && (
          <div className={`${isPreview ? 'px-6 pt-8 pb-4' : 'px-4 pt-5 pb-4'} flex justify-center`}>
            <div className={`${isPreview ? 'max-w-[280px] rounded-[2.5rem]' : 'max-w-[360px] rounded-[2.1rem]'} relative aspect-square w-full shadow-[0_30px_70px_rgba(0,0,0,0.7)] overflow-hidden border border-white/10 ring-1 ring-white/5`}>
              {coverSrc ? (
                <ResponsiveImage
                  src={coverSrc}
                  assetRef={project.coverImageUrl}
                  alt={project.title}
                  className="w-full h-full object-cover"
                  loading={isPreview ? 'lazy' : 'eager'}
                  fetchPriority={isPreview ? 'auto' : 'high'}
                  sizes={coverSizes || '(max-width: 640px) 82vw, 360px'}
                />
              ) : (
                <div className="w-full h-full bg-slate-900/70" />
              )}
              {isPreview && (
                <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/35"></div>
              )}
            </div>
          </div>
        )}

        {showMeta && isPreview && (
          <div className="px-6 pb-4 text-center">
            <h1 className="text-2xl font-black tracking-tight text-white">{project.title}</h1>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-green-400 mt-2">{project.artistName}</p>
          </div>
        )}

        {socialBadges.length > 0 && (
          <div className={`${isPreview ? 'px-6 pb-4' : 'px-4 pb-4'}`}>
            <div className="flex items-center justify-center gap-3">
              {socialBadges.map((badge) => (
                <a
                  key={badge.label}
                  href={badge.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={badge.label}
                  className={`w-11 h-11 rounded-full border border-slate-800 bg-slate-900/60 transition-colors flex items-center justify-center touch-manipulation active:scale-95 ${badge.color}`}
                >
                  {badge.icon}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className={listWrapperClass}>
          {playbackError && (
            <div className="mb-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
              {playbackError}
            </div>
          )}
          <div className={listClass}>
            {isPreview && displayTracks.length > 0 && (
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-[12px] font-black tracking-[0.08em] text-slate-200 truncate max-w-[70%]">
                  {project.title}
                </span>
                <span className="text-[10px] uppercase tracking-[0.4em] font-black text-slate-500">
                  {displayTracks.length}
                </span>
              </div>
            )}
            {displayTracks.map((track, index) => {
              const audioUrl = resolveUrl(getTrackAudioValue(track));
              return (
                <TrackRow
                  key={track.trackId}
                  track={track}
                  artworkUrl={resolveUrl(track.artworkUrl || '') || coverSrc}
                  subtext={project.artistName || ''}
                  trackNumber={index + 1}
                  audioUrl={audioUrl}
                  canPlay={canPlayTrack(track, audioUrl)}
                  isPlaying={isPlaying && currentlyPlayingTrackId === track.trackId}
                  isActive={currentlyPlayingTrackId === track.trackId}
                  onTogglePlay={handleTogglePlay}
                  isPreview={isPreview}
                />
              );
            })}
            {displayTracks.length === 0 && (
              <div className="py-12 text-center bg-slate-900/20 rounded-[2rem] border border-dashed border-slate-800/60">
                <Music2 size={32} className="mx-auto text-slate-700 mb-3" />
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest">No Tracks</p>
              </div>
            )}
          </div>

          {(ticketsUrl || merchUrl) && (
            <div className="pt-4">
              <div className={`grid gap-3 ${ticketsUrl && merchUrl ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                {ticketsUrl && (
                  <a
                    href={ticketsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full min-h-[52px] px-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.26em] flex items-center justify-center transition-all bg-green-500 text-black shadow-xl shadow-green-500/20 active:scale-95 touch-manipulation"
                  >
                    Tickets
                  </a>
                )}
                {merchUrl && (
                  <a
                    href={merchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full min-h-[52px] px-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.26em] flex items-center justify-center transition-all bg-green-500 text-black shadow-xl shadow-green-500/20 active:scale-95 touch-manipulation"
                  >
                    Merch
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {!isPreview && nowPlayingTrack && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)+0.65rem)]">
          <div className="pointer-events-auto mx-auto w-full max-w-[520px] rounded-[1.7rem] border border-white/10 bg-slate-900/90 backdrop-blur-2xl shadow-[0_-20px_60px_rgba(0,0,0,0.65)] p-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-700/80 bg-slate-800 flex-shrink-0">
                {nowPlayingArtwork ? (
                  <img src={nowPlayingArtwork} alt={nowPlayingTrack.title} className="w-full h-full object-cover" loading="eager" decoding="async" />
                ) : (
                  <div className="w-full h-full bg-slate-800" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.24em] font-black text-slate-500">Now Playing</p>
                <p className="text-sm font-black text-white truncate">{nowPlayingTrack.title}</p>
              </div>
              <button
                type="button"
                onClick={() => handleTogglePlay(nowPlayingTrack)}
                className="w-12 h-12 rounded-full bg-green-500 text-black flex items-center justify-center active:scale-95 touch-manipulation shadow-lg shadow-green-500/20"
                aria-label={isPlaying ? 'Pause track' : 'Play track'}
              >
                {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} className="ml-0.5" fill="currentColor" />}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="w-9 text-[10px] text-slate-500 font-bold tabular-nums">{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={progressMax}
                step={1}
                value={progressValue}
                onChange={handleSeek}
                className="tap-progress w-full"
                aria-label="Track progress"
              />
              <span className="w-9 text-right text-[10px] text-slate-500 font-bold tabular-nums">{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(TAPRenderer);



