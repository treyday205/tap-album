import React, { useEffect, useMemo, useState } from 'react';
import { Eye, ImageOff, Settings, ShieldCheck, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Project } from '../types';

type CoverStatus = 'loading' | 'ready' | 'missing';

type AlbumCardProps = {
  project: Project;
  coverSrc: string;
  hasCoverReference: boolean;
  onRetryCoverUrl?: (project: Project) => Promise<string | null> | string | null;
  onDelete: (id: string, e: React.MouseEvent) => void;
};

const AlbumCard: React.FC<AlbumCardProps> = ({
  project,
  coverSrc,
  hasCoverReference,
  onRetryCoverUrl,
  onDelete
}) => {
  const [coverStatus, setCoverStatus] = useState<CoverStatus>(
    hasCoverReference ? 'loading' : 'missing'
  );
  const [retryAttempted, setRetryAttempted] = useState(false);
  const [retrySrc, setRetrySrc] = useState('');

  const effectiveSrc = useMemo(() => {
    const retry = String(retrySrc || '').trim();
    if (retry) return retry;
    return String(coverSrc || '').trim();
  }, [coverSrc, retrySrc]);

  useEffect(() => {
    setRetryAttempted(false);
    setRetrySrc('');
    setCoverStatus(hasCoverReference ? 'loading' : 'missing');
  }, [project.projectId, project.coverImageUrl, hasCoverReference]);

  useEffect(() => {
    if (!hasCoverReference) {
      setCoverStatus('missing');
      return;
    }
    if (effectiveSrc && coverStatus !== 'ready') {
      setCoverStatus('loading');
    }
  }, [hasCoverReference, effectiveSrc, coverStatus]);

  const handleImageLoad = () => {
    setCoverStatus('ready');
  };

  const handleImageError = async () => {
    if (!hasCoverReference) {
      setCoverStatus('missing');
      return;
    }
    if (!retryAttempted && onRetryCoverUrl) {
      setRetryAttempted(true);
      try {
        const nextSrc = await onRetryCoverUrl(project);
        const normalized = String(nextSrc || '').trim();
        if (normalized) {
          setRetrySrc(normalized);
          setCoverStatus('loading');
          return;
        }
      } catch {
        // keep loading skeleton when a cover reference exists
      }
    }
    setCoverStatus('loading');
  };

  return (
    <div className="group relative bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 hover:border-slate-700 transition-all">
      <div className="aspect-square w-full relative overflow-hidden">
        {coverStatus === 'missing' && (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center text-slate-500">
            <ImageOff size={30} />
            <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-600">No Cover</p>
          </div>
        )}
        {hasCoverReference && effectiveSrc && (
          <img
            src={effectiveSrc}
            alt={project.title}
            onLoad={handleImageLoad}
            onError={handleImageError}
            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${
              coverStatus === 'ready' ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        {coverStatus === 'loading' && (
          <div className="absolute inset-0 overflow-hidden bg-slate-800/80 animate-pulse">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-700/20 via-slate-600/30 to-slate-700/20" />
          </div>
        )}
        <div className="absolute top-4 right-4 flex gap-2">
          <span className="text-[10px] font-black bg-black/80 text-green-500 px-2 py-1 rounded border border-green-500/20 backdrop-blur-sm uppercase">Secure Link</span>
          <span className={`text-[10px] font-black px-2 py-1 rounded border uppercase ${
            project.published ? 'bg-green-500 text-black border-green-500' : 'bg-slate-800 text-slate-300 border-slate-700'
          }`}>
            {project.published ? 'Live' : 'Draft'}
          </span>
        </div>
      </div>

      <div className="p-6">
        <h3 className="text-xl font-bold mb-1 truncate text-white">{project.title}</h3>
        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-6 flex items-center gap-1 opacity-50">
          <ShieldCheck size={10} />
          ID: {project.slug}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Link
            to={`/dashboard/edit/${project.projectId}`}
            className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 rounded-xl transition-colors"
          >
            <Settings size={14} />
            Manage
          </Link>
          <Link
            to={`/${project.slug}`}
            target="_blank"
            className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 rounded-xl transition-colors"
          >
            <Eye size={14} />
            Preview
          </Link>
          <button
            onClick={(e) => onDelete(project.projectId, e)}
            className="col-span-2 flex items-center justify-center gap-2 bg-slate-900/60 hover:bg-red-500/10 text-red-400 text-xs font-bold py-2.5 rounded-xl transition-colors border border-red-500/20"
          >
            <Trash2 size={14} />
            Delete Album
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlbumCard;
