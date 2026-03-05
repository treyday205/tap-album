
import React, { useCallback, useContext, useEffect, useMemo, useState, useRef, memo } from 'react';
import { Music2, Instagram, Twitter, Video, Facebook, Play, Pause, SkipBack, SkipForward, ChevronLeft } from 'lucide-react';
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
type AudioCorsMode = 'anonymous' | 'none';
type CorsHeadProbeResult = {
  ok: boolean;
  status: number | null;
  error: string;
  contentType: string;
  acceptRanges: string;
  contentLength: string;
  contentRange: string;
  corsSupported: boolean;
  rangeHeaderPresent: boolean;
  mode: 'anonymous' | 'none';
  url: string;
  origin: string;
  host: string;
};

type GlobalPlayerStore = {
  currentTrackId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  setCurrentTrack: (track: Track) => void;
  playCurrentTrack: () => Promise<void>;
  pauseCurrentTrack: () => void;
  toggleTrackPlayback: (track: Track) => void;
  seekTo: (nextTime: number) => void;
};

const GlobalPlayerContext = React.createContext<GlobalPlayerStore | null>(null);

const useGlobalPlayerStore = (): GlobalPlayerStore => {
  const store = useContext(GlobalPlayerContext);
  if (!store) {
    throw new Error('useGlobalPlayerStore must be used within GlobalPlayerContext.Provider');
  }
  return store;
};

type TrackListRowsProps = {
  displayTracks: Track[];
  projectArtistName: string;
  coverSrc: string;
  resolveUrl: (value: string) => string;
  canPlayTrack: (track: Track, resolvedUrl: string) => boolean;
  onTrackPress: (track: Track) => void;
  isPreview: boolean;
};

