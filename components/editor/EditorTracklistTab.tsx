import React, { memo } from 'react';
import { Plus, Upload, Image as ImageIcon, Loader2, Pause, Play, Sparkles, Download, CheckCircle2, Trash2 } from 'lucide-react';
import { Project, Track } from '../../types';
import { isAssetRef } from '../../services/assets';

type EditorTracklistTabProps = {
  project: Project;
  tracks: Track[];
  uploadPerTrackEnabled: boolean;
  uploadingTrackId: string | null;
  uploadProgress: Record<string, number>;
  previewingTrackId: string | null;
  isPlayingPreview: boolean;
  downloadingTrackId: string | null;
  downloadSuccessId: string | null;
  savingUrlTrackId: string | null;
  copiedUrlTrackId: string | null;
  resolvingTrackId: string | null;
  handleAddTrack: () => void;
  handleUpdateTrack: (trackId: string, updates: Partial<Track>) => void;
  triggerFileUpload: (type: 'PROJECT_IMAGE' | 'TRACK_IMAGE' | 'TRACK_AUDIO', trackId?: string) => void;
  togglePreview: (track: Track) => void;
  handleDownloadTrack: (track: Track) => void;
  handleSaveTrackUrl: (track: Track) => void;
  handleRemoveTrackAudio: (trackId: string) => void;
  handleMagicResolve: (track: Track) => void;
  handleDeleteTrack: (trackId: string) => void;
  resolveAsset: (value: string) => string;
};

