import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DEFAULT_MOCK_ALBUM_SLUG,
  fetchAlbumBySlug,
  type AlbumPayload
} from '../services/albumData';
import { Api } from '../services/api';
import AlbumPlayerExperience from '../components/album/AlbumPlayerExperience';
import { getProjectAccessToken, normalizeProjectId } from '../services/albumAccessSession';

type PageState = 'loading' | 'ready' | 'not-found';

const toSecureEntryPath = (slug: string) => `/${encodeURIComponent(slug)}`;

const AlbumPlayerPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<AlbumPayload | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');

  useEffect(() => {
    const normalizedSlug = String(slug || '').trim();
    if (!normalizedSlug) {
      setPageState('not-found');
      setAlbum(null);
      return;
    }

    let cancelled = false;
    setPageState('loading');

    const run = async () => {
      try {
        const projectResponse = await Api.getProjectBySlug(normalizedSlug);
        if (cancelled) return;

        const gateEnabled = projectResponse?.project?.emailGateEnabled ?? true;
        if (gateEnabled) {
          const projectId = normalizeProjectId(projectResponse?.project?.projectId);
          const token = getProjectAccessToken(projectId);
          if (!projectId || !token) {
            navigate(toSecureEntryPath(normalizedSlug), { replace: true });
            return;
          }
          try {
            const status = await Api.getAccessStatus(projectId, token);
            if (cancelled) return;
            if (!status?.verified) {
              navigate(toSecureEntryPath(normalizedSlug), { replace: true });
              return;
            }
          } catch {
            if (cancelled) return;
            navigate(toSecureEntryPath(normalizedSlug), { replace: true });
            return;
          }
        }

        const payload = await fetchAlbumBySlug(normalizedSlug);
        if (cancelled) return;
        setAlbum(payload);
        setPageState('ready');
      } catch (error) {
        console.warn('[ALBUM_ROUTE] album fetch failed', error);
        if (cancelled) return;
        setAlbum(null);
        setPageState('not-found');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  if (pageState === 'loading') {
    return (
      <div className="tap-full-height bg-slate-950 text-slate-50 flex items-center justify-center px-6">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-200">
          <Loader2 size={18} className="animate-spin text-emerald-300" />
          Loading album...
        </div>
      </div>
    );
  }

  if (!album || pageState === 'not-found') {
    return (
      <div className="tap-full-height bg-slate-950 text-slate-50 flex items-center justify-center px-6 text-center">
        <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900/70 p-7">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Album unavailable</p>
          <h1 className="mt-3 text-2xl font-black tracking-tight">We could not find that Tap-Album.</h1>
          <p className="mt-3 text-sm text-slate-300">
            Start with mock slug:
            <span className="ml-1 rounded bg-slate-800 px-2 py-1 text-emerald-300">/album/{DEFAULT_MOCK_ALBUM_SLUG}</span>
          </p>
        </div>
      </div>
    );
  }

  return <AlbumPlayerExperience album={album} />;
};

export default AlbumPlayerPage;
