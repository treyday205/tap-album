import { Track } from '../types';
import { parseSupabaseStorageObjectUrl } from './assets';

export type TrackStorageRecovery = {
  trackId: string;
  bucket: string;
  storagePath: string;
  trackUrl: string;
};

const getTrackUrlCandidates = (track: Track): string[] => {
  const candidates = [
    String(track.trackUrl || '').trim(),
    String(track.mp3Url || '').trim(),
    String(track.audioUrl || '').trim()
  ].filter(Boolean);
  return Array.from(new Set(candidates));
};

export const deriveTrackStorageRecovery = (track: Track): TrackStorageRecovery | null => {
  const trackId = String(track.trackId || '').trim();
  if (!trackId) return null;

  const hasStoragePath = String(track.audioPath || track.storagePath || '').trim().length > 0;
  if (hasStoragePath) return null;

  const candidates = getTrackUrlCandidates(track);
  for (const trackUrl of candidates) {
    const parsed = parseSupabaseStorageObjectUrl(trackUrl);
    if (!parsed?.storagePath) continue;
    return {
      trackId,
      bucket: parsed.bucket,
      storagePath: parsed.storagePath,
      trackUrl
    };
  }

  return null;
};

export const collectTrackStorageRecoveries = (tracks: Track[]): TrackStorageRecovery[] => {
  const recovered: TrackStorageRecovery[] = [];
  const seenTrackIds = new Set<string>();

  for (const track of tracks) {
    const next = deriveTrackStorageRecovery(track);
    if (!next) continue;
    if (seenTrackIds.has(next.trackId)) continue;
    seenTrackIds.add(next.trackId);
    recovered.push(next);
  }

  return recovered;
};

export const applyTrackStorageRecoveries = (
  tracks: Track[],
  recoveries: TrackStorageRecovery[]
): { tracks: Track[]; recoveredCount: number } => {
  if (!recoveries.length) {
    return { tracks, recoveredCount: 0 };
  }

  const recoveriesByTrackId = new Map(recoveries.map((item) => [item.trackId, item]));
  let recoveredCount = 0;
  const nextTracks = tracks.map((track) => {
    const trackId = String(track.trackId || '').trim();
    const recovery = recoveriesByTrackId.get(trackId);
    if (!recovery) return track;

    const hasStoragePath = String(track.audioPath || track.storagePath || '').trim().length > 0;
    if (hasStoragePath) return track;

    recoveredCount += 1;
    return {
      ...track,
      trackUrl: String(track.trackUrl || '').trim() || recovery.trackUrl,
      storageBucket: recovery.bucket,
      audioPath: recovery.storagePath,
      storagePath: recovery.storagePath
    };
  });

  return { tracks: nextTracks, recoveredCount };
};
