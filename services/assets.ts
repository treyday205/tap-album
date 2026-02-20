const ASSET_REF_PREFIX = 'asset:';

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const SUPABASE_OBJECT_PATH_REGEX =
  /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/(.+)$/i;

const getExtension = (value: string): string => {
  const trimmed = String(value || '').trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot === -1) return '';
  return trimmed.slice(lastDot + 1).toLowerCase();
};

export const isAssetRef = (value?: string | null): boolean =>
  typeof value === 'string' && value.startsWith(ASSET_REF_PREFIX);

export const getAssetKey = (ref: string): string =>
  ref.slice(ASSET_REF_PREFIX.length);

const safeDecodeUriComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const parseSupabaseStorageObjectUrl = (
  value: string | undefined | null
): { bucket: string; storagePath: string } | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const host = String(parsed.hostname || '').trim().toLowerCase();
  const isSupabaseHost =
    host.endsWith('.supabase.co') ||
    host === 'supabase.co' ||
    host.endsWith('.supabase.in') ||
    host === 'supabase.in';
  if (!isSupabaseHost) {
    return null;
  }

  const match = String(parsed.pathname || '').match(SUPABASE_OBJECT_PATH_REGEX);
  if (!match || !match[1]) return null;

  const decoded = safeDecodeUriComponent(match[1]).replace(/^\/+/, '').trim();
  if (!decoded || decoded.includes('..')) return null;

  const slashIndex = decoded.indexOf('/');
  if (slashIndex <= 0 || slashIndex === decoded.length - 1) {
    return null;
  }

  const bucket = decoded.slice(0, slashIndex).trim();
  const storagePath = decoded.slice(slashIndex + 1).replace(/^\/+/, '').trim();
  if (!bucket || !storagePath || storagePath.includes('..')) {
    return null;
  }

  return { bucket, storagePath };
};

export const isAudioAssetRef = (ref: string): boolean => {
  if (!isAssetRef(ref)) return false;
  const ext = getExtension(getAssetKey(ref));
  return AUDIO_EXTENSIONS.has(ext);
};

export const isImageAssetRef = (ref: string): boolean => {
  if (!isAssetRef(ref)) return false;
  const ext = getExtension(getAssetKey(ref));
  return IMAGE_EXTENSIONS.has(ext);
};

export const resolveAssetUrl = (
  value: string | undefined | null,
  map: Record<string, string>
): string => {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (map[trimmed]) {
    return map[trimmed];
  }
  if (trimmed.startsWith('bank:')) {
    return map[trimmed] || '';
  }
  if (isAssetRef(trimmed)) {
    return map[trimmed] || '';
  }
  return trimmed;
};

export const collectAssetRefs = (values: Array<string | undefined | null>): string[] => {
  const refs = values.filter(isAssetRef) as string[];
  return Array.from(new Set(refs));
};

export { ASSET_REF_PREFIX };