const TrackListRows: React.FC<TrackListRowsProps> = ({
  displayTracks,
  projectArtistName,
  coverSrc,
  resolveUrl,
  canPlayTrack,
  onTrackPress,
  isPreview
}) => {
  const {
    currentTrackId,
    isPlaying,
    currentTime,
    duration,
    setCurrentTrack,
    playCurrentTrack,
    pauseCurrentTrack,
    seekTo
  } = useGlobalPlayerStore();
  const [uiMode, setUiMode] = useState<'focused' | 'list'>('focused');

  const getTrackAudioUrl = useCallback((track: Track) => {
    return resolveUrl(String(track.trackUrl || track.audioUrl || track.mp3Url || '').trim());
  }, [resolveUrl]);

  const activeTrack = currentTrackId
    ? displayTracks.find((track) => track.trackId === currentTrackId) || null
    : null;
  const activeTrackIndex = activeTrack
    ? displayTracks.findIndex((track) => track.trackId === activeTrack.trackId)
    : -1;
  const activeTrackAudioUrl = activeTrack ? getTrackAudioUrl(activeTrack) : '';
  const canPlayActiveTrack = activeTrack ? canPlayTrack(activeTrack, activeTrackAudioUrl) : false;
  const shouldShowFocusedTrack = Boolean(
    !isPreview &&
    uiMode === 'focused' &&
    activeTrack &&
    (currentTrackId !== null || isPlaying)
  );

  const getNextPlayableTrack = (offset: -1 | 1): Track | null => {
    if (activeTrackIndex < 0) return null;
    let index = activeTrackIndex + offset;
    while (index >= 0 && index < displayTracks.length) {
      const candidate = displayTracks[index];
      const candidateAudio = getTrackAudioUrl(candidate);
      if (canPlayTrack(candidate, candidateAudio)) {
        return candidate;
      }
      index += offset;
    }
    return null;
  };

  const previousTrack = getNextPlayableTrack(-1);
  const nextTrack = getNextPlayableTrack(1);
  const progressMax = duration > 0 ? duration : 1;
  const progressValue = Math.min(progressMax, Math.max(0, currentTime));
  const isActiveTrackPlaying = Boolean(isPlaying && activeTrack && currentTrackId === activeTrack.trackId);
  const focusArtworkUrl = activeTrack ? (resolveUrl(activeTrack.artworkUrl || '') || coverSrc) : '';

  const handleRowTrackPress = (track: Track) => {
    setUiMode('focused');
    onTrackPress(track);
  };

  const handleSelectTrack = (track: Track | null) => {
    if (!track) return;
    setCurrentTrack(track);
    void playCurrentTrack();
  };

  return (
    <div className="relative">
      <div
        className={`transition-all duration-300 ease-out ${shouldShowFocusedTrack ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 -translate-y-2 h-0 overflow-hidden'}`}
      >
        {activeTrack && (
          <div className="rounded-[2.2rem] border border-white/10 bg-slate-900/70 p-4 sm:p-6 shadow-[0_34px_70px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setUiMode('list')}
                className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-slate-300 transition-colors hover:border-slate-500 hover:text-white active:scale-95 touch-manipulation"
              >
                <ChevronLeft size={14} />
                Back to tracks
              </button>
              <span className="text-[10px] uppercase tracking-[0.3em] font-black text-green-400">Focused Player</span>
            </div>

            <div className="mt-5 text-center">
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">{activeTrack.title}</h2>
              {projectArtistName ? (
                <p className="mt-2 text-[10px] font-black uppercase tracking-[0.34em] text-slate-400">{projectArtistName}</p>
              ) : null}
            </div>

            <div className="relative mx-auto mt-6 w-[min(78vw,360px)]">
              <div className="absolute inset-0 rounded-full bg-green-400/10 blur-2xl" />
              <div
                className="relative aspect-square rounded-full border border-slate-600/70 bg-[radial-gradient(circle_at_30%_30%,#475569_0%,#0f172a_42%,#020617_100%)] animate-[spin_16s_linear_infinite] shadow-[inset_0_0_0_2px_rgba(255,255,255,0.08),0_24px_50px_rgba(0,0,0,0.5)]"
                style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
              >
                <div className="absolute inset-[8%] overflow-hidden rounded-full border border-white/20">
                  {focusArtworkUrl ? (
                    <img
                      src={focusArtworkUrl}
                      alt={`${activeTrack.title} artwork`}
                      className="h-full w-full object-cover"
                      loading="eager"
                      decoding="async"
                    />
                  ) : (
                    <div className="h-full w-full bg-slate-800" />
                  )}
                </div>
                <div className="absolute inset-[44%] rounded-full border border-slate-600/70 bg-slate-900/95" />
                <div className="absolute inset-[48.5%] rounded-full bg-slate-200/90" />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2">
              <span className="w-10 text-[10px] text-slate-500 font-bold tabular-nums">{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={progressMax}
                step={1}
                value={progressValue}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  seekTo(next);
                }}
                className="tap-progress w-full"
                aria-label="Focused player progress"
              />
              <span className="w-10 text-right text-[10px] text-slate-500 font-bold tabular-nums">{formatTime(duration)}</span>
            </div>

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => handleSelectTrack(previousTrack)}
                disabled={!previousTrack}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all touch-manipulation ${
                  previousTrack ? 'bg-slate-800 text-slate-100 active:scale-95' : 'bg-slate-800/60 text-slate-600 cursor-not-allowed'
                }`}
                aria-label="Previous track"
              >
                <SkipBack size={18} fill="currentColor" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!canPlayActiveTrack) return;
                  if (isActiveTrackPlaying) {
                    pauseCurrentTrack();
                    return;
                  }
                  handleSelectTrack(activeTrack);
                }}
                disabled={!canPlayActiveTrack}
                className={`h-14 min-w-[152px] rounded-full px-6 text-sm font-black uppercase tracking-[0.18em] flex items-center justify-center gap-2 transition-all touch-manipulation ${
                  canPlayActiveTrack
                    ? 'bg-green-500 text-black active:scale-95 shadow-xl shadow-green-500/25'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
                aria-label={isActiveTrackPlaying ? 'Pause track' : 'Play track'}
              >
                {isActiveTrackPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                {isActiveTrackPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => handleSelectTrack(nextTrack)}
                disabled={!nextTrack}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all touch-manipulation ${
                  nextTrack ? 'bg-slate-800 text-slate-100 active:scale-95' : 'bg-slate-800/60 text-slate-600 cursor-not-allowed'
                }`}
                aria-label="Next track"
              >
                <SkipForward size={18} fill="currentColor" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        className={`transition-all duration-300 ease-out ${shouldShowFocusedTrack ? 'pointer-events-none opacity-0 translate-y-2 h-0 overflow-hidden' : 'opacity-100 translate-y-0'}`}
      >
        {displayTracks.map((track, index) => {
          const audioUrl = getTrackAudioUrl(track);
          const isActiveTrack = currentTrackId === track.trackId;
          return (
            <TrackRow
              key={track.trackId}
              track={track}
              artworkUrl={resolveUrl(track.artworkUrl || '') || coverSrc}
              subtext={projectArtistName || ''}
              trackNumber={index + 1}
              audioUrl={audioUrl}
              canPlay={canPlayTrack(track, audioUrl)}
              isPlaying={Boolean(isPlaying && isActiveTrack)}
              isActive={isActiveTrack}
              onTogglePlay={handleRowTrackPress}
              isPreview={isPreview}
            />
          );
        })}
      </div>
    </div>
  );
};

type GlobalNowPlayingBarProps = {
  isPreview: boolean;
  audioElementKey: number;
  setAudioElementRef: (node: HTMLAudioElement | null) => void;
  onAudioEnded: React.ReactEventHandler<HTMLAudioElement>;
  onAudioPlay: React.ReactEventHandler<HTMLAudioElement>;
  onAudioPause: React.ReactEventHandler<HTMLAudioElement>;
  onAudioStalled: React.ReactEventHandler<HTMLAudioElement>;
  onAudioWaiting: React.ReactEventHandler<HTMLAudioElement>;
  onAudioError: React.ReactEventHandler<HTMLAudioElement>;
  onAudioTimeUpdate: React.ReactEventHandler<HTMLAudioElement>;
  onAudioLoadedMetadata: React.ReactEventHandler<HTMLAudioElement>;
  onAudioDurationChange: React.ReactEventHandler<HTMLAudioElement>;
};

const GlobalNowPlayingBar: React.FC<GlobalNowPlayingBarProps> = ({
  isPreview,
  audioElementKey,
  setAudioElementRef,
  onAudioEnded,
  onAudioPlay,
  onAudioPause,
  onAudioStalled,
  onAudioWaiting,
  onAudioError,
  onAudioTimeUpdate,
  onAudioLoadedMetadata,
  onAudioDurationChange
}) => {
  if (isPreview) {
    return null;
  }

  return (
    <audio
      key={audioElementKey}
      ref={setAudioElementRef}
      onEnded={onAudioEnded}
      onPlay={onAudioPlay}
      onPause={onAudioPause}
      onStalled={onAudioStalled}
      onWaiting={onAudioWaiting}
      onError={onAudioError}
      onTimeUpdate={onAudioTimeUpdate}
      onLoadedMetadata={onAudioLoadedMetadata}
      onDurationChange={onAudioDurationChange}
      playsInline
      autoPlay={false}
      preload="auto"
      className="hidden"
    />
  );
};

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
  const [audioElementKey, setAudioElementKey] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeTrackRef = useRef<Track | null>(null);
  const isPlayingRef = useRef(false);
  const currentlyPlayingTrackIdRef = useRef<string | null>(null);
  const displayTracksRef = useRef<Track[]>([]);
  const manualPauseRef = useRef(false);
  const stallRetryTimerRef = useRef<number | null>(null);
  const isRecovering = useRef(false);
  const stallRecoveryAttemptsRef = useRef(0);
  const lastTimeUpdateLogSecondRef = useRef(-1);
  const playRequestSeqRef = useRef(0);
  const lastOnErrorRebuildSignatureRef = useRef('');
  const noCorsFallbackOriginsRef = useRef<Record<string, true>>({});
  const corsHeadDiagnosticsRef = useRef<Record<string, CorsHeadProbeResult>>({});
  const pendingAudioRemountRef = useRef<{
    resolve: (audio: HTMLAudioElement) => void;
    reject: (error: Error) => void;
    timeoutId: number;
  } | null>(null);

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
    String(track.trackUrl || track.audioUrl || track.mp3Url || '').trim();

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

  const getRuntimeUrlInfo = (value: string) => {
    const raw = String(value || '').trim();
    const normalized = normalizeRuntimeAudioUrl(raw);
    const isData = raw.startsWith('data:');
    const isBlob = raw.startsWith('blob:');
    let urlObject: URL | null = null;
    if (!isData && !isBlob && typeof window !== 'undefined') {
      try {
        urlObject = new URL(raw, window.location.origin);
      } catch {
        urlObject = null;
      }
    }
    const origin = String(urlObject?.origin || '').trim();
    const host = String(urlObject?.hostname || '').trim().toLowerCase();
    const protocol = String(urlObject?.protocol || '').trim().toLowerCase();
    const sameOrigin = Boolean(
      urlObject &&
      typeof window !== 'undefined' &&
      urlObject.origin === window.location.origin
    );
    return {
      raw,
      normalized,
      isData,
      isBlob,
      urlObject,
      origin,
      host,
      protocol,
      sameOrigin,
      isHttp: protocol === 'http:' || protocol === 'https:'
    };
  };

  const getConfiguredAnonymousCorsHosts = () =>
    String(
      (import.meta as any)?.env?.VITE_AUDIO_CORS_ANONYMOUS_HOSTS ||
      (import.meta as any)?.env?.VITE_AUDIO_CORS_HOSTS ||
      ''
    )
      .split(',')
      .map((entry: string) => entry.trim().toLowerCase())
      .filter(Boolean);

  const isCloudflareWorkerHost = (host: string): boolean => {
    const normalizedHost = String(host || '').trim().toLowerCase();
    if (!normalizedHost) return false;
    if (
      normalizedHost.endsWith('.workers.dev') ||
      normalizedHost.endsWith('.cloudflareworkers.com')
    ) {
      return true;
    }
    const configuredHosts = getConfiguredAnonymousCorsHosts();
    return configuredHosts.includes(normalizedHost);
  };

  const shouldDefaultToAnonymousCors = (url: string): boolean => {
    const info = getRuntimeUrlInfo(url);
    if (!info.raw || info.isData || info.isBlob) return false;
    if (info.sameOrigin) return true;
    return isCloudflareWorkerHost(info.host);
  };

  const isNoCorsFallbackEnabledForUrl = (url: string): boolean => {
    const info = getRuntimeUrlInfo(url);
    if (!info.origin) return false;
    return Boolean(noCorsFallbackOriginsRef.current[info.origin]);
  };

  const getAudioCorsModeForUrl = (url: string): AudioCorsMode => {
    if (isNoCorsFallbackEnabledForUrl(url)) return 'none';
    return shouldDefaultToAnonymousCors(url) ? 'anonymous' : 'none';
  };

  const markNoCorsFallbackForUrl = (
    url: string,
    track: Track | null,
    reason: string,
    details: Record<string, unknown> = {}
  ) => {
    const info = getRuntimeUrlInfo(url);
    if (!info.origin) return;
    noCorsFallbackOriginsRef.current[info.origin] = true;
    console.warn('[AUDIO] enabling no-cors playback fallback', {
      projectId: project.projectId,
      reason,
      trackId: track?.trackId || null,
      url: info.normalized || info.raw || null,
      origin: info.origin,
      host: info.host || null,
      ...details
    });
  };

  const applyAudioCrossOriginMode = (
    audio: HTMLAudioElement,
    sourceUrl: string,
    track: Track | null,
    reason: string
  ): AudioCorsMode => {
    const mode = getAudioCorsModeForUrl(sourceUrl);
    try {
      if (mode === 'anonymous') {
        audio.crossOrigin = 'anonymous';
        audio.setAttribute('crossorigin', 'anonymous');
      } else {
        audio.crossOrigin = '';
        audio.removeAttribute('crossorigin');
      }
    } catch {
      // noop
    }
    console.log('[AUDIO]', {
      event: 'crossorigin-policy',
      projectId: project.projectId,
      trackId: track?.trackId || null,
      mode,
      reason,
      url: normalizeRuntimeAudioUrl(sourceUrl) || sourceUrl
    });
    return mode;
  };

  const probeTrackCorsHeadSupport = async (
    url: string,
    track: Track,
    context: 'manual' | 'refresh' | 'audio-error'
  ): Promise<CorsHeadProbeResult> => {
    const info = getRuntimeUrlInfo(url);
    const mode = getAudioCorsModeForUrl(url);
    const emptyResult: CorsHeadProbeResult = {
      ok: false,
      status: null,
      error: '',
      contentType: '',
      acceptRanges: '',
      contentLength: '',
      contentRange: '',
      corsSupported: false,
      rangeHeaderPresent: false,
      mode,
      url: info.normalized || info.raw,
      origin: info.origin,
      host: info.host
    };

    if (!info.raw || info.isData || info.isBlob || !info.isHttp) {
      return {
        ...emptyResult,
        ok: true,
        corsSupported: true
      };
    }

    const cacheKey = `${info.origin || info.host || info.normalized}|${mode}`;
    const cached = corsHeadDiagnosticsRef.current[cacheKey];
    if (cached && context !== 'audio-error') {
      return cached;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = typeof window !== 'undefined' && controller
      ? window.setTimeout(() => controller.abort(), 4500)
      : null;

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        mode: 'cors',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {})
      });

      const contentType = String(response.headers.get('content-type') || '').trim();
      const acceptRanges = String(response.headers.get('accept-ranges') || '').trim();
      const contentLength = String(response.headers.get('content-length') || '').trim();
      const contentRange = String(response.headers.get('content-range') || '').trim();
      const result: CorsHeadProbeResult = {
        ok: response.ok,
        status: response.status,
        error: '',
        contentType,
        acceptRanges,
        contentLength,
        contentRange,
        corsSupported: true,
        rangeHeaderPresent: /bytes/i.test(acceptRanges),
        mode,
        url: info.normalized || info.raw,
        origin: info.origin,
        host: info.host
      };
      corsHeadDiagnosticsRef.current[cacheKey] = result;
      console.log('[AUDIO]', {
        event: 'cors-head-check',
        context,
        projectId: project.projectId,
        trackId: track.trackId,
        url: result.url,
        mode: 'cors',
        status: response.status,
        ok: response.ok,
        contentType: contentType || null,
        acceptRanges: acceptRanges || null,
        contentLength: contentLength || null,
        contentRange: contentRange || null
      });
      return result;
    } catch (error: any) {
      const message = String(error?.message || error || 'HEAD request failed').trim();
      const result: CorsHeadProbeResult = {
        ...emptyResult,
        error: message
      };
      corsHeadDiagnosticsRef.current[cacheKey] = result;
      console.warn('[AUDIO] cors-head-check failed', {
        context,
        projectId: project.projectId,
        trackId: track.trackId,
        url: emptyResult.url || url,
        mode: 'cors',
        error: message
      });
      return result;
    } finally {
      if (timeoutId !== null && typeof window !== 'undefined') {
        window.clearTimeout(timeoutId);
      }
    }
  };

  const configureAudioElement = useCallback((audio: HTMLAudioElement | null) => {
    if (!audio) return;
    try {
      audio.preload = 'auto';
    } catch {
      // noop
    }
    try {
      audio.setAttribute('preload', 'auto');
      audio.removeAttribute('crossorigin');
      audio.setAttribute('type', 'audio/mpeg');
    } catch {
      // noop
    }
  }, []);

  const setAudioElementRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    if (!node) return;

    configureAudioElement(node);

    const pending = pendingAudioRemountRef.current;
    if (!pending) return;

    if (typeof window !== 'undefined') {
      window.clearTimeout(pending.timeoutId);
    }
    pendingAudioRemountRef.current = null;
    pending.resolve(node);
  }, [configureAudioElement]);

  const rebuildAudioElement = async (
    reason: string,
    { track, sourceUrl }: { track?: Track | null; sourceUrl?: string } = {}
  ): Promise<HTMLAudioElement> => {
    if (typeof window === 'undefined') {
      throw new Error('Audio element rebuild unavailable.');
    }

    const existingAudio = audioRef.current;
    if (existingAudio) {
      try {
        existingAudio.pause();
      } catch {
        // noop
      }
      try {
        existingAudio.removeAttribute('src');
        existingAudio.load();
      } catch {
        // noop
      }
    }

    if (pendingAudioRemountRef.current) {
      window.clearTimeout(pendingAudioRemountRef.current.timeoutId);
      pendingAudioRemountRef.current.reject(new Error('Audio element rebuild superseded.'));
      pendingAudioRemountRef.current = null;
    }

    console.warn('[AUDIO] rebuilding-audio-element', {
      projectId: project.projectId,
      reason,
      trackId: track?.trackId || null,
      sourceUrl: String(sourceUrl || '').trim() || null
    });

    return await new Promise<HTMLAudioElement>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (pendingAudioRemountRef.current?.timeoutId === timeoutId) {
          pendingAudioRemountRef.current = null;
        }
        reject(new Error('Audio element rebuild timed out.'));
      }, 1200);

      pendingAudioRemountRef.current = { resolve, reject, timeoutId };
      setAudioElementKey((prev) => prev + 1);
    });
  };

  const attachAudioSourceWithFallback = async (
    audio: HTMLAudioElement,
    sourceUrl: string,
    track: Track,
    reason: 'toggle-play' | 'recovery-refresh' | 'error-rebuild'
  ): Promise<HTMLAudioElement> => {
    const normalizedTargetUrl = normalizeRuntimeAudioUrl(sourceUrl);

    const sourceIsAttached = (target: HTMLAudioElement) => {
      const attrSrc = String(target.getAttribute('src') || '').trim();
      const propSrc = String(target.src || '').trim();
      const currentSrc = String(target.currentSrc || '').trim();
      const matches = [attrSrc, propSrc, currentSrc]
        .map((value) => normalizeRuntimeAudioUrl(value))
        .filter(Boolean)
        .includes(normalizedTargetUrl);
      return { matches, attrSrc, propSrc, currentSrc };
    };

    const applySource = (target: HTMLAudioElement) => {
      configureAudioElement(target);
      applyAudioCrossOriginMode(target, sourceUrl, track, `attach:${reason}`);
      target.removeAttribute('src');
      target.setAttribute('src', sourceUrl);
      target.src = sourceUrl;
      target.load();
    };

    applySource(audio);
    let attachedState = sourceIsAttached(audio);
    if (attachedState.matches) return audio;

    console.warn('[AUDIO] audio-source-attach-failed', {
      projectId: project.projectId,
      reason,
      trackId: track.trackId,
      targetUrl: sourceUrl,
      attrSrc: attachedState.attrSrc || null,
      propSrc: attachedState.propSrc || null,
      currentSrc: attachedState.currentSrc || null
    });

    const rebuiltAudio = await rebuildAudioElement('attach-failed', { track, sourceUrl });
    applySource(rebuiltAudio);
    attachedState = sourceIsAttached(rebuiltAudio);

    if (!attachedState.matches) {
      console.error('[AUDIO] audio-source-attach-failed-after-rebuild', {
        projectId: project.projectId,
        reason,
        trackId: track.trackId,
        targetUrl: sourceUrl,
        attrSrc: attachedState.attrSrc || null,
        propSrc: attachedState.propSrc || null,
        currentSrc: attachedState.currentSrc || null
      });
      throw new Error('Audio source failed to attach to player element.');
    }

    return rebuiltAudio;
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

  const resetAudioElementForSwitch = async (
    audio: HTMLAudioElement,
    { clearSource = true }: { clearSource?: boolean } = {}
  ) => {
    const wasPlaying = !audio.paused;
    audio.pause();

    if (wasPlaying && !audio.paused) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          audio.removeEventListener('pause', finish);
          resolve();
        };
        audio.addEventListener('pause', finish, { once: true });
        window.setTimeout(finish, 120);
      });
    }

    try {
      audio.currentTime = 0;
    } catch {
      // Some browsers block immediate seek while source is changing.
    }

    if (clearSource) {
      audio.removeAttribute('src');
      audio.load();
    }
  };

  const probeTrackAudioUrl = async (
    url: string,
    track: Track,
    context: 'manual' | 'refresh' | 'audio-error'
  ): Promise<{
    ok: boolean;
    status: number | null;
    failureType: 'http' | 'cors' | 'network' | null;
    message: string;
    error: string;
    skipped?: boolean;
  }> => {
    if (isNoCorsFallbackEnabledForUrl(url)) {
      console.log('[AUDIO]', {
        event: 'url-health-check-skipped',
        context,
        method: 'GET',
        range: 'bytes=0-0',
        projectId: project.projectId,
        trackId: track.trackId,
        reason: 'no-cors-fallback',
        url
      });
      return {
        ok: true,
        status: null,
        failureType: null,
        message: '',
        error: '',
        skipped: true
      };
    }
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
        context,
        method: 'GET',
        range: 'bytes=0-0',
        projectId: project.projectId,
        trackId: track.trackId,
        status: response.status,
        ok,
        url
      });
      if (ok) {
        return {
          ok: true,
          status: response.status,
          failureType: null,
          message: '',
          error: ''
        };
      }
      return {
        ok: false,
        status: response.status,
        failureType: 'http',
        message: `Track unavailable (HTTP ${response.status})`,
        error: ''
      };
    } catch (error: any) {
      const errorMessage = String(error?.message || error || 'network error').trim();
      const isCorsLike =
        /failed to fetch|networkerror|cors|blocked|load failed/i.test(errorMessage) ||
        (typeof navigator !== 'undefined' && navigator.onLine);
      console.log('[AUDIO]', {
        event: 'url-health-check',
        context,
        method: 'GET',
        range: 'bytes=0-0',
        projectId: project.projectId,
        trackId: track.trackId,
        status: 0,
        ok: false,
        failureType: isCorsLike ? 'cors' : 'network',
        url,
        error: errorMessage
      });
      return {
        ok: false,
        status: null,
        failureType: isCorsLike ? 'cors' : 'network',
        message: isCorsLike ? 'Track unavailable (CORS)' : 'Track unavailable (network)',
        error: errorMessage
      };
    }
  };

  const attemptStallRecovery = async (triggerEvent: 'stalled' | 'waiting' | 'error') => {
    if (isRecovering.current) return;

    let audio = audioRef.current;
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
      audio = await attachAudioSourceWithFallback(audio, refreshedUrl, track, 'recovery-refresh');
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
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentlyPlayingTrackIdRef.current = currentlyPlayingTrackId;
  }, [currentlyPlayingTrackId]);

  useEffect(() => {
    if (!onPlayerStateChange) return;
    onPlayerStateChange({
      isPlaying,
      currentTrackId: currentlyPlayingTrackId
    });
  }, [isPlaying, currentlyPlayingTrackId, onPlayerStateChange]);

  useEffect(() => {
    return () => {
      playRequestSeqRef.current += 1;
      clearStallRecoveryTimer();
      activeTrackRef.current = null;
      manualPauseRef.current = false;
      if (pendingAudioRemountRef.current && typeof window !== 'undefined') {
        window.clearTimeout(pendingAudioRemountRef.current.timeoutId);
        pendingAudioRemountRef.current.reject(new Error('Audio player unmounted.'));
        pendingAudioRemountRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        const mediaSession = navigator.mediaSession;
        try {
          mediaSession.metadata = null;
        } catch {
          // noop
        }
        try {
          mediaSession.setActionHandler('play', null);
          mediaSession.setActionHandler('pause', null);
          mediaSession.setActionHandler('previoustrack', null);
          mediaSession.setActionHandler('nexttrack', null);
          mediaSession.setActionHandler('seekto', null);
        } catch {
          // noop
        }
      }
    };
  }, []);

  const handleTogglePlay = async (track: Track) => {
    if (!audioRef.current) return;

    let audio = audioRef.current;
    const requestSeq = playRequestSeqRef.current + 1;
    playRequestSeqRef.current = requestSeq;
    const isActiveRequest = () => playRequestSeqRef.current === requestSeq;
    setPlaybackError(null);
    lastOnErrorRebuildSignatureRef.current = '';

    const currentTrackId = currentlyPlayingTrackIdRef.current;
    const sameTrack = currentTrackId === track.trackId;
    const wasPlaying = isPlayingRef.current;
    if (sameTrack && wasPlaying) {
      manualPauseRef.current = true;
      clearStallRecoveryTimer();
      audio.pause();
      setIsPlaying(false);
      logAudioEvent('pause', audio, { reason: 'user-toggle' });
      return;
    }

    manualPauseRef.current = false;
    activeTrackRef.current = track;
    const isSwitchingTracks = Boolean(currentTrackId && currentTrackId !== track.trackId);
    const hasStoragePath = Boolean(String(track.audioPath || track.storagePath || '').trim());
    const resolvedStoragePath = String(track.audioPath || track.storagePath || '').trim();
    const resolvedStorageBucket = String(track.storageBucket || '').trim();
    let lastResolvedPlayableUrl = '';

    try {
      if (isSwitchingTracks) {
        clearStallRecoveryTimer();
        await resetAudioElementForSwitch(audio, { clearSource: true });
        if (!isActiveRequest()) return;
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }

      const rawUrl = getTrackAudioValue(track);
      const fallbackUrl = resolveUrl(rawUrl);
      let playableUrl = fallbackUrl;

      if (resolveTrackAudioUrl) {
        const resolved = await resolveTrackAudioUrl(track, {
          reason: 'manual',
          forceRefresh: isSwitchingTracks && hasStoragePath
        });
        if (!isActiveRequest()) return;
        playableUrl = String(resolved || '').trim() || fallbackUrl;
      }
      lastResolvedPlayableUrl = playableUrl;

      if (!isPlayableAudioUrl(playableUrl)) {
        throw new Error('Audio URL is missing or invalid.');
      }

      const inspectUrlForCorsCompatibility = async (
        candidateUrl: string,
        context: 'manual' | 'refresh'
      ) => {
        const info = getRuntimeUrlInfo(candidateUrl);
        const headResult = await probeTrackCorsHeadSupport(candidateUrl, track, context);
        if (!isActiveRequest()) return headResult;

        const missingRangeHeader = headResult.ok && !headResult.rangeHeaderPresent;
        const suspiciousMimeType = headResult.ok && Boolean(headResult.contentType) &&
          !/^audio\//i.test(headResult.contentType) &&
          !/octet-stream/i.test(headResult.contentType);
        const shouldEnableFallback =
          Boolean(info.origin) &&
          !info.sameOrigin &&
          (!headResult.ok || missingRangeHeader || suspiciousMimeType);

        if (shouldEnableFallback) {
          markNoCorsFallbackForUrl(candidateUrl, track, 'cors-head-incompatible', {
            context,
            status: headResult.status,
            headError: headResult.error || null,
            acceptRanges: headResult.acceptRanges || null,
            contentType: headResult.contentType || null
          });
          setPlaybackError('Host missing CORS/Range headers');
        }

        return headResult;
      };

      await inspectUrlForCorsCompatibility(playableUrl, 'manual');
      if (!isActiveRequest()) return;

      if (resolvedStoragePath) {
        console.log('[AUDIO] resolved-track-url', {
          projectId: project.projectId,
          trackId: track.trackId,
          storageBucket: resolvedStorageBucket || null,
          storagePath: resolvedStoragePath,
          isSwitchingTracks,
          hasStoragePath,
          url: playableUrl
        });
      }

      let probeResult = await probeTrackAudioUrl(playableUrl, track, 'manual');
      if (!isActiveRequest()) return;

      if (!probeResult.ok && resolveTrackAudioUrl) {
        console.warn('[AUDIO] track URL probe failed', {
          projectId: project.projectId,
          trackId: track.trackId,
          context: 'manual',
          status: probeResult.status ?? (probeResult.failureType === 'cors' ? 'CORS' : 'NETWORK'),
          failureType: probeResult.failureType || 'http',
          storageBucket: resolvedStorageBucket || null,
          storagePath: resolvedStoragePath || null,
          url: playableUrl,
          error: probeResult.error || probeResult.message
        });
        const refreshed = await resolveTrackAudioUrl(track, {
          forceRefresh: true,
          reason: 'probe'
        });
        if (!isActiveRequest()) return;
        playableUrl = String(refreshed || '').trim() || playableUrl;
        lastResolvedPlayableUrl = playableUrl;
        if (isPlayableAudioUrl(playableUrl)) {
          await inspectUrlForCorsCompatibility(playableUrl, 'refresh');
          if (!isActiveRequest()) return;
          probeResult = await probeTrackAudioUrl(playableUrl, track, 'refresh');
          if (!isActiveRequest()) return;
        }
      }
      if (!probeResult.ok) {
        console.warn('[AUDIO] track URL probe failed', {
          projectId: project.projectId,
          trackId: track.trackId,
          context: 'refresh',
          status: probeResult.status ?? (probeResult.failureType === 'cors' ? 'CORS' : 'NETWORK'),
          failureType: probeResult.failureType || 'http',
          storageBucket: resolvedStorageBucket || null,
          storagePath: resolvedStoragePath || null,
          url: playableUrl,
          error: probeResult.error || probeResult.message
        });
        if (probeResult.failureType !== 'cors') {
          throw new Error(probeResult.message || 'Track unavailable.');
        }
      }

      const shouldReplaceSource =
        normalizeRuntimeAudioUrl(String(audio.currentSrc || audio.src || '')) !==
        normalizeRuntimeAudioUrl(playableUrl);

      if (shouldReplaceSource) {
        clearStallRecoveryTimer();
        await resetAudioElementForSwitch(audio, { clearSource: true });
        if (!isActiveRequest()) return;
        if (!audioRef.current) {
          throw new Error('Audio player is unavailable.');
        }
        audio = await attachAudioSourceWithFallback(audioRef.current, playableUrl, track, 'toggle-play');
        if (!isActiveRequest()) return;
        lastOnErrorRebuildSignatureRef.current = '';
        setCurrentTime(0);
        setDuration(0);
      }

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      if (!isActiveRequest()) {
        audio.pause();
        return;
      }
      clearStallRecoveryTimer();
      setIsPlaying(true);
      setCurrentlyPlayingTrackId(track.trackId);
      setMediaSession(toMediaSessionTrack(track));
      logAudioEvent('play', audio, { reason: 'user-toggle' });
      if (!isPreview) StorageService.logEvent(project.projectId, EventType.TRACK_PLAY, track.title);
    } catch (err: any) {
      if (!isActiveRequest()) {
        return;
      }
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
      if (currentlyPlayingTrackIdRef.current === track.trackId) {
        setCurrentlyPlayingTrackId(null);
        activeTrackRef.current = null;
      }
      logAudioEvent('error', audio, {
        reason: 'toggle-play-failed',
        trackId: track.trackId,
        error: message,
        resolvedUrl: lastResolvedPlayableUrl || null,
        currentSrc: String(audio.currentSrc || '').trim() || null,
        savedTrackUrl: String(track.trackUrl || '').trim() || null
      });
      console.warn('[AUDIO] track playback failed', {
        projectId: project.projectId,
        trackId: track.trackId,
        error: message,
        resolvedUrl: lastResolvedPlayableUrl || null,
        audioCurrentSrc: String(audio.currentSrc || '').trim() || null,
        audioSrc: String(audio.src || '').trim() || null,
        savedTrackUrl: String(track.trackUrl || '').trim() || null,
        savedAudioUrl: String(track.audioUrl || '').trim() || null,
        savedMp3Url: String(track.mp3Url || '').trim() || null
      });
    }
  };

  const setCurrentTrack = useCallback((track: Track) => {
    activeTrackRef.current = track;
    setPlaybackError(null);
  }, []);

  const playCurrentTrack = useCallback(async () => {
    const activeTrack = activeTrackRef.current;
    if (!activeTrack) return;
    await handleTogglePlay(activeTrack);
  }, [handleTogglePlay]);

  const pauseCurrentTrack = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    manualPauseRef.current = true;
    clearStallRecoveryTimer();
    audio.pause();
    setIsPlaying(false);
  }, []);

  const toggleTrackPlayback = useCallback((track: Track) => {
    setCurrentTrack(track);
    void playCurrentTrack();
  }, [setCurrentTrack, playCurrentTrack]);

  const seekTo = useCallback((next: number) => {
    if (!Number.isFinite(next) || !audioRef.current) return;
    audioRef.current.currentTime = next;
    setCurrentTime(next);
  }, []);

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

  useEffect(() => {
    displayTracksRef.current = displayTracks;
  }, [displayTracks]);

  type MediaSessionTrack = {
    title: string;
    artist?: string;
    album?: string;
    coverUrl?: string;
  };

  const toMediaSessionTrack = (track: Track | null): MediaSessionTrack | null => {
    if (!track) return null;

    const candidate = track as Track & {
      artist?: string;
      artistName?: string;
      album?: string;
      albumTitle?: string;
      coverUrl?: string;
    };
    const title = String(candidate.title || '').trim();
    if (!title) return null;

    const artist = String(candidate.artist || candidate.artistName || project.artistName || '').trim();
    const album = String(candidate.album || candidate.albumTitle || project.title || '').trim() || 'Tap Album™';
    const trackArtwork = resolveUrl(candidate.coverUrl || candidate.artworkUrl || '');
    const albumArtwork = resolveUrl(project.coverImageUrl || '');
    const coverUrl = String(trackArtwork || albumArtwork || '').trim();

    return {
      title,
      artist,
      album,
      coverUrl
    };
  };

  const setMediaSession = (track: MediaSessionTrack | null) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const mediaSession = navigator.mediaSession;
    const title = String(track?.title || project.title || '').trim() || 'Tap Album™';
    const artist = String(track?.artist || project.artistName || '').trim();
    const album = String(track?.album || project.title || '').trim() || 'Tap Album™';
    const albumArtwork = resolveUrl(project.coverImageUrl || '');
    const coverUrl = String(track?.coverUrl || albumArtwork || '').trim();

    if (typeof MediaMetadata !== 'undefined') {
      const artwork = coverUrl
        ? [{ src: coverUrl, sizes: '512x512', type: 'image/png' }]
        : [];
      mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        ...(artwork.length ? { artwork } : {})
      });
    }

    try {
      const isAudioPlaying = Boolean(audioRef.current && !audioRef.current.paused);
      mediaSession.playbackState = isAudioPlaying || isPlayingRef.current ? 'playing' : 'paused';
    } catch {
      // noop
    }

    const setActionHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // unsupported action on this browser
      }
    };

    const getQueueTrackByOffset = (offset: -1 | 1): Track | null => {
      const queue = displayTracksRef.current;
      if (queue.length === 0) return null;
      const currentTrackId = currentlyPlayingTrackIdRef.current || activeTrackRef.current?.trackId || null;
      const currentIndex = currentTrackId
        ? queue.findIndex((item) => item.trackId === currentTrackId)
        : -1;
      if (currentIndex < 0) {
        return offset === 1 ? queue[0] : queue[queue.length - 1];
      }
      const nextIndex = currentIndex + offset;
      if (nextIndex < 0 || nextIndex >= queue.length) return null;
      return queue[nextIndex];
    };

    setActionHandler('play', () => {
      const audio = audioRef.current;
      if (audio && String(audio.src || '').trim()) {
        manualPauseRef.current = false;
        if (audio.paused) {
          void audio.play().catch(() => {
            const activeTrack = activeTrackRef.current;
            if (activeTrack) void handleTogglePlay(activeTrack);
          });
        }
        return;
      }
      const activeTrack = activeTrackRef.current || displayTracksRef.current[0];
      if (activeTrack && !isPlayingRef.current) {
        void handleTogglePlay(activeTrack);
      }
    });

    setActionHandler('pause', () => {
      const audio = audioRef.current;
      if (!audio) return;
      manualPauseRef.current = true;
      audio.pause();
    });

    setActionHandler('previoustrack', () => {
      const previousTrack = getQueueTrackByOffset(-1);
      if (previousTrack) void handleTogglePlay(previousTrack);
    });

    setActionHandler('nexttrack', () => {
      const nextTrack = getQueueTrackByOffset(1);
      if (nextTrack) void handleTogglePlay(nextTrack);
    });

    setActionHandler('seekto', (details) => {
      const audio = audioRef.current;
      if (!audio) return;
      const seekTime = Number(details.seekTime);
      if (!Number.isFinite(seekTime)) return;
      const maxTime = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : seekTime;
      const target = Math.min(Math.max(0, seekTime), maxTime);
      if (details.fastSeek && typeof audio.fastSeek === 'function') {
        audio.fastSeek(target);
      } else {
        audio.currentTime = target;
      }
      setCurrentTime(target);
    });
  };

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

  const playerStore = useMemo<GlobalPlayerStore>(() => ({
    currentTrackId: currentlyPlayingTrackId,
    isPlaying,
    currentTime,
    duration,
    setCurrentTrack,
    playCurrentTrack,
    pauseCurrentTrack,
    toggleTrackPlayback,
    seekTo
  }), [
    currentlyPlayingTrackId,
    isPlaying,
    currentTime,
    duration,
    setCurrentTrack,
    playCurrentTrack,
    pauseCurrentTrack,
    toggleTrackPlayback,
    seekTo
  ]);

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
    <GlobalPlayerContext.Provider value={playerStore}>
      <div className={`${isPreview ? 'w-full h-full bg-slate-950 overflow-y-auto scrollbar-hide text-slate-100 flex flex-col' : 'relative w-full tap-full-height bg-slate-950 text-slate-100 flex flex-col'}`}>
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
            <TrackListRows
              displayTracks={displayTracks}
              projectArtistName={project.artistName || ''}
              coverSrc={coverSrc}
              resolveUrl={resolveUrl}
              canPlayTrack={canPlayTrack}
              onTrackPress={toggleTrackPlayback}
              isPreview={isPreview}
            />
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

        <GlobalNowPlayingBar
          isPreview={isPreview}
          audioElementKey={audioElementKey}
          setAudioElementRef={setAudioElementRef}
          onAudioEnded={(event) => {
            clearStallRecoveryTimer();
            activeTrackRef.current = null;
            manualPauseRef.current = false;
            lastTimeUpdateLogSecondRef.current = -1;
            setIsPlaying(false);
            setCurrentlyPlayingTrackId(null);
            setCurrentTime(0);
            logAudioEvent('ended', event.currentTarget);
          }}
          onAudioPlay={(event) => {
            manualPauseRef.current = false;
            clearStallRecoveryTimer();
            setPlaybackError(null);
            setIsPlaying(true);
            setMediaSession(toMediaSessionTrack(activeTrackRef.current));
            logAudioEvent('play', event.currentTarget, { reason: 'audio-event' });
          }}
          onAudioPause={(event) => {
            setIsPlaying(false);
            setMediaSession(toMediaSessionTrack(activeTrackRef.current));
            logAudioEvent('pause', event.currentTarget, { reason: manualPauseRef.current ? 'user-pause' : 'audio-event' });
          }}
          onAudioStalled={(event) => {
            logAudioEvent('stalled', event.currentTarget);
            startStallRecovery('stalled');
          }}
          onAudioWaiting={(event) => {
            logAudioEvent('waiting', event.currentTarget);
            startStallRecovery('waiting');
          }}
          onAudioError={(event) => {
            const code = event.currentTarget.error?.code || 0;
            const failingTrack = activeTrackRef.current;
            const failingUrl = String(event.currentTarget.currentSrc || event.currentTarget.src || '').trim();
            const noSourceLikeError = code === 4 || (
              typeof HTMLMediaElement !== 'undefined' &&
              event.currentTarget.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
            );
            console.error('[AUDIO] audio.onerror', {
              projectId: project.projectId,
              trackId: failingTrack?.trackId || null,
              code: code || null,
              finalCurrentSrc: String(event.currentTarget.currentSrc || '').trim() || null,
              currentSrc: String(event.currentTarget.currentSrc || '').trim() || null,
              src: String(event.currentTarget.src || '').trim() || null,
              attrSrc: String(event.currentTarget.getAttribute('src') || '').trim() || null,
              readyState: event.currentTarget.readyState,
              networkState: event.currentTarget.networkState,
              paused: event.currentTarget.paused
            });
            if (failingTrack && failingUrl && noSourceLikeError) {
              const rebuildSignature = `${failingTrack.trackId}:${normalizeRuntimeAudioUrl(failingUrl)}:${code || 0}`;
              if (lastOnErrorRebuildSignatureRef.current !== rebuildSignature) {
                lastOnErrorRebuildSignatureRef.current = rebuildSignature;
                void probeTrackCorsHeadSupport(failingUrl, failingTrack, 'audio-error')
                  .then((headResult) => {
                    const info = getRuntimeUrlInfo(failingUrl);
                    const missingRangeHeader = headResult.ok && !headResult.rangeHeaderPresent;
                    const suspiciousMimeType = headResult.ok && Boolean(headResult.contentType) &&
                      !/^audio\//i.test(headResult.contentType) &&
                      !/octet-stream/i.test(headResult.contentType);
                    if (
                      Boolean(info.origin) &&
                      !info.sameOrigin &&
                      (!headResult.ok || missingRangeHeader || suspiciousMimeType)
                    ) {
                      markNoCorsFallbackForUrl(failingUrl, failingTrack, 'audio-error-cors-head-incompatible', {
                        status: headResult.status,
                        headError: headResult.error || null,
                        acceptRanges: headResult.acceptRanges || null,
                        contentType: headResult.contentType || null,
                        code
                      });
                      setPlaybackError('Host missing CORS/Range headers');
                    }
                    return rebuildAudioElement('audio.onerror-no-source', {
                      track: failingTrack,
                      sourceUrl: failingUrl
                    });
                  })
                  .then((rebuiltAudio) => attachAudioSourceWithFallback(rebuiltAudio, failingUrl, failingTrack, 'error-rebuild'))
                  .then(() => {
                    console.warn('[AUDIO] audio.onerror rebuild fallback attached source', {
                      projectId: project.projectId,
                      trackId: failingTrack.trackId,
                      code,
                      url: failingUrl
                    });
                  })
                  .catch((fallbackError: any) => {
                    console.error('[AUDIO] audio.onerror rebuild fallback failed', {
                      projectId: project.projectId,
                      trackId: failingTrack.trackId,
                      code,
                      url: failingUrl,
                      error: String(fallbackError?.message || fallbackError || 'fallback failed')
                    });
                  });
              }
            }
            if (failingTrack && failingUrl) {
              void probeTrackCorsHeadSupport(failingUrl, failingTrack, 'audio-error').then((headResult) => {
                if (headResult.ok) return;
                console.warn('[AUDIO] audio-element cors HEAD failed', {
                  projectId: project.projectId,
                  trackId: failingTrack.trackId,
                  url: failingUrl,
                  status: headResult.status ?? null,
                  error: headResult.error || 'HEAD failed'
                });
              });
              void probeTrackAudioUrl(failingUrl, failingTrack, 'audio-error').then((probeResult) => {
                if (probeResult.ok) return;
                console.warn('[AUDIO] audio-element source failed', {
                  projectId: project.projectId,
                  trackId: failingTrack.trackId,
                  storageBucket: String(failingTrack.storageBucket || '').trim() || null,
                  storagePath: String(failingTrack.audioPath || failingTrack.storagePath || '').trim() || null,
                  status: probeResult.status ?? (probeResult.failureType === 'cors' ? 'CORS' : 'NETWORK'),
                  failureType: probeResult.failureType || 'http',
                  url: failingUrl,
                  error: probeResult.error || probeResult.message
                });
              });
            }
            logAudioEvent('error', event.currentTarget, { reason: 'audio-element-error', code });
            if (code === 4 && (isNoCorsFallbackEnabledForUrl(failingUrl) || noSourceLikeError)) {
              setPlaybackError('Host missing CORS/Range headers');
            } else {
              setPlaybackError(`Playback error (code ${code || 'unknown'})`);
            }
            startStallRecovery('error');
          }}
          onAudioTimeUpdate={(event) => {
            const next = Number(event.currentTarget.currentTime);
            const normalized = Number.isFinite(next) ? next : 0;
            setCurrentTime(normalized);
            const wholeSeconds = Math.floor(normalized);
            if (wholeSeconds !== lastTimeUpdateLogSecondRef.current) {
              lastTimeUpdateLogSecondRef.current = wholeSeconds;
              logAudioEvent('timeupdate', event.currentTarget);
            }
          }}
          onAudioLoadedMetadata={(event) => {
            const next = Number(event.currentTarget.duration);
            setDuration(Number.isFinite(next) ? next : 0);
            setMediaSession(toMediaSessionTrack(activeTrackRef.current));
            logAudioEvent('loadedmetadata', event.currentTarget);
          }}
          onAudioDurationChange={(event) => {
            const next = Number(event.currentTarget.duration);
            setDuration(Number.isFinite(next) ? next : 0);
            logAudioEvent('durationchange', event.currentTarget);
          }}
        />
      </div>
    </GlobalPlayerContext.Provider>
  );
};

export default memo(TAPRenderer);



