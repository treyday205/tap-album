import { createClient } from '@supabase/supabase-js';

const normalizeUrl = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/g, '');
};

const readClientEnvValue = (key: string): string => {
  const importMetaValue = (import.meta as any)?.env?.[key];
  if (importMetaValue) return String(importMetaValue).trim();
  return '';
};

const firstClientEnv = (keys: string[]): string => {
  for (const key of keys) {
    const value = readClientEnvValue(key);
    if (value) return value;
  }
  return '';
};

const parseOptionalBoolean = (value: string): boolean | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
};

export const SUPABASE_URL = normalizeUrl(readClientEnvValue('VITE_SUPABASE_URL'));

export const SUPABASE_ANON_KEY = firstClientEnv([
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY'
]);

export const SUPABASE_STORAGE_BUCKET =
  firstClientEnv(['VITE_SUPABASE_STORAGE_BUCKET']) || 'tap-album';

export const SUPABASE_BUCKET_PUBLIC = parseOptionalBoolean(
  readClientEnvValue('VITE_SUPABASE_BUCKET_PUBLIC')
);

export const isSupabaseStorageConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const isSupabaseAuthEnabled = isSupabaseStorageConfigured;

export const supabaseAuthClient = isSupabaseAuthEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export const buildSupabaseEmailRedirectUrl = (slug?: string, projectId?: string): string => {
  if (typeof window === 'undefined') return '';
  const cleanedSlug = String(slug || '').trim();
  const basePath = cleanedSlug ? `/${encodeURIComponent(cleanedSlug)}` : window.location.pathname || '/';
  const url = new URL(basePath, window.location.origin);
  if (projectId) {
    url.searchParams.set('projectId', projectId);
  }
  return url.toString();
};

export const hasSupabaseAuthUrlState = (): boolean => {
  if (typeof window === 'undefined') return false;
  const snapshot = `${window.location.search || ''}${window.location.hash || ''}`;
  return /(access_token=|refresh_token=|type=magiclink|type=recovery)/i.test(snapshot);
};
