const BANK_REF_PREFIX = 'bank:';
const DB_NAME = 'tap_asset_bank';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

type BankRecord = {
  ref: string;
  blob: Blob;
  mime: string;
  name: string;
  size: number;
  kind: string;
  projectId: string;
  trackId?: string;
  createdAt: string;
};

const urlCache = new Map<string, string>();

const openDb = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'ref' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open asset bank.'));
  });
};

const putRecord = async (record: BankRecord) => {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Asset bank write failed.'));
    tx.onabort = () => reject(tx.error || new Error('Asset bank write aborted.'));
  });
};

const getRecord = async (ref: string): Promise<BankRecord | undefined> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(ref);
    request.onsuccess = () => resolve(request.result as BankRecord | undefined);
    request.onerror = () => reject(request.error || new Error('Asset bank read failed.'));
    tx.onabort = () => reject(tx.error || new Error('Asset bank read aborted.'));
  });
};

const sanitizeSegment = (value: string) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '');

const randomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const extensionFromMime = (mime: string) => {
  const normalized = String(mime || '').split(';')[0].trim().toLowerCase();
  const mapping: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif'
  };
  return mapping[normalized] || '';
};

const extensionFromName = (name: string) => {
  const trimmed = String(name || '').trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot === -1) return '';
  return trimmed.slice(lastDot + 1).toLowerCase();
};

const resolveExtension = (file: File) =>
  extensionFromMime(file.type) || extensionFromName(file.name) || 'bin';

const createRef = (projectId: string, kind: string, extension: string) => {
  const safeProject = sanitizeSegment(projectId) || 'project';
  const safeKind = sanitizeSegment(kind) || 'asset';
  return `${BANK_REF_PREFIX}${safeProject}/${safeKind}/${randomId()}.${extension}`;
};

export const isBankRef = (value?: string | null): boolean =>
  typeof value === 'string' && value.startsWith(BANK_REF_PREFIX);

export const collectBankRefs = (values: Array<string | undefined | null>): string[] => {
  const refs = values.filter(isBankRef) as string[];
  return Array.from(new Set(refs));
};

export const saveBankAsset = async (
  file: File,
  meta: { projectId: string; kind: string; trackId?: string }
): Promise<{ ref: string; url: string }> => {
  const extension = resolveExtension(file);
  const ref = createRef(meta.projectId, meta.kind, extension);
  const record: BankRecord = {
    ref,
    blob: file,
    mime: file.type || 'application/octet-stream',
    name: file.name || 'asset',
    size: file.size || 0,
    kind: meta.kind,
    projectId: meta.projectId,
    trackId: meta.trackId,
    createdAt: new Date().toISOString()
  };
  await putRecord(record);
  const url = URL.createObjectURL(file);
  urlCache.set(ref, url);
  return { ref, url };
};

export const resolveBankUrls = async (refs: string[]): Promise<Record<string, string>> => {
  const unique = Array.from(new Set(refs.filter(isBankRef)));
  const resolved: Record<string, string> = {};
  for (const ref of unique) {
    const cached = urlCache.get(ref);
    if (cached) {
      resolved[ref] = cached;
      continue;
    }
    try {
      const record = await getRecord(ref);
      if (record?.blob) {
        const url = URL.createObjectURL(record.blob);
        urlCache.set(ref, url);
        resolved[ref] = url;
      }
    } catch {
      // best-effort local asset resolution
    }
  }
  return resolved;
};

export { BANK_REF_PREFIX };
