import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Track } from '../types';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseAuthClient } from './supabaseAuth';

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

export type SignedTrackUrlCache = Record<
  string,
  { url: string; expiresAt: number; storagePath: string }
>;

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

export const extractTrackStoragePath = (track: Track): string => {
  const explicit = String(track.storagePath || '').trim();
  if (explicit) return explicit;

  const raw = String(track.mp3Url || '').trim();
  if (raw.startsWith(ASSET_REF_PREFIX)) {
    return raw.slice(ASSET_REF_PREFIX.length);
  }
  return '';
};

const resolveSignedUrlTtl = (value: number | undefined): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SIGNED_URL_TTL_SECONDS;
  return Math.max(60, Math.floor(numeric));
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
  const storagePath = extractTrackStoragePath(track);
  if (!storagePath) {
    return { url: String(track.mp3Url || '').trim(), expiresAt: 0, storagePath: '' };
  }

  const bucket = String(storage.bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
  const isPublic = storage.isPublic === true;
  const ttlSeconds = resolveSignedUrlTtl(storage.signedUrlTtl);
  const cacheKey = String(track.trackId || '').trim() || storagePath;

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
