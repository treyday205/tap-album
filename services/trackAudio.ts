import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Track } from '../types';
import {
  SUPABASE_ANON_KEY,
  SUPABASE_BUCKET_PUBLIC,
  SUPABASE_STORAGE_BUCKET,
  SUPABASE_URL,
  supabaseAuthClient
} from './supabaseAuth';
import { parseSupabaseStorageObjectUrl } from './assets';

const ASSET_REF_PREFIX = 'asset:';
const DEFAULT_BUCKET = 'tap-album';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;
const SIGNED_URL_REFRESH_BUFFER_MS = 30 * 1000;
const SUPABASE_STORAGE_CONFIG_ERROR_CODE = 'SUPABASE_STORAGE_CONFIG_MISSING';
const GENERIC_PLAYBACK_CONFIG_ERROR =
  'Audio playback is temporarily unavailable. Please try again soon.';

export type TrackStorageConfig = {
  bucket?: string;
  isPublic: boolean;
  signedUrlTtl?: number;
};

export type TrackAudioResolveReason = 'manual' | 'probe' | 'stalled' | 'waiting' | 'error';

export type TrackAudioResolveOptions = {
  forceRefresh?: boolean;
  reason?: TrackAudioResolveReason;
};

export type TrackAudioUrlResolver = (
  track: Track,
  options?: TrackAudioResolveOptions
) => Promise<string>;

export type SignedTrackUrlCache = Record<
  string,
  { url: string; expiresAt: number; storagePath: string }
>;

type PlayerState = {
  isPlaying: boolean;
  currentTrackId: string | null;
};

type ResolvedAudioUrlSource = 'storage' | 'asset' | 'bank';

type CreateTrackAudioUrlResolverOptions = {
  storage: TrackStorageConfig;
  cache: SignedTrackUrlCache;
  resolveAssetUrl: (value: string) => string;
  resolveBankAssetUrls?: (refs: string[]) => Promise<Record<string, string>>;
  onBankAssetsResolved?: (resolved: Record<string, string>) => void;
  getPlayerState?: () => PlayerState;
  onResolvedUrl?: (payload: {
    track: Track;
    url: string;
    source: ResolvedAudioUrlSource;
    reason: TrackAudioResolveReason;
    storagePath: string;
    fromCache: boolean;
  }) => void;
};

type TrackAudioError = Error & { code?: string };

let fallbackStorageClient: SupabaseClient | null | undefined;

const createSupabaseStorageConfigError = (): TrackAudioError => {
  const error = new Error('Supabase storage client is not configured.') as TrackAudioError;
  error.code = SUPABASE_STORAGE_CONFIG_ERROR_CODE;
  return error;
};

export const isSupabaseStorageConfigError = (value: unknown): boolean => {
  const errorCode = String((value as { code?: string } | null)?.code || '').trim();
  if (errorCode === SUPABASE_STORAGE_CONFIG_ERROR_CODE) return true;
  const message = String((value as { message?: string } | null)?.message || '')
    .trim()
    .toLowerCase();
  return (
    message.includes('supabase storage client is not configured') ||
    message.includes('supabase storage is not configured')
  );
};

export const toSafeTrackPlaybackErrorMessage = (value: unknown): string => {
  if (isSupabaseStorageConfigError(value)) {
    return GENERIC_PLAYBACK_CONFIG_ERROR;
  }
  const message = String((value as { message?: string } | null)?.message || '').trim();
  return message || 'Unable to play this track right now.';
};

const getStorageClient = (): SupabaseClient | null => {
  if (supabaseAuthClient) {
    return supabaseAuthClient;
  }
  if (fallbackStorageClient !== undefined) {
    return fallbackStorageClient;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    fallbackStorageClient = null;
    return fallbackStorageClient;
  }
  fallbackStorageClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  return fallbackStorageClient;
};

const getTrackPreferredAudioValue = (track: Track): string => {
  const explicitAudioUrl = String(track.audioUrl || '').trim();
  if (explicitAudioUrl) return explicitAudioUrl;
  return String(track.mp3Url || '').trim();
};

