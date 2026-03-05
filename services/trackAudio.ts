import { Track } from '../types';

const ASSET_REF_PREFIX = 'asset:';
const DEFAULT_BUCKET = 'tap-album';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 900;
const SIGNED_URL_REFRESH_BUFFER_MS = 30 * 1000;
const TRACK_AUDIO_CONFIG_ERROR_CODE = 'TRACK_AUDIO_CONFIG_MISSING';
const GENERIC_PLAYBACK_CONFIG_ERROR =
  'Audio playback is temporarily unavailable. Please try again soon.';

export type TrackStorageConfig = {
  provider?: string;
  bucket?: string | null;
  keyPrefix?: string | null;
  isPublic?: boolean;
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

export type StorageUrlResolveMode = 'signed-backend' | 'signed-cached' | 'signed-inline';

export type SignedTrackUrlCache = Record<
  string,
  {
    url: string;
    expiresAt: number;
    storagePath: string;
    storageBucket?: string;
    resolveMode?: StorageUrlResolveMode;
  }
>;

type PlayerState = {
  isPlaying: boolean;
  currentTrackId: string | null;
};

type ResolvedAudioUrlSource = 'storage' | 'asset' | 'bank';

export type ResolveSignedStorageUrlInput = {
  track: Track;
  bucket: string;
  storagePath: string;
  ttlSeconds: number;
  forceRefresh: boolean;
  reason: TrackAudioResolveReason;
};

export type ResolveSignedStorageUrlResult =
  | string
  | {
      url?: string;
      expiresAt?: number;
    }
  | null;

type CreateTrackAudioUrlResolverOptions = {
  storage: TrackStorageConfig;
  cache: SignedTrackUrlCache;
  resolveAssetUrl: (value: string) => string;
  resolveBankAssetUrls?: (refs: string[]) => Promise<Record<string, string>>;
  onBankAssetsResolved?: (resolved: Record<string, string>) => void;
  resolveSignedStorageUrl?: (
    input: ResolveSignedStorageUrlInput
  ) => Promise<ResolveSignedStorageUrlResult>;
  getPlayerState?: () => PlayerState;
  onResolvedUrl?: (payload: {
    track: Track;
    url: string;
    source: ResolvedAudioUrlSource;
    reason: TrackAudioResolveReason;
    storagePath: string;
    storageBucket: string;
    resolveMode?: StorageUrlResolveMode;
    fromCache: boolean;
  }) => void;
};

type TrackAudioError = Error & { code?: string };

const createTrackAudioConfigError = (): TrackAudioError => {
  const error = new Error('Track audio signing backend is not configured.') as TrackAudioError;
  error.code = TRACK_AUDIO_CONFIG_ERROR_CODE;
  return error;
};

const resolveSignedUrlTtl = (value: number | undefined): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SIGNED_URL_TTL_SECONDS;
  return Math.max(60, Math.floor(numeric));
};

const parseSignedUrlExpiresAt = (url: string): number => {
  const raw = String(url || '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return 0;
  try {
    const parsed = new URL(raw);
    const amzDate = String(parsed.searchParams.get('X-Amz-Date') || '').trim();
    const amzExpires = Number(parsed.searchParams.get('X-Amz-Expires'));
    if (amzDate && Number.isFinite(amzExpires)) {
      const year = Number(amzDate.slice(0, 4));
      const month = Number(amzDate.slice(4, 6));
      const day = Number(amzDate.slice(6, 8));
      const hour = Number(amzDate.slice(9, 11));
      const minute = Number(amzDate.slice(11, 13));
      const second = Number(amzDate.slice(13, 15));
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day) &&
        Number.isFinite(hour) &&
        Number.isFinite(minute) &&
        Number.isFinite(second)
      ) {
        const start = Date.UTC(year, month - 1, day, hour, minute, second);
        if (Number.isFinite(start)) {
          return start + Math.max(0, Math.floor(amzExpires)) * 1000;
        }
      }
    }
    const expiresParam = String(parsed.searchParams.get('Expires') || '').trim();
    if (expiresParam) {
      const numeric = Number(expiresParam);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 10_000_000_000 ? numeric : numeric * 1000;
      }
    }
  } catch {
    return 0;
  }
  return 0;
};

const parseTrackAudioExpiresAt = (track: Track): number => {
  const explicit = Number((track as any)?.audioUrlExpiresAt);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const fromAudioUrl = parseSignedUrlExpiresAt(String(track.audioUrl || '').trim());
  if (fromAudioUrl > 0) return fromAudioUrl;
  return parseSignedUrlExpiresAt(String(track.trackUrl || '').trim());
};

const isLikelyAssetKey = (value: string): boolean => {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (normalized.includes('..')) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  return /^[a-z0-9/_\-.]+$/i.test(normalized) && normalized.includes('/');
};

