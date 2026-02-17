import React, { memo } from 'react';
import { Project, Track } from '../../types';
import TAPRenderer from '../TAPRenderer';

type EditorDevicePreviewProps = {
  project: Project;
  tracks: Track[];
  resolveAssetUrl: (value: string) => string;
};

const EditorDevicePreview: React.FC<EditorDevicePreviewProps> = ({ project, tracks, resolveAssetUrl }) => {
  return (
    <div className="relative flex flex-col w-full lg:w-[440px] px-4 py-8 lg:p-10 items-center justify-center lg:sticky lg:top-0 lg:h-[calc(100vh-73px)] bg-[radial-gradient(ellipse_at_top,_rgba(34,197,94,0.12),_transparent_55%)] overflow-hidden border-t border-slate-800/60 lg:border-t-0">
      <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-72 h-72 bg-green-500/10 blur-3xl rounded-full"></div>
      <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 w-72 h-20 bg-white/5 blur-2xl rounded-full"></div>
      <div className="mb-6 text-[10px] uppercase tracking-[0.4em] font-black text-slate-600">Device Preview</div>
      <div className="relative w-[268px] h-[540px] lg:w-[300px] lg:h-[600px] bg-slate-950/95 rounded-[44px] lg:rounded-[50px] border-[8px] border-slate-800/80 shadow-[0_40px_90px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col lg:scale-105 ring-1 ring-slate-800/60">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-5 bg-slate-800/90 rounded-b-2xl z-40"></div>
        <div className="absolute top-6 left-1/2 -translate-x-1/2 w-16 h-1 bg-slate-800/70 rounded-full"></div>
        <div className="flex-1 overflow-hidden">
          <TAPRenderer project={project} tracks={tracks} isPreview={true} showCover={true} resolveAssetUrl={resolveAssetUrl} />
        </div>
      </div>
    </div>
  );
};

export default memo(EditorDevicePreview);
