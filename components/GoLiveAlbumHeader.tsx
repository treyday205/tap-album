import React, { memo } from 'react';
import { Download } from 'lucide-react';

interface GoLiveAlbumHeaderProps {
  title: string;
  artist: string;
  trackCount: number;
  showInstallButton?: boolean;
  onInstallClick?: () => void;
}

const GoLiveAlbumHeader: React.FC<GoLiveAlbumHeaderProps> = ({
  title,
  artist,
  trackCount,
  showInstallButton = false,
  onInstallClick
}) => {
  const installButtonClass =
    'h-8 w-[132px] rounded-xl font-black text-[8px] uppercase tracking-[0.24em] flex items-center justify-center gap-1.5 transition-all bg-green-500 text-black shadow-xl shadow-green-500/20 active:scale-95 touch-manipulation ml-auto';

  return (
    <div className="sticky top-0 z-20 px-4 tap-safe-top pb-3 bg-gradient-to-b from-slate-950/95 via-slate-950/90 to-slate-950/70 backdrop-blur-xl border-b border-white/5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.35em] font-black text-slate-400/80 text-left">Now Streaming</p>
        {showInstallButton && onInstallClick && (
          <button type="button" onClick={onInstallClick} className={installButtonClass}>
            <Download size={12} />
            Install Album
          </button>
        )}
      </div>
      <div className="flex items-end justify-between mt-2 gap-3">
        <div className="min-w-0 flex-1 text-left">
          <h1 className="go-live-title text-[22px] sm:text-[26px] font-black tracking-tight truncate">{title}</h1>
          <p className="go-live-artist text-[11px] sm:text-[12px] font-black uppercase tracking-[0.32em] mt-2 truncate">{artist}</p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.28em] font-black text-slate-500 flex-shrink-0 pl-2">{trackCount} tracks</span>
      </div>
    </div>
  );
};

export default memo(GoLiveAlbumHeader);