const getTrackPreferredAudioValue = (track: Track): string => {
  const explicitTrackUrl = String(track.trackUrl || '').trim();
  if (explicitTrackUrl) return explicitTrackUrl;
  const explicitAudioUrl = String(track.audioUrl || '').trim();
  if (explicitAudioUrl) return explicitAudioUrl;
  return String(track.mp3Url || '').trim();
};

const resolveTrackStorageTarget = (
  track: Track
): { storagePath: string; bucket: string } => {
  const explicitBucket = String(track.storageBucket || '').trim();

  const explicitAudioKey = String((track as any).audioKey || '').trim();
  if (explicitAudioKey && isLikelyAssetKey(explicitAudioKey)) {
    return { storagePath: explicitAudioKey, bucket: explicitBucket };
  }

  const explicitAudioPath = String(track.audioPath || '').trim();
  if (explicitAudioPath && isLikelyAssetKey(explicitAudioPath)) {
    return { storagePath: explicitAudioPath, bucket: explicitBucket };
  }

  const explicitStoragePath = String(track.storagePath || '').trim();
  if (explicitStoragePath && isLikelyAssetKey(explicitStoragePath)) {
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

    if (isLikelyAssetKey(raw)) {
      return {
        storagePath: raw,
        bucket: explicitBucket
      };
    }

  }

  return { storagePath: '', bucket: explicitBucket };
};

export const extractTrackStoragePath = (track: Track): string => {
  return resolveTrackStorageTarget(track).storagePath;
};

export const DEFAULT_TRACK_STORAGE: TrackStorageConfig = {
  provider: 'r2',
  bucket: DEFAULT_BUCKET,
  isPublic: false,
  signedUrlTtl: DEFAULT_SIGNED_URL_TTL_SECONDS
};