const resolveTrackStorageTarget = (
  track: Track
): { storagePath: string; bucket: string } => {
  const explicitBucket = String(track.storageBucket || '').trim();

  const explicitAudioPath = String(track.audioPath || '').trim();
  if (explicitAudioPath) {
    return { storagePath: explicitAudioPath, bucket: explicitBucket };
  }

  const explicitStoragePath = String(track.storagePath || '').trim();
  if (explicitStoragePath) {
    return { storagePath: explicitStoragePath, bucket: explicitBucket };
  }

  const rawCandidates = [
    String(track.trackUrl || '').trim(),
    String(track.audioUrl || '').trim(),
    String(track.mp3Url || '').trim()
  ].filter(Boolean);

  for (const raw of rawCandidates) {
    if (raw.startsWith(ASSET_REF_PREFIX)) {
      return {
        storagePath: raw.slice(ASSET_REF_PREFIX.length),
        bucket: explicitBucket
      };
    }

    const parsedSupabase = parseSupabaseStorageObjectUrl(raw);
    if (parsedSupabase?.storagePath) {
      return {
        storagePath: parsedSupabase.storagePath,
        bucket: parsedSupabase.bucket || explicitBucket
      };
    }
  }

  return { storagePath: '', bucket: explicitBucket };
};

export const extractTrackStoragePath = (track: Track): string => {
  return resolveTrackStorageTarget(track).storagePath;
};

const resolveSignedUrlTtl = (value: number | undefined): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SIGNED_URL_TTL_SECONDS;
  return Math.max(60, Math.floor(numeric));
};

export const DEFAULT_TRACK_STORAGE: TrackStorageConfig = {
  bucket: SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET,
  isPublic: SUPABASE_BUCKET_PUBLIC === true,
  signedUrlTtl: DEFAULT_SIGNED_URL_TTL_SECONDS
};

