import React, { memo, useEffect, useMemo, useState } from 'react';
import { Project, Track } from '../../types';
import { type AlbumPayload } from '../../services/albumData';
import { type TrackAudioResolveOptions } from '../../services/trackAudio';
import AlbumPlayerExperience from '../album/AlbumPlayerExperience';

type EditorDevicePreviewProps = {
  project: Project;
  tracks: Track[];
  resolveAssetUrl: (value: string) => string;
  resolveTrackAudioUrl?: (track: Track, options?: TrackAudioResolveOptions) => Promise<string>;
};

const asFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asOptionalString = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  return raw;
};

const resolveTrackAudioSync = (track: Track, resolveAssetUrl: (value: string) => string) => {
  const candidates = [
    String(track.audioUrl || '').trim(),
    String(track.trackUrl || '').trim(),
    String(track.mp3Url || '').trim()
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = String(resolveAssetUrl(candidate) || candidate).trim();
    if (resolved) return resolved;
  }
  return '';
};

const getProjectCoverUrl = (project: Project, resolveAssetUrl: (value: string) => string) => {
  const coverCandidates = [
    String(project.coverImageUrl || '').trim(),
    String(project.coverUrl || '').trim(),
    String(project.coverSignedUrl || '').trim(),
    String(project.coverRef || '').trim(),
    String(project.coverKey ? `asset:${project.coverKey}` : '').trim()
  ];
  for (const candidate of coverCandidates) {
    if (!candidate) continue;
    const resolved = String(resolveAssetUrl(candidate) || candidate).trim();
    if (resolved) return resolved;
  }
  return '';
};

const buildPreviewAlbumPayload = (
  project: Project,
  sortedTracks: Track[],
  resolveAssetUrl: (value: string) => string,
  resolvedTrackAudioById: Record<string, string>
): AlbumPayload => {
  const normalizedTracks = sortedTracks
    .map((track, index) => {
      const trackId = String(track.trackId || '').trim() || `track-${index + 1}`;
      const resolvedAudio = String(
        resolvedTrackAudioById[trackId] || resolveTrackAudioSync(track, resolveAssetUrl)
      ).trim();
      if (!resolvedAudio) return null;
      const duration = [
        (track as any)?.duration,
        (track as any)?.durationSec,
        (track as any)?.seconds,
        (track as any)?.length
      ]
        .map((entry) => Number(entry))
        .find((entry) => Number.isFinite(entry) && entry > 0);
      return {
        id: trackId,
        title: String(track.title || '').trim() || `Track ${index + 1}`,
        audioUrl: resolvedAudio,
        duration: Number.isFinite(duration) ? Number(duration) : undefined
      };
    })
    .filter(Boolean) as AlbumPayload['tracks'];

  return {
    slug: String(project.slug || '').trim() || `preview-${project.projectId}`,
    title: String(project.title || '').trim() || 'Untitled Album',
    artist: String(project.artistName || '').trim() || 'Unknown Artist',
    cover: getProjectCoverUrl(project, resolveAssetUrl),
    editionNumber: Math.max(1, asFiniteNumber((project as any).editionNumber, 1)),
    editionTotal: Math.max(1, asFiniteNumber((project as any).editionTotal, 1)),
    tracks: normalizedTracks,
    links: {
      merch: asOptionalString(project.merchUrl),
      tickets: asOptionalString(project.ticketsUrl),
      instagram: asOptionalString(project.instagramUrl),
      tiktok: asOptionalString(project.tiktokUrl),
      youtube: asOptionalString(project.youtubeUrl)
    },
    merchCards: [],
    ticketCards: []
  };
};

const sortTracks = (tracks: Track[]) => {
  const toOrderValue = (track: Track) => {
    const sortOrder = Number(track.sortOrder);
    if (Number.isFinite(sortOrder)) return sortOrder;
    const trackNo = Number(track.trackNo);
    if (Number.isFinite(trackNo)) return trackNo;
    return Number.MAX_SAFE_INTEGER;
  };

  return [...tracks].sort((a, b) => {
    const orderDelta = toOrderValue(a) - toOrderValue(b);
    if (orderDelta !== 0) return orderDelta;
    const aTitle = String(a.title || '').toLowerCase();
    const bTitle = String(b.title || '').toLowerCase();
    return aTitle.localeCompare(bTitle);
  });
};