export const normalizeTrackStorageConfig = (
  value: unknown,
  fallback: TrackStorageConfig = DEFAULT_TRACK_STORAGE
): TrackStorageConfig => {
  const source = (value || {}) as {
    provider?: string;
    bucket?: string;
    keyPrefix?: string;
    signedUrlTtl?: number;
    public?: boolean;
    isPublic?: boolean;
  };
  const bucket = String(source.bucket || fallback.bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
  const provider = String(source.provider || fallback.provider || 'r2').trim() || 'r2';
  const ttlValue = Number(source.signedUrlTtl);
  const keyPrefix = String(source.keyPrefix || fallback.keyPrefix || '').trim() || null;

  return {
    provider,
    bucket,
    keyPrefix,
    isPublic: Boolean(source.public ?? source.isPublic ?? fallback.isPublic ?? false),
    signedUrlTtl: Number.isFinite(ttlValue)
      ? Math.max(60, Math.floor(ttlValue))
      : resolveSignedUrlTtl(fallback.signedUrlTtl)
  };
};

export const isSupabaseStorageConfigError = (value: unknown): boolean => {
  const code = String((value as { code?: string } | null)?.code || '').trim();
  if (code === TRACK_AUDIO_CONFIG_ERROR_CODE || code === 'SUPABASE_STORAGE_CONFIG_MISSING') {
    return true;
  }
  const message = String((value as { message?: string } | null)?.message || '')
    .trim()
    .toLowerCase();
  return (
    message.includes('track audio signing backend is not configured') ||
    message.includes('track audio is temporarily unavailable')
  );
};

export const toSafeTrackPlaybackErrorMessage = (value: unknown): string => {
  if (isSupabaseStorageConfigError(value)) {
    return GENERIC_PLAYBACK_CONFIG_ERROR;
  }
  const message = String((value as { message?: string } | null)?.message || '').trim();
  return message || 'Unable to play this track right now.';
};

export const resolveRuntimeTrackAudioUrl = async ({
  track,
  storage,
  cache,
  forceRefresh = false,
  reason = 'manual',
  resolveSignedStorageUrl
}: {
  track: Track;
  storage: TrackStorageConfig;
  cache: SignedTrackUrlCache;
  forceRefresh?: boolean;
  reason?: TrackAudioResolveReason;
  resolveSignedStorageUrl?: (
    input: ResolveSignedStorageUrlInput
  ) => Promise<ResolveSignedStorageUrlResult>;
}): Promise<{
  url: string;
  expiresAt: number;
  storagePath: string;
  storageBucket: string;
  resolveMode: StorageUrlResolveMode;
}> => {
  const storageTarget = resolveTrackStorageTarget(track);
  const storagePath = storageTarget.storagePath;
  const preferredAudioUrl = getTrackPreferredAudioValue(track);
  const fallbackExpiresAt = parseTrackAudioExpiresAt(track);
  if (!storagePath) {
    return {
      url: preferredAudioUrl,
      expiresAt: fallbackExpiresAt,
      storagePath: '',
      storageBucket: '',
      resolveMode: 'signed-inline'
    };
  }

  const configuredBucket = String(storage.bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
  const bucket = String(storageTarget.bucket || configuredBucket).trim() || configuredBucket;
  const ttlSeconds = resolveSignedUrlTtl(storage.signedUrlTtl);
  const cacheKey = String(track.trackId || '').trim() || `${bucket}/${storagePath}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = cache[cacheKey];
    if (
      cached &&
      cached.storagePath === storagePath &&
      cached.expiresAt > now + SIGNED_URL_REFRESH_BUFFER_MS
    ) {
      return {
        url: cached.url,
        expiresAt: cached.expiresAt,
        storagePath: cached.storagePath,
        storageBucket: cached.storageBucket || bucket,
        resolveMode: cached.resolveMode || 'signed-cached'
      };
    }

    const inTrackUrl = String(track.audioUrl || track.trackUrl || '').trim();
    const inTrackExpiresAt = parseTrackAudioExpiresAt(track);
    if (inTrackUrl && inTrackExpiresAt > now + SIGNED_URL_REFRESH_BUFFER_MS) {
      return {
        url: inTrackUrl,
        expiresAt: inTrackExpiresAt,
        storagePath,
        storageBucket: bucket,
        resolveMode: 'signed-inline'
      };
    }
  }

  if (resolveSignedStorageUrl) {
    const backendResolved = await resolveSignedStorageUrl({
      track,
      bucket,
      storagePath,
      ttlSeconds,
      forceRefresh,
      reason
    });
    const backendUrl = String(
      typeof backendResolved === 'string'
        ? backendResolved
        : backendResolved?.url || ''
    ).trim();
    if (backendUrl) {
      const backendExpiresAt = Number(
        typeof backendResolved === 'string' ? NaN : backendResolved?.expiresAt
      );
      const fallbackFromUrl = parseSignedUrlExpiresAt(backendUrl);
      return {
        url: backendUrl,
        expiresAt:
          (Number.isFinite(backendExpiresAt) && backendExpiresAt > now
            ? backendExpiresAt
            : fallbackFromUrl > now
              ? fallbackFromUrl
              : now + ttlSeconds * 1000),
        storagePath,
        storageBucket: bucket,
        resolveMode: 'signed-backend'
      };
    }
  }

  const inlineUrl = String(track.audioUrl || track.trackUrl || '').trim();
  if (inlineUrl) {
    const inlineExpiresAt = parseTrackAudioExpiresAt(track);
    return {
      url: inlineUrl,
      expiresAt: inlineExpiresAt || now + ttlSeconds * 1000,
      storagePath,
      storageBucket: bucket,
      resolveMode: 'signed-inline'
    };
  }

  throw createTrackAudioConfigError();
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
    throw new Error('Track is local-only on this device. Upload to R2 to publish.');
  }

  throw new Error('Track audio is missing.');
};

export const createTrackAudioUrlResolver = ({
  storage,
  cache,
  resolveAssetUrl,
  resolveBankAssetUrls,
  onBankAssetsResolved,
  resolveSignedStorageUrl,
  getPlayerState,
  onResolvedUrl
}: CreateTrackAudioUrlResolverOptions): TrackAudioUrlResolver => {
  return async (track, options) => {
    const storageTarget = resolveTrackStorageTarget(track);
    const storagePath = storageTarget.storagePath;
    const configuredBucket = String(storage.bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
    const storageBucket = String(storageTarget.bucket || configuredBucket).trim() || configuredBucket;
    const trackId = String(track.trackId || '').trim();
    const cacheKey = trackId || `${storageBucket}/${storagePath}`;
    const reason = options?.reason || 'manual';
    const allowRefreshWhilePlaying = reason === 'stalled' || reason === 'waiting' || reason === 'error';
    const playerState = getPlayerState?.();
    const isCurrentTrackPlaying = Boolean(
      playerState?.isPlaying &&
      playerState?.currentTrackId &&
      playerState.currentTrackId === trackId
    );

    const finish = (
      url: string,
      source: ResolvedAudioUrlSource,
      fromCache = false,
      resolveMode?: StorageUrlResolveMode
    ): string => {
      onResolvedUrl?.({
        track,
        url,
        source,
        reason,
        storagePath,
        storageBucket,
        resolveMode,
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
        return finish(cached.url, 'storage', true, cached.resolveMode);
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
        forceRefresh: Boolean(options?.forceRefresh) && (!isCurrentTrackPlaying || allowRefreshWhilePlaying),
        reason,
        resolveSignedStorageUrl
      });
      cache[cacheKey] = {
        url: resolved.url,
        expiresAt: resolved.expiresAt,
        storagePath: resolved.storagePath || storagePath,
        storageBucket: resolved.storageBucket || storageBucket,
        resolveMode: resolved.resolveMode
      };
      return finish(resolved.url, 'storage', false, resolved.resolveMode);
    } catch (error) {
      console.warn('[AUDIO] track audio resolution failed', {
        trackId: trackId || null,
        bucket: storageBucket || null,
        storagePath: storagePath || null,
        reason,
        forceRefresh: Boolean(options?.forceRefresh),
        error: String((error as { message?: string } | null)?.message || error || 'unknown')
      });
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