export const normalizeTrackStorageConfig = (
  value: unknown,
  fallback: TrackStorageConfig = DEFAULT_TRACK_STORAGE
): TrackStorageConfig => {
  const source = (value || {}) as {
    bucket?: string;
    public?: boolean;
    isPublic?: boolean;
    signedUrlTtl?: number;
  };
  const bucket = String(source.bucket || fallback.bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
  const ttlValue = Number(source.signedUrlTtl);
  const isPublicValue =
    typeof source.public === 'boolean'
      ? source.public
      : typeof source.isPublic === 'boolean'
        ? source.isPublic
        : fallback.isPublic;

  return {
    bucket,
    isPublic: isPublicValue,
    signedUrlTtl: Number.isFinite(ttlValue)
      ? Math.max(60, Math.floor(ttlValue))
      : resolveSignedUrlTtl(fallback.signedUrlTtl)
  };
};

export const resolveRuntimeTrackAudioUrl = async ({
  track,
  storage,
  cache,
  forceRefresh = false
}: {
  track: Track;
  storage: TrackStorageConfig;
  cache: SignedTrackUrlCache;
  forceRefresh?: boolean;
}): Promise<{ url: string; expiresAt: number; storagePath: string }> => {
  const storageTarget = resolveTrackStorageTarget(track);
  const storagePath = storageTarget.storagePath;
  const preferredAudioUrl = getTrackPreferredAudioValue(track);
  if (!storagePath) {
    return { url: preferredAudioUrl, expiresAt: 0, storagePath: '' };
  }

  if (
    !forceRefresh &&
    preferredAudioUrl &&
    !preferredAudioUrl.startsWith(ASSET_REF_PREFIX) &&
    !preferredAudioUrl.toLowerCase().startsWith('bank:')
  ) {
    return { url: preferredAudioUrl, expiresAt: Number.MAX_SAFE_INTEGER, storagePath };
  }

  const configuredBucket = String(storage.bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
  const bucket = String(storageTarget.bucket || configuredBucket).trim() || configuredBucket;
  const isPublic = storage.isPublic === true;
  const ttlSeconds = resolveSignedUrlTtl(storage.signedUrlTtl);
  const cacheKey = String(track.trackId || '').trim() || `${bucket}/${storagePath}`;

  if (!isPublic && !forceRefresh) {
    const cached = cache[cacheKey];
    if (
      cached &&
      cached.storagePath === storagePath &&
      cached.expiresAt > Date.now() + SIGNED_URL_REFRESH_BUFFER_MS
    ) {
      return cached;
    }
  }

  const client = getStorageClient();
  if (!client) {
    throw createSupabaseStorageConfigError();
  }

  if (isPublic) {
    const { data } = client.storage.from(bucket).getPublicUrl(storagePath);
    const publicUrl = String(data?.publicUrl || '').trim();
    if (!publicUrl) {
      throw new Error('Could not build public audio URL.');
    }
    return { url: publicUrl, expiresAt: Number.MAX_SAFE_INTEGER, storagePath };
  }

  const { data, error } = await client
    .storage
    .from(bucket)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw error || new Error('Could not create signed audio URL.');
  }

  return {
    url: data.signedUrl,
    expiresAt: Date.now() + ttlSeconds * 1000,
    storagePath
  };
};

const isBankRef = (value: string): boolean => String(value || '').trim().toLowerCase().startsWith('bank:');

const resolveFallbackTrackAudioUrl = async ({
  track,
  resolveAssetUrl,
  resolveBankAssetUrls,
  onBankAssetsResolved
}: {
  track: Track;
  resolveAssetUrl: (value: string) => string;
  resolveBankAssetUrls?: (refs: string[]) => Promise<Record<string, string>>;
  onBankAssetsResolved?: (resolved: Record<string, string>) => void;
}): Promise<{ url: string; source: 'asset' | 'bank' }> => {
  const preferredValue = getTrackPreferredAudioValue(track);
  const fallback = String(resolveAssetUrl(preferredValue) || '').trim();
  if (fallback) {
    return { url: fallback, source: 'asset' };
  }

  const rawMp3Value = String(track.mp3Url || '').trim();
  const bankRef = [preferredValue, rawMp3Value].find((value) => isBankRef(value)) || '';
  if (bankRef && resolveBankAssetUrls) {
    const bankResolved = await resolveBankAssetUrls([bankRef]);
    const bankUrl = String(bankResolved[bankRef] || '').trim();
    if (bankUrl) {
      onBankAssetsResolved?.(bankResolved);
      return { url: bankUrl, source: 'bank' };
    }
    throw new Error('Track is local-only on this device. Upload to Supabase to publish.');
  }

  throw new Error('Track audio is missing.');
};

export const createTrackAudioUrlResolver = ({
  storage,
  cache,
  resolveAssetUrl,
  resolveBankAssetUrls,
  onBankAssetsResolved,
  getPlayerState,
  onResolvedUrl
}: CreateTrackAudioUrlResolverOptions): TrackAudioUrlResolver => {
  return async (track, options) => {
    const storagePath = extractTrackStoragePath(track);
    const trackId = String(track.trackId || '').trim();
    const cacheKey = trackId || storagePath;
    const reason = options?.reason || 'manual';
    const allowRefreshWhilePlaying = reason === 'stalled' || reason === 'waiting' || reason === 'error';
    const playerState = getPlayerState?.();
    const isCurrentTrackPlaying = Boolean(
      playerState?.isPlaying &&
      playerState?.currentTrackId &&
      playerState.currentTrackId === trackId
    );

    const finish = (url: string, source: ResolvedAudioUrlSource, fromCache = false): string => {
      onResolvedUrl?.({
        track,
        url,
        source,
        reason,
        storagePath,
        fromCache
      });
      return url;
    };

    if (!storagePath) {
      const fallback = await resolveFallbackTrackAudioUrl({
        track,
        resolveAssetUrl,
        resolveBankAssetUrls,
        onBankAssetsResolved
      });
      return finish(fallback.url, fallback.source);
    }

    if (isCurrentTrackPlaying && !allowRefreshWhilePlaying) {
      const cached = cache[cacheKey];
      if (cached?.url) {
        return finish(cached.url, 'storage', true);
      }
      const fallback = String(resolveAssetUrl(getTrackPreferredAudioValue(track)) || '').trim();
      if (fallback) {
        return finish(fallback, 'asset');
      }
    }

    try {
      const resolved = await resolveRuntimeTrackAudioUrl({
        track,
        storage,
        cache,
        forceRefresh: Boolean(options?.forceRefresh) && (!isCurrentTrackPlaying || allowRefreshWhilePlaying)
      });
      cache[cacheKey] = {
        url: resolved.url,
        expiresAt: resolved.expiresAt,
        storagePath: resolved.storagePath || storagePath
      };
      return finish(resolved.url, 'storage');
    } catch (error) {
      const fallback = String(resolveAssetUrl(getTrackPreferredAudioValue(track)) || '').trim();
      if (fallback) {
        return finish(fallback, 'asset');
      }
      if (isSupabaseStorageConfigError(error)) {
        throw new Error(GENERIC_PLAYBACK_CONFIG_ERROR);
      }
      throw error;
    }
  };
};
