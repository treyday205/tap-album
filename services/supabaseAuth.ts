import { createClient } from '@supabase/supabase-js';

const normalizeUrl = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/g, '');
};

const firstNonEmpty = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
};

const clientSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const clientSupabaseAnonKey = firstNonEmpty(
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

export const SUPABASE_URL = normalizeUrl(clientSupabaseUrl);

export const SUPABASE_ANON_KEY = clientSupabaseAnonKey;

export const isSupabaseAuthConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const isSupabaseStorageConfigured = isSupabaseAuthConfigured;
export const isSupabaseAuthEnabled = isSupabaseAuthConfigured;

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