const EditorTracklistTab: React.FC<EditorTracklistTabProps> = ({
  project,
  tracks,
  uploadPerTrackEnabled,
  uploadingTrackId,
  uploadProgress,
  previewingTrackId,
  isPlayingPreview,
  downloadingTrackId,
  downloadSuccessId,
  savingUrlTrackId,
  copiedUrlTrackId,
  resolvingTrackId,
  handleAddTrack,
  handleUpdateTrack,
  triggerFileUpload,
  togglePreview,
  handleDownloadTrack,
  handleSaveTrackUrl,
  handleRemoveTrackAudio,
  handleMagicResolve,
  handleDeleteTrack,
  resolveAsset
}) => {
  return (
    <div className="space-y-6 pb-24 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black">Tracklist</h2>
        <button onClick={handleAddTrack} className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black font-black py-2.5 px-6 rounded-full transition-all text-xs uppercase tracking-widest">
          <Plus size={16} strokeWidth={3} />
          Add New Song
        </button>
      </div>
      {tracks.map((track) => {
        const isUploading = uploadingTrackId === track.trackId;
        const uploadPercent = uploadProgress[track.trackId] ?? 0;
        const isSecureAudio = isAssetRef(track.mp3Url);
        const hasAudioPath = String(track.audioPath || '').trim().length > 0;
        const hasStoragePath = String(track.storagePath || '').trim().length > 0 || hasAudioPath;
        const isDataAudio = track.mp3Url.startsWith('data:');
        const isBankAudio = track.mp3Url.startsWith('bank:');
        const isLocalOnlyAudio = (isDataAudio || isBankAudio) && !hasStoragePath;
        const hasAudioSource = Boolean(
          String(track.mp3Url || '').trim() ||
          String(track.audioUrl || '').trim() ||
          hasStoragePath ||
          hasAudioPath
        );
        const isSavingUrl = savingUrlTrackId === track.trackId;
        const audioUrlValue = String(track.audioUrl || '').trim();
        const displayMp3Value = track.mp3Url.startsWith('data:')
          ? 'Local Audio File'
          : isBankAudio
            ? 'Local Audio File'
            : isSecureAudio
              ? 'Secure Audio File'
              : track.mp3Url;
        const hasTrackUpload = hasStoragePath || isSecureAudio;
        return (
          <div key={track.trackId} className="bg-slate-900/40 p-5 rounded-3xl border border-slate-800/50 flex gap-6 group hover:border-slate-700 transition-all">
            <div onClick={() => triggerFileUpload('TRACK_IMAGE', track.trackId)} className="w-20 h-20 bg-slate-800 rounded-2xl flex-shrink-0 cursor-pointer overflow-hidden border border-slate-700 relative group">
              <img
                src={resolveAsset(track.artworkUrl || '') || resolveAsset(project.coverImageUrl || '')}
                className="w-full h-full object-cover group-hover:opacity-40 transition-opacity"
                alt="Song Art"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ImageIcon size={20} className="text-white" />
              </div>
            </div>
            <div className="flex-grow space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input type="text" value={track.title} onChange={(e) => handleUpdateTrack(track.trackId, { title: e.target.value })} placeholder="Song Title" className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500" />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={displayMp3Value}
                    onChange={(e) => handleUpdateTrack(track.trackId, { mp3Url: e.target.value })}
                    disabled={track.mp3Url.startsWith('data:') || isBankAudio || isSecureAudio || isUploading}
                    placeholder="Audio URL or Spotify Link"
                    className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none"
                  />
                  {!uploadPerTrackEnabled && (
                    <button onClick={() => triggerFileUpload('TRACK_AUDIO', track.trackId)} disabled={isUploading} className={`p-2 rounded-xl transition-colors ${isUploading ? 'bg-slate-900 text-slate-600' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}>
                      {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                    </button>
                  )}
                </div>
              </div>
              {isUploading && (
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Uploading {uploadPercent}%
                </div>
              )}
              {isLocalOnlyAudio && (
                <div className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-300">
                  Local Only - Needs R2 Upload
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  {uploadPerTrackEnabled && (
                    <>
                      <button
                        onClick={() => triggerFileUpload('TRACK_AUDIO', track.trackId)}
                        disabled={isUploading}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${isUploading ? 'bg-slate-900 text-slate-600' : 'bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'}`}
                      >
                        {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        {hasTrackUpload ? 'Replace MP3' : 'Upload MP3'}
                      </button>
                      {hasAudioSource && (
                        <button
                          onClick={() => handleRemoveTrackAudio(track.trackId)}
                          disabled={isUploading}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}
                  {hasAudioSource && (
                    <>
                      <button onClick={() => togglePreview(track)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${previewingTrackId === track.trackId && isPlayingPreview ? 'bg-red-500 text-white' : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'}`}>
                        {previewingTrackId === track.trackId && isPlayingPreview ? <Pause size={12} /> : <Play size={12} />}
                        {previewingTrackId === track.trackId && isPlayingPreview ? 'Stop' : 'Preview'}
                      </button>
                      <button 
                        onClick={() => handleDownloadTrack(track)} 
                        disabled={downloadingTrackId === track.trackId}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${downloadSuccessId === track.trackId ? 'bg-green-500/20 text-green-500' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                      >
                        {downloadingTrackId === track.trackId ? <Loader2 size={12} className="animate-spin" /> : downloadSuccessId === track.trackId ? <CheckCircle2 size={12} /> : <Download size={12} />}
                        {downloadSuccessId === track.trackId ? 'Saved' : 'Save MP3'}
                      </button>
                      <button
                        onClick={() => handleSaveTrackUrl(track)}
                        disabled={isSavingUrl || !hasAudioSource}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${copiedUrlTrackId === track.trackId ? 'bg-green-500/20 text-green-500' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                      >
                        {isSavingUrl ? <Loader2 size={12} className="animate-spin" /> : copiedUrlTrackId === track.trackId ? <CheckCircle2 size={12} /> : <Download size={12} />}
                        {isSavingUrl ? 'Saving...' : copiedUrlTrackId === track.trackId ? 'Copied' : 'Save URL'}
                      </button>
                    </>
                  )}
                  {!track.mp3Url.startsWith('data:') && !isSecureAudio && track.mp3Url && (
                    <button onClick={() => handleMagicResolve(track)} className="p-1.5 bg-slate-800 text-green-400 rounded-lg hover:bg-slate-700 transition-colors" title="Magic Resolve">
                      {resolvingTrackId === track.trackId ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    </button>
                  )}
                </div>
                <button onClick={() => handleDeleteTrack(track.trackId)} className="p-2 text-slate-700 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
              </div>
              {audioUrlValue && (
                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Track URL</p>
                  <input
                    type="text"
                    readOnly
                    value={audioUrlValue}
                    className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-[11px] text-slate-300 focus:outline-none"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default memo(EditorTracklistTab);
