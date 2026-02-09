import { createClient } from '@supabase/supabase-js';

const normalizeUrl = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/g, '');
};

const readEnvValue = (key: string): string => {
  const processValue = (process.env as Record<string, string | undefined> | undefined)?.[key];
  if (processValue) return String(processValue).trim();
  const importMetaValue = (import.meta as any)?.env?.[key];
  if (importMetaValue) return String(importMetaValue).trim();
  return '';
};

const firstEnv = (keys: string[]): string => {
  for (const key of keys) {
    const value = readEnvValue(key);
    if (value) return value;
  }
  return '';
};

export const SUPABASE_URL = normalizeUrl(
  firstEnv(['VITE_SUPABASE_URL', 'SUPABASE_URL'])
);

export const SUPABASE_ANON_KEY = firstEnv([
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY'
]);

export const isSupabaseAuthEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

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