const EditorDevicePreview: React.FC<EditorDevicePreviewProps> = ({
  project,
  tracks,
  resolveAssetUrl,
  resolveTrackAudioUrl
}) => {
  const [resolvedTrackAudioById, setResolvedTrackAudioById] = useState<Record<string, string>>({});

  const sortedTracks = useMemo(() => sortTracks(tracks), [tracks]);
  const audioSourceSignature = useMemo(() => {
    return sortedTracks
      .map((track) => {
        const trackId = String(track.trackId || '').trim();
        const audioPath = String(track.audioPath || track.storagePath || '').trim();
        const inlineAudio = String(track.audioUrl || track.trackUrl || track.mp3Url || '').trim();
        return `${trackId}|${audioPath}|${inlineAudio}`;
      })
      .join('||');
  }, [sortedTracks]);

  useEffect(() => {
    let cancelled = false;
    const nextUrls: Record<string, string> = {};
    const missingTracks: Track[] = [];

    sortedTracks.forEach((track) => {
      const trackId = String(track.trackId || '').trim();
      if (!trackId) return;
      const resolved = resolveTrackAudioSync(track, resolveAssetUrl);
      if (resolved) {
        nextUrls[trackId] = resolved;
      } else {
        missingTracks.push(track);
      }
    });

    setResolvedTrackAudioById(nextUrls);

    if (!resolveTrackAudioUrl || missingTracks.length === 0) return;

    const hydrateMissingAudio = async () => {
      const hydratedUrls = { ...nextUrls };
      for (const track of missingTracks) {
        const trackId = String(track.trackId || '').trim();
        if (!trackId) continue;
        try {
          const resolved = String(
            await resolveTrackAudioUrl(track, { reason: 'manual' })
          ).trim();
          if (!resolved) continue;
          hydratedUrls[trackId] = resolved;
        } catch {
          // Keep unresolved if resolver fails.
        }
      }
      if (cancelled) return;
      setResolvedTrackAudioById(hydratedUrls);
    };

    void hydrateMissingAudio();
    return () => {
      cancelled = true;
    };
  }, [audioSourceSignature, resolveAssetUrl, resolveTrackAudioUrl, sortedTracks]);

  const previewAlbum = useMemo(
    () =>
      buildPreviewAlbumPayload(project, sortedTracks, resolveAssetUrl, resolvedTrackAudioById),
    [project, sortedTracks, resolveAssetUrl, resolvedTrackAudioById]
  );

  const previewShareUrl = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const slug = String(project.slug || '').trim();
    if (!slug) return undefined;
    return `${window.location.origin}/album/${encodeURIComponent(slug)}`;
  }, [project.slug]);

  return (
    <div className="relative flex flex-col w-full lg:w-[440px] px-4 py-8 lg:p-10 items-center justify-center lg:sticky lg:top-0 lg:h-[calc(100vh-73px)] bg-[radial-gradient(ellipse_at_top,_rgba(34,197,94,0.12),_transparent_55%)] overflow-hidden border-t border-slate-800/60 lg:border-t-0">
      <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-72 h-72 bg-green-500/10 blur-3xl rounded-full" />
      <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 w-72 h-20 bg-white/5 blur-2xl rounded-full" />
      <div className="mb-6 text-[10px] uppercase tracking-[0.4em] font-black text-slate-600">Device Preview</div>
      <div className="relative w-[268px] h-[540px] lg:w-[300px] lg:h-[600px] bg-slate-950/95 rounded-[44px] lg:rounded-[50px] border-[8px] border-slate-800/80 shadow-[0_40px_90px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col lg:scale-105 ring-1 ring-slate-800/60">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-5 bg-slate-800/90 rounded-b-2xl z-40" />
        <div className="absolute top-6 left-1/2 -translate-x-1/2 w-16 h-1 bg-slate-800/70 rounded-full" />
        <div className="flex-1 overflow-hidden">
          <AlbumPlayerExperience
            album={previewAlbum}
            isEmbeddedPreview={true}
            shareUrl={previewShareUrl}
          />
        </div>
      </div>
    </div>
  );
};

export default memo(EditorDevicePreview);
