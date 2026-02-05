
import React, { useState, useRef, useEffect } from 'react';
import { Music2, Instagram, Twitter, Video, Facebook } from 'lucide-react';
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

const TAPRenderer: React.FC<TAPRendererProps> = ({ project, tracks, isPreview = false, showCover = false, showMeta = false, showAllTracks = false, resolveAssetUrl }) => {
  const [currentlyPlayingTrackId, setCurrentlyPlayingTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
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
        audioRef.current.src = "";
      }
    };
  }, []);

  const handleTogglePlay = (track: Track) => {
    if (!audioRef.current) return;
    
    const rawUrl = (track.mp3Url || "").trim();
    const url = resolveUrl(rawUrl);
    const isHttp = url.startsWith('http://') || url.startsWith('https://');
    const isRelative = url.startsWith('/');
    const isPlayable = url.length > 5 && (
      url.startsWith('data:audio/') || 
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
        console.error("Audio engine error:", err);
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

  const mp3Tracks = tracks.filter((track) => {
    const rawUrl = (track.mp3Url || "").trim();
    const resolvedUrl = resolveUrl(rawUrl);
    const normalized = (resolvedUrl || rawUrl).toLowerCase();
    return (
      isAudioAssetRef(rawUrl) ||
      normalized.startsWith('data:audio/mpeg') ||
      normalized.startsWith('data:audio/mp3') ||
      normalized.includes('p.scdn.co') ||
      normalized.includes('.mp3') ||
      normalized.includes('.wav') ||
      normalized.includes('.m4a') ||
      normalized.includes('.aac') ||
      normalized.includes('.ogg') ||
      normalized.includes('.flac')
    );
  });
  const displayTracks = showAllTracks ? tracks : mp3Tracks;

  const listWrapperClass = isPreview ? 'px-0 pb-10' : 'px-6 py-8';
  const listClass = isPreview
    ? 'space-y-3 bg-slate-900/40 border border-slate-800/70 rounded-none p-3 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur'
    : 'space-y-3';

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
  const coverSrc = resolvedCover || 'https://picsum.photos/600/600?grayscale';

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
    { key: 'instagramUrl', provider: 'instagram', label: 'Instagram', icon: <Instagram size={16} />, color: 'text-pink-400' },
    { key: 'twitterUrl', provider: 'twitter', label: 'X', icon: <Twitter size={16} />, color: 'text-blue-400' },
    { key: 'tiktokUrl', provider: 'tiktok', label: 'TikTok', icon: <Music2 size={16} />, color: 'text-white' },
    { key: 'youtubeUrl', provider: 'youtube', label: 'YouTube', icon: <Video size={16} />, color: 'text-red-500' },
    { key: 'facebookUrl', provider: 'facebook', label: 'Facebook', icon: <Facebook size={16} />, color: 'text-blue-500' }
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
    <div className={`w-full h-full bg-slate-950 overflow-y-auto ${isPreview ? 'scrollbar-hide' : ''} text-slate-100 flex flex-col`}>
      <audio 
        ref={audioRef} 
        onEnded={() => {
          setIsPlaying(false);
          setCurrentlyPlayingTrackId(null);
        }}
        playsInline
        preload="auto"
        className="hidden" 
      />

      {showCover && (
        <div className="px-6 pt-8 pb-4 flex justify-center">
          <div className="relative aspect-square w-full max-w-[280px] shadow-[0_30px_70px_rgba(0,0,0,0.7)] rounded-[2.5rem] overflow-hidden border border-white/10 ring-1 ring-white/5">
            <img 
              src={coverSrc}
              alt={project.title}
              className="w-full h-full object-cover"
            />
            {isPreview && (
              <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/35"></div>
            )}
          </div>
        </div>
      )}

      {showMeta && (
        <div className="px-6 pb-4 text-center">
          <h1 className="text-2xl font-black tracking-tight text-white">{project.title}</h1>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-green-400 mt-2">{project.artistName}</p>
        </div>
      )}

      {socialBadges.length > 0 && (
        <div className="px-6 pb-4">
          <div className="flex items-center justify-center gap-3">
            {socialBadges.map((badge) => (
              <a
                key={badge.label}
                href={badge.url}
                target="_blank"
                rel="noreferrer"
                aria-label={badge.label}
                className={`w-9 h-9 rounded-full border border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 transition-colors flex items-center justify-center ${badge.color}`}
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
            <div className="py-12 text-center bg-slate-900/10 rounded-[2.5rem] border border-dashed border-slate-900">
               <Music2 size={32} className="mx-auto text-slate-800 mb-3" />
               <p className="text-slate-600 text-[10px] uppercase font-bold tracking-widest">No Tracks</p>
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
                  className="w-full py-3 rounded-2xl font-black text-xs uppercase tracking-[0.3em] flex items-center justify-center transition-all bg-green-500 text-black shadow-xl shadow-green-500/20 hover:bg-green-400 active:scale-95"
                >
                  Tickets
                </a>
              )}
              {merchUrl && (
                <a
                  href={merchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-3 rounded-2xl font-black text-xs uppercase tracking-[0.3em] flex items-center justify-center transition-all bg-green-500 text-black shadow-xl shadow-green-500/20 hover:bg-green-400 active:scale-95"
                >
                  Merch
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TAPRenderer;
