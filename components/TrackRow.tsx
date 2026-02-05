
import React from 'react';
import { Play, Pause } from 'lucide-react';
import { Track } from '../types';

interface TrackRowProps {
  track: Track;
  artworkUrl?: string;
  trackNumber?: number;
  subtext?: string;
  audioUrl?: string;
  isPlaying: boolean;
  isActive: boolean;
  onTogglePlay: (track: Track) => void;
  isPreview?: boolean;
}

const TrackRow: React.FC<TrackRowProps> = ({ track, artworkUrl = '', trackNumber, subtext = '', audioUrl = '', isPlaying, isActive, onTogglePlay, isPreview = false }) => {
  const url = (audioUrl || "").trim();
  const artworkSrc = (artworkUrl || "").trim();
  
  const isDirectAudio = url.length > 5 && (
    url.startsWith('data:audio/') ||
    url.startsWith('blob:') ||
    url.includes('p.scdn.co') ||
    url.includes('.mp3') ||
    url.includes('.wav') ||
    url.includes('.m4a') ||
    url.includes('.aac') ||
    url.includes('.ogg') ||
    url.includes('.flac') ||
    ((url.startsWith('http') || url.startsWith('/')) && !url.includes('open.spotify.com'))
  );

  const previewIdleClass = 'bg-slate-900/30 border border-slate-800/70 hover:bg-slate-900/55';
  const idleClass = 'hover:bg-slate-900/60 border border-transparent';
  const activeClass = 'bg-slate-900/80 border border-slate-700';

  const handleRowClick = () => {
    if (!isDirectAudio) return;
    onTogglePlay(track);
  };

  const showNumber = typeof trackNumber === 'number' && !isPreview;
  const playVisibilityClass = 'opacity-100 pointer-events-auto';

  return (
    <div 
      className={`group flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 cursor-pointer min-w-0 ${
        isActive ? activeClass : (isPreview ? previewIdleClass : idleClass)
      }`}
      onClick={handleRowClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleRowClick();
        }
      }}
    >
      {showNumber && (
        <div className="w-6 text-center flex-shrink-0 relative">
          <span className={`text-xs font-bold text-slate-500 group-hover:opacity-0 ${isActive ? 'text-green-400' : ''}`}>
            {trackNumber}
          </span>
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 text-slate-300">
            <Play size={14} />
          </span>
        </div>
      )}
      <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-800 border border-slate-700 flex-shrink-0">
        {artworkSrc ? (
          <img src={artworkSrc} alt={`${track.title} artwork`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-slate-800" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3
          title={track.title}
          className={`track-title font-bold text-sm sm:text-base transition-colors ${isActive ? 'text-green-400' : 'text-slate-100'}`}
        >
          {track.title}
        </h3>
        {subtext ? (
          <p
            className="text-[11px] text-slate-500 font-semibold uppercase tracking-widest whitespace-nowrap overflow-hidden text-ellipsis"
            title={subtext}
          >
            {subtext}
          </p>
        ) : null}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isDirectAudio) onTogglePlay(track);
          }}
          disabled={!isDirectAudio}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${playVisibilityClass} ${
            !isDirectAudio 
              ? 'bg-slate-800 text-slate-600 cursor-not-allowed opacity-40' 
              : 'bg-green-500 hover:scale-105 active:scale-95 text-black shadow-lg shadow-green-500/20'
          }`}
          aria-label={isActive && isPlaying ? "Pause" : "Play"}
        >
          {isActive && isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} className="ml-0.5" fill="currentColor" />}
        </button>
      </div>
    </div>
  );
};

export default TrackRow;
