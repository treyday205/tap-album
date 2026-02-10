
import React, { useEffect, useState, useRef } from 'react';
import { Music2, Instagram, Twitter, Video, Facebook, Play, Pause } from 'lucide-react';
import { Project, Track, EventType } from '../types';
import { StorageService } from '../services/storage';
import TrackRow from './TrackRow';

interface TAPRendererProps {
  project: Project;
  tracks: Track[];
  isPreview?: boolean;
  showCover?: boolean;
  showMeta?: boolean;
  showAllTracks?: boolean;
  resolveAssetUrl?: (value: string) => string;
}

const formatTime = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

const TAPRenderer: React.FC<TAPRendererProps> = ({ project, tracks, isPreview = false, showCover = false, showMeta = false, showAllTracks = false, resolveAssetUrl }) => {
  const [currentlyPlayingTrackId, setCurrentlyPlayingTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const resolveUrl = (value: string) => {
    if (!value) return '';
    return resolveAssetUrl ? resolveAssetUrl(value) : value;
  };

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

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
    };
  }, []);

  const handleTogglePlay = (track: Track) => {
    if (!audioRef.current) return;

    const rawUrl = (track.mp3Url || '').trim();
    const url = resolveUrl(rawUrl);
    const isHttp = url.startsWith('http://') || url.startsWith('https://');
    const isRelative = url.startsWith('/');
    const isBlob = url.startsWith('blob:');
    const isPlayable = url.length > 5 && (
      url.startsWith('data:audio/') ||
      isBlob ||
      url.includes('p.scdn.co') ||
      ((isHttp || isRelative) && !url.includes('open.spotify.com'))
    );

    if (!isPlayable) return;

    const audio = audioRef.current;

    if (currentlyPlayingTrackId !== track.trackId) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio.src = url;
        audio.load();
        setCurrentTime(0);
        setDuration(0);

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setIsPlaying(true);
              setCurrentlyPlayingTrackId(track.trackId);
              if (!isPreview) StorageService.logEvent(project.projectId, EventType.TRACK_PLAY, track.title);
            })
            .catch(() => {
              setIsPlaying(false);
              setCurrentlyPlayingTrackId(null);
            });
        }
      } catch (err) {
        console.error('Audio engine error:', err);
      }
    } else if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
            if (!isPreview) StorageService.logEvent(project.projectId, EventType.TRACK_PLAY, track.title);
          })
          .catch(() => setIsPlaying(false));
      }
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (!Number.isFinite(next) || !audioRef.current) return;
    audioRef.current.currentTime = next;
    setCurrentTime(next);
  };

  const mp3Tracks = tracks.filter((track) => {
    const rawUrl = (track.mp3Url || '').trim();
    const resolvedUrl = resolveUrl(rawUrl);
    const normalizedRaw = rawUrl.toLowerCase();
    const normalizedResolved = resolvedUrl.toLowerCase();
    return (
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
        onEnded={() => {
          setIsPlaying(false);
          setCurrentlyPlayingTrackId(null);
          setCurrentTime(0);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => {
          const next = Number(event.currentTarget.currentTime);
          setCurrentTime(Number.isFinite(next) ? next : 0);
        }}
        onLoadedMetadata={(event) => {
          const next = Number(event.currentTarget.duration);
          setDuration(Number.isFinite(next) ? next : 0);
        }}
        onDurationChange={(event) => {
          const next = Number(event.currentTarget.duration);
          setDuration(Number.isFinite(next) ? next : 0);
        }}
        playsInline
        preload="metadata"
        className="hidden"
      />

      <div className={`${isPreview ? 'h-full overflow-y-auto scrollbar-hide' : 'flex-1 overflow-y-auto tap-native-scroll pb-44'}`}>
        {!isPreview && showMeta && (
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
        )}

        {showCover && (
          <div className={`${isPreview ? 'px-6 pt-8 pb-4' : 'px-4 pt-5 pb-4'} flex justify-center`}>
            <div className={`${isPreview ? 'max-w-[280px] rounded-[2.5rem]' : 'max-w-[360px] rounded-[2.1rem]'} relative aspect-square w-full shadow-[0_30px_70px_rgba(0,0,0,0.7)] overflow-hidden border border-white/10 ring-1 ring-white/5`}>
              {coverSrc ? (
                <img
                  src={coverSrc}
                  alt={project.title}
                  className="w-full h-full object-cover"
                  loading={isPreview ? 'lazy' : 'eager'}
                  fetchPriority={isPreview ? 'auto' : 'high'}
                  decoding="async"
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
            {displayTracks.map((track, index) => (
              <TrackRow
                key={track.trackId}
                track={track}
                artworkUrl={resolveUrl(track.artworkUrl || '') || coverSrc}
                subtext={project.artistName || ''}
                trackNumber={index + 1}
                audioUrl={resolveUrl(track.mp3Url || '')}
                isPlaying={isPlaying && currentlyPlayingTrackId === track.trackId}
                isActive={currentlyPlayingTrackId === track.trackId}
                onTogglePlay={handleTogglePlay}
                isPreview={isPreview}
              />
            ))}
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

export default TAPRenderer;
