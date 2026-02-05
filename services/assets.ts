const ASSET_REF_PREFIX = 'asset:';

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

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
  if (isAssetRef(value)) {
    return map[value] || '';
  }
  return value;
};

export const collectAssetRefs = (values: Array<string | undefined | null>): string[] => {
  const refs = values.filter(isAssetRef) as string[];
  return Array.from(new Set(refs));
};

export { ASSET_REF_PREFIX };
