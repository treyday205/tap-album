import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pg from 'pg';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolveDistDir = () => {
  const cwdDist = path.join(process.cwd(), 'dist');
  if (fs.existsSync(path.join(cwdDist, 'index.html'))) return cwdDist;
  const relativeDist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(path.join(relativeDist, 'index.html'))) return relativeDist;
  return cwdDist;
};
const DIST_DIR = resolveDistDir();
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const hasFrontendBuild = () => fs.existsSync(INDEX_HTML);
const normalizeOwnerUserId = (value, fallback = null) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }
  return normalized;
};
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '200038';
const ADMIN_OWNER_USER_ID = normalizeOwnerUserId(process.env.ADMIN_OWNER_USER_ID, 'u1');
const UPLOAD_DEBUG = process.env.UPLOAD_DEBUG === 'true';
const DEBUG_TOKEN = String(process.env.DEBUG_TOKEN || '').trim();
const DEBUG_ENDPOINT_TTL_MS = 24 * 60 * 60 * 1000;
const DEBUG_ENDPOINT_STARTED_AT = Date.now();
const DEBUG_ENDPOINT_EXPIRES_AT = new Date(
  DEBUG_ENDPOINT_STARTED_AT + DEBUG_ENDPOINT_TTL_MS
).toISOString();
const normalizeAppUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url.origin;
  } catch {
    return '';
  }
};
const normalizeRedirectUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
};
const resolveAppUrl = () => {
  const railwayDomain =
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.RAILWAY_PUBLIC_URL ||
    process.env.RAILWAY_STATIC_URL ||
    process.env.RAILWAY_URL;
  return normalizeAppUrl(process.env.APP_URL || railwayDomain);
};
const APP_URL = resolveAppUrl();
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_SSL = process.env.DATABASE_SSL === 'true';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;
const MAGIC_TTL_MS = 15 * 60 * 1000;
const MAX_PINS_PER_EMAIL = 1_000_000;
const MAX_PIN_UNLOCKS_PER_PROJECT = 1_000_000;
const MAX_ACTIVE_PINS_PER_PROJECT = 1_000_000;
const PWA_APP_NAME = 'TAP Album';
const IS_DEV = process.env.NODE_ENV !== 'production';
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPLOADS_ROOT = path.join(process.cwd(), 'server', 'uploads');
const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION || 'auto';
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE === 'true';
const S3_KEY_PREFIX = process.env.S3_KEY_PREFIX || 'assets';
const S3_SIGNED_URL_TTL = Number(process.env.S3_SIGNED_URL_TTL || 900);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;
const SUPABASE_SIGNED_URL_TTL = Number(process.env.SUPABASE_SIGNED_URL_TTL || 900);
const SUPABASE_CACHE_CONTROL = process.env.SUPABASE_CACHE_CONTROL || '3600';
const SUPABASE_AUTH_SITE_URL = normalizeAppUrl(process.env.SUPABASE_AUTH_SITE_URL || APP_URL);
const SUPABASE_AUTH_REDIRECT_URLS = String(process.env.SUPABASE_AUTH_REDIRECT_URLS || '')
  .split(',')
  .map((value) => normalizeRedirectUrl(value))
  .filter(Boolean);
const AUTO_GENERATED_TITLE = 'New Album';
const LEGACY_DEFAULT_COVER_URL = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=800';
const getSupabaseKeyType = (key) => {
  if (!key) return 'missing';
  const trimmed = String(key).trim();
  if (/^sb_publishable_/i.test(trimmed) || /^sbp_/i.test(trimmed) || /publishable/i.test(trimmed)) {
    return 'publishable';
  }
  if (/^sb_secret_/i.test(trimmed) || /^sbs_/i.test(trimmed) || /service_role/i.test(trimmed)) {
    return 'service';
  }
  if (trimmed.startsWith('eyJ')) {
    return 'jwt';
  }
  return 'unknown';
};
const SUPABASE_KEY_TYPE = getSupabaseKeyType(SUPABASE_SERVICE_ROLE_KEY);

const ASSET_REF_PREFIX = 'asset:';

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const ASSET_KINDS = new Set(['track-audio', 'track-artwork', 'project-cover']);

const MIME_TO_EXT = {
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

const EXT_TO_MIME = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif'
};

const logUpload = (...args) => {
  if (UPLOAD_DEBUG) {
    console.log('[UPLOAD]', ...args);
  }
};

const logWarn = (...args) => console.warn('[WARN]', ...args);

const hasS3Config = () =>
  Boolean(S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);
const hasSupabaseAdminConfig = () =>
  Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) &&
  SUPABASE_KEY_TYPE !== 'publishable';
const hasSupabaseConfig = () =>
  Boolean(SUPABASE_BUCKET) &&
  hasSupabaseAdminConfig();
const hasSupabaseAuthClientConfig = () =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const getStorageStatus = () => ({
  supabaseConfigured: hasSupabaseConfig(),
  supabaseAdminConfigured: hasSupabaseAdminConfig(),
  supabaseAuthClientConfigured: hasSupabaseAuthClientConfig(),
  supabaseUrl: SUPABASE_URL || null,
  supabaseBucket: SUPABASE_BUCKET || null,
  supabaseKeyType: SUPABASE_KEY_TYPE,
  s3Configured: hasS3Config(),
  bucket: S3_BUCKET || null,
  endpoint: S3_ENDPOINT || null,
  region: S3_REGION || null,
  forcePathStyle: S3_FORCE_PATH_STYLE || false,
  keyPrefix: S3_KEY_PREFIX || 'assets'
});

const safeSegment = (value) => {
  const normalized = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
};

const createAssetRef = (key) => `${ASSET_REF_PREFIX}${key}`;
const isAssetRef = (value) =>
  typeof value === 'string' && value.startsWith(ASSET_REF_PREFIX);

const isSafeAssetKey = (value) => {
  if (!value) return false;
  if (value.includes('..')) return false;
  const ext = path.extname(value).replace('.', '').toLowerCase();
  if (!ext) return false;
  return /^[a-zA-Z0-9/_\-.]+$/.test(value);
};

const signAssetKey = async (key) => {
  if (!isSafeAssetKey(key)) return null;

  if (supabase) {
    const { data, error } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(key, SUPABASE_SIGNED_URL_TTL);
    if (error || !data?.signedUrl) {
      throw error || new Error('Supabase signed URL failed.');
    }
    return data.signedUrl;
  }

  if (s3Client) {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key
    });
    return getSignedUrl(s3Client, command, {
      expiresIn: Number.isFinite(S3_SIGNED_URL_TTL) ? S3_SIGNED_URL_TTL : 900
    });
  }

  return `/uploads/${key}`;
};

const signAssetRef = async (ref) => {
  if (!isAssetRef(ref)) return null;
  const key = String(ref).slice(ASSET_REF_PREFIX.length);
  return signAssetKey(key);
};

const sanitizeExtension = (value, allowed) => {
  const ext = String(value || '').trim().toLowerCase().replace(/^\./, '');
  if (!ext || !allowed.has(ext)) {
    return null;
  }
  return ext;
};

const mimeToExt = (mime) => {
  const normalized = String(mime || '').split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[normalized] || null;
};

const extensionFromFilename = (fileName, allowed) => {
  const ext = path.extname(String(fileName || '')).replace('.', '');
  return sanitizeExtension(ext, allowed);
};

const resolveContentType = (contentType, extension) => {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (normalized && normalized !== 'application/octet-stream') {
    return normalized;
  }
  return EXT_TO_MIME[extension] || 'application/octet-stream';
};

const buildObjectKey = ({ assetKind, projectId, trackId, extension }) => {
  const version = crypto.randomUUID();
  const prefix = String(S3_KEY_PREFIX || '').trim().replace(/^\/+|\/+$/g, '');
  const base = prefix ? `${prefix}/` : '';

  if (assetKind === 'track-audio') {
    return `${base}audio/${projectId}/${trackId}/${version}.${extension}`;
  }
  if (assetKind === 'track-artwork') {
    return `${base}artwork/${projectId}/${trackId}/${version}.${extension}`;
  }
  return `${base}covers/${projectId}/${version}.${extension}`;
};

const createSizeLimiter = (limitBytes) => {
  let total = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > limitBytes) {
        const err = new Error('File too large');
        err.code = 'LIMIT_EXCEEDED';
        cb(err);
        return;
      }
      cb(null, chunk);
    }
  });
};

const s3Client =
  S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
    ? new S3Client({
        region: S3_REGION,
        endpoint: S3_ENDPOINT || undefined,
        forcePathStyle: S3_FORCE_PATH_STYLE || undefined,
        credentials: {
          accessKeyId: S3_ACCESS_KEY_ID,
          secretAccessKey: S3_SECRET_ACCESS_KEY
        }
      })
    : null;

const supabaseAdmin =
  hasSupabaseAdminConfig()
    ? createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      })
    : null;
const supabase = hasSupabaseConfig() ? supabaseAdmin : null;

if (!s3Client) {
  console.warn('S3/R2 storage is not configured. Uploads will use local storage.');
}
if (!supabaseAdmin) {
  console.warn('Supabase admin client is not configured. Supabase Auth exchange and storage signing are disabled.');
}
if (!supabase) {
  console.warn('Supabase storage is not configured. Uploads will use S3/R2 or local storage.');
  if (SUPABASE_KEY_TYPE === 'publishable') {
    console.warn('Supabase key appears to be publishable. Use the service role (secret) key on the server.');
  }
}

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret') {
  logWarn('JWT_SECRET is using the default dev-secret. Set a strong secret in Railway.');
}

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL. Set it in your environment.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_SSL ? { rejectUnauthorized: false } : undefined
});

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const ensureSchema = async () => {
  if (process.env.DB_INIT_DISABLE === 'true') {
    console.warn('[DB INIT] Disabled via DB_INIT_DISABLE=true');
    return;
  }
  const schemaPath = path.join(__dirname, 'schema.sql');
  try {
    if (!fs.existsSync(schemaPath)) {
      console.error(`[DB INIT] schema.sql not found at ${schemaPath}`);
      return;
    }
    const schemaSql = await fs.promises.readFile(schemaPath, 'utf8');
    console.log(`[DB INIT] Applying schema from ${schemaPath} (${schemaSql.length} chars)`);
    await pool.query(schemaSql);
    console.log('✅ Database schema initialized.');
  } catch (err) {
    console.error('Database schema initialization failed:', err);
  }
};
const APP_ORIGIN = APP_URL ? new URL(APP_URL).origin : '';
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://localhost:3001',
  APP_ORIGIN
].filter(Boolean));

const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === 'true';
app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (CORS_ALLOW_ALL) return cb(null, true);
    if (IS_DEV) return cb(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_ROOT, { fallthrough: false }));
const resolveRequestOrigin = (req) => {
  const headerOrigin = String(req.headers.origin || '').trim();
  if (headerOrigin) return headerOrigin;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  if (host) {
    return `${proto || req.protocol || 'http'}://${host}`;
  }
  if (req.headers.host) {
    return `${req.protocol || 'http'}://${req.headers.host}`;
  }
  return '';
};
const getAuthOrigins = (req) =>
  Array.from(
    new Set([
      APP_URL,
      APP_ORIGIN,
      resolveRequestOrigin(req),
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000'
    ]
      .map((value) => normalizeAppUrl(value))
      .filter(Boolean))
  );

const getSupabaseAuthDiagnostics = (req) => {
  const origins = getAuthOrigins(req);
  return {
    enabled: hasSupabaseAuthClientConfig(),
    siteUrl: SUPABASE_AUTH_SITE_URL || origins[0] || '',
    redirectUrls:
      SUPABASE_AUTH_REDIRECT_URLS.length > 0
        ? SUPABASE_AUTH_REDIRECT_URLS
        : origins.map((origin) => `${origin}/*`),
    appUrl: APP_URL || null,
    supabaseUrl: SUPABASE_URL || null
  };
};

app.post('/api/uploads/presign', async (req, res) => {
  const { projectId, trackId, contentType, fileName, size, assetKind, preferLocal } = req.body || {};
  const safeProjectId = safeSegment(projectId);
  const normalizedKind = String(assetKind || '').trim();
  const safeTrackId = safeSegment(trackId);

  if (!safeProjectId || !ASSET_KINDS.has(normalizedKind)) {
    return res.status(400).json({ message: 'projectId and valid assetKind are required.' });
  }

  if ((normalizedKind === 'track-audio' || normalizedKind === 'track-artwork') && !safeTrackId) {
    return res.status(400).json({ message: 'trackId is required for track assets.' });
  }

  const maxBytes = normalizedKind === 'track-audio' ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
  const declaredSize = Number(size || 0);
  if (declaredSize && declaredSize > maxBytes) {
    return res.status(413).json({ message: `File too large. Max ${normalizedKind === 'track-audio' ? '1GB' : '10MB'}.` });
  }

  const normalizedType = String(contentType || '').split(';')[0].trim().toLowerCase();
  const isAudio = normalizedType.startsWith('audio/');
  const isImage = normalizedType.startsWith('image/');
  if (normalizedType && normalizedType !== 'application/octet-stream') {
    if (normalizedKind === 'track-audio' && !isAudio) {
      return res.status(400).json({ message: 'Only audio uploads are supported.' });
    }
    if (normalizedKind !== 'track-audio' && !isImage) {
      return res.status(400).json({ message: 'Only image uploads are supported.' });
    }
  }

  const allowedExtensions = normalizedKind === 'track-audio' ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS;
  const extension =
    sanitizeExtension(mimeToExt(normalizedType), allowedExtensions) ||
    extensionFromFilename(fileName, allowedExtensions);

  if (!extension) {
    return res.status(400).json({
      message: normalizedKind === 'track-audio'
        ? 'Unsupported audio type. Use mp3, wav, m4a, aac, ogg, or flac.'
        : 'Unsupported image type. Use jpg, png, webp, gif, or avif.'
    });
  }

  const resolvedContentType = resolveContentType(normalizedType, extension);
  const key = buildObjectKey({
    assetKind: normalizedKind,
    projectId: safeProjectId,
    trackId: safeTrackId,
    extension
  });
  const assetRef = createAssetRef(key);

  logUpload('presign', {
    assetKind: normalizedKind,
    projectId: safeProjectId,
    trackId: safeTrackId || null,
    contentType: resolvedContentType,
    size: declaredSize || null,
    preferLocal: Boolean(preferLocal),
    storage: getStorageStatus()
  });

  if (supabase && !preferLocal) {
    try {
      const { data, error } = await supabase
        .storage
        .from(SUPABASE_BUCKET)
        .createSignedUploadUrl(key, { upsert: true });
      if (error || !data?.signedUrl) {
        throw error || new Error('Supabase signed upload failed.');
      }
      logUpload('presign success', { key, storage: 'supabase' });
      return res.json({
        uploadUrl: data.signedUrl,
        assetRef,
        method: 'PUT',
        headers: { 'x-upsert': 'true' },
        cacheControl: SUPABASE_CACHE_CONTROL,
        storage: 'supabase'
      });
    } catch (err) {
      console.error('Supabase presign upload failed. Falling back:', err);
      logUpload('presign failed', {
        message: err?.message || String(err),
        name: err?.name || null
      });
    }
  }

  if (s3Client && !preferLocal) {
    try {
      const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ContentType: resolvedContentType
      });
      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: Number.isFinite(S3_SIGNED_URL_TTL) ? S3_SIGNED_URL_TTL : 900
      });
      logUpload('presign success', { key, storage: 's3' });
      return res.json({
        uploadUrl,
        assetRef,
        method: 'PUT',
        headers: { 'Content-Type': resolvedContentType },
        storage: 's3'
      });
    } catch (err) {
      console.error('Presign upload failed. Falling back to local upload:', err);
      logUpload('presign failed', {
        message: err?.message || String(err),
        name: err?.name || null,
        code: err?.code || null
      });
    }
  }

  logUpload('presign fallback', { key, storage: 'local' });
  return res.json({
    uploadUrl: `/api/uploads/local?key=${encodeURIComponent(key)}&assetKind=${encodeURIComponent(normalizedKind)}`,
    assetRef,
    method: 'PUT',
    headers: { 'Content-Type': resolvedContentType },
    storage: 'local'
  });
});

app.put('/api/uploads/local', async (req, res) => {
  const key = String(req.query.key || '').trim();
  const assetKind = String(req.query.assetKind || '').trim();

  if (!key || !isSafeAssetKey(key) || !ASSET_KINDS.has(assetKind)) {
    return res.status(400).json({ message: 'Invalid upload target.' });
  }

  const maxBytes = assetKind === 'track-audio' ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength && declaredLength > maxBytes) {
    return res.status(413).json({ message: `File too large. Max ${assetKind === 'track-audio' ? '1GB' : '10MB'}.` });
  }

  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType && contentType !== 'application/octet-stream') {
    if (assetKind === 'track-audio' && !contentType.startsWith('audio/')) {
      return res.status(400).json({ message: 'Only audio uploads are supported.' });
    }
    if (assetKind !== 'track-audio' && !contentType.startsWith('image/')) {
      return res.status(400).json({ message: 'Only image uploads are supported.' });
    }
  }

  const resolvedPath = path.resolve(UPLOADS_ROOT, key);
  if (!resolvedPath.startsWith(UPLOADS_ROOT)) {
    return res.status(400).json({ message: 'Invalid upload path.' });
  }

  logUpload('local upload start', {
    key,
    assetKind,
    contentType,
    declaredLength: declaredLength || null
  });

  await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
  const tempPath = `${resolvedPath}.uploading`;

  try {
    await pipeline(
      req,
      createSizeLimiter(maxBytes),
      fs.createWriteStream(tempPath)
    );
    await fs.promises.rm(resolvedPath, { force: true });
    await fs.promises.rename(tempPath, resolvedPath);
    logUpload('local upload complete', { key });
    return res.json({ success: true });
  } catch (err) {
    await fs.promises.rm(tempPath, { force: true });
    if (err && err.code === 'LIMIT_EXCEEDED') {
      logUpload('local upload failed', { key, reason: 'LIMIT_EXCEEDED' });
      return res.status(413).json({ message: `File too large. Max ${assetKind === 'track-audio' ? '1GB' : '10MB'}.` });
    }
    if (err && err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      logUpload('local upload failed', { key, reason: 'CANCELLED' });
      return res.status(400).json({ message: 'Upload canceled.' });
    }
    console.error('Local upload failed:', err);
    logUpload('local upload failed', {
      key,
      message: err?.message || String(err),
      name: err?.name || null
    });
    return res.status(500).json({ message: 'Upload failed.' });
  }
});

const normalizeEmail = (email) => email.trim().toLowerCase();
const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));

const query = (text, params, client) => {
  const runner = client || pool;
  return runner.query(text, params);
};

const ensureAccessRemaining = async (access, client) => {
  if (!access) return access;
  const currentRemaining = Number(access.remaining);
  if (Number.isFinite(currentRemaining) && currentRemaining >= MAX_PINS_PER_EMAIL) {
    return access;
  }

  const updated = await query(
    'UPDATE access_records SET remaining = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [access.id, MAX_PINS_PER_EMAIL],
    client
  );

  return updated.rows[0] || { ...access, remaining: MAX_PINS_PER_EMAIL };
};

const toNonNegativeInt = (value) => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.floor(normalized));
};

const buildProjectCapacityStats = (row) => {
  const unlocksUsed = toNonNegativeInt(row?.pin_unlock_count);
  const activePinsUsed = toNonNegativeInt(row?.pin_active_count);
  return {
    unlocksUsed,
    unlocksRemaining: Math.max(0, MAX_PIN_UNLOCKS_PER_PROJECT - unlocksUsed),
    unlocksLimit: MAX_PIN_UNLOCKS_PER_PROJECT,
    activePinsUsed,
    activePinsRemaining: Math.max(0, MAX_ACTIVE_PINS_PER_PROJECT - activePinsUsed),
    activePinsLimit: MAX_ACTIVE_PINS_PER_PROJECT
  };
};

const getProjectCapacityStats = async (projectId, client) => {
  const result = await query(
    'SELECT pin_unlock_count, pin_active_count FROM projects WHERE project_id = $1 LIMIT 1',
    [projectId],
    client
  );
  if (result.rows.length === 0) {
    return null;
  }
  return buildProjectCapacityStats(result.rows[0]);
};

const getProjectUnlockStats = async (projectId, client) => {
  const stats = await getProjectCapacityStats(projectId, client);
  if (!stats) return null;
  return {
    unlocksUsed: stats.unlocksUsed,
    unlocksRemaining: stats.unlocksRemaining,
    unlocksLimit: stats.unlocksLimit
  };
};

const reserveProjectUnlockSlot = async (projectId, client) => {
  const updated = await query(
    `UPDATE projects
       SET pin_unlock_count = pin_unlock_count + 1
     WHERE project_id = $1
       AND pin_unlock_count < $2
     RETURNING pin_unlock_count`,
    [projectId, MAX_PIN_UNLOCKS_PER_PROJECT],
    client
  );

  if (updated.rows.length > 0) {
    const unlocksUsedRaw = Number(updated.rows[0].pin_unlock_count);
    const unlocksUsed = Number.isFinite(unlocksUsedRaw) ? Math.max(0, unlocksUsedRaw) : 0;
    return {
      ok: true,
      unlocksUsed,
      unlocksRemaining: Math.max(0, MAX_PIN_UNLOCKS_PER_PROJECT - unlocksUsed),
      unlocksLimit: MAX_PIN_UNLOCKS_PER_PROJECT
    };
  }

  const stats = await getProjectUnlockStats(projectId, client);
  if (!stats) {
    return { ok: false, reason: 'PROJECT_NOT_FOUND' };
  }
  return { ok: false, reason: 'CAPACITY_REACHED', ...stats };
};

const reserveProjectActivePinSlot = async (projectId, client) => {
  const updated = await query(
    `UPDATE projects
       SET pin_active_count = pin_active_count + 1
     WHERE project_id = $1
       AND pin_active_count < $2
     RETURNING pin_active_count, pin_unlock_count`,
    [projectId, MAX_ACTIVE_PINS_PER_PROJECT],
    client
  );

  if (updated.rows.length > 0) {
    return { ok: true, ...buildProjectCapacityStats(updated.rows[0]) };
  }

  const stats = await getProjectCapacityStats(projectId, client);
  if (!stats) {
    return { ok: false, reason: 'PROJECT_NOT_FOUND' };
  }
  return { ok: false, reason: 'CAPACITY_REACHED', ...stats };
};

const releaseProjectActivePinSlots = async (projectId, count, client) => {
  const safeCount = toNonNegativeInt(count);
  if (safeCount <= 0) {
    return getProjectCapacityStats(projectId, client);
  }

  const updated = await query(
    `UPDATE projects
       SET pin_active_count = GREATEST(pin_active_count - $2, 0)
     WHERE project_id = $1
     RETURNING pin_active_count, pin_unlock_count`,
    [projectId, safeCount],
    client
  );
  if (updated.rows.length === 0) {
    return null;
  }
  return buildProjectCapacityStats(updated.rows[0]);
};

const getAccessRecord = async (projectId, email, client) => {
  const normalized = normalizeEmail(email);
  const existing = await query(
    'SELECT * FROM access_records WHERE project_id = $1 AND email = $2',
    [projectId, normalized],
    client
  );

  if (existing.rows.length > 0) {
    return ensureAccessRemaining(existing.rows[0], client);
  }

  const id = crypto.randomUUID();
  const inserted = await query(
    `INSERT INTO access_records (id, project_id, email, verified, unlocked, remaining)
     VALUES ($1, $2, $3, false, false, $4)
     RETURNING *`,
    [id, projectId, normalized, MAX_PINS_PER_EMAIL],
    client
  );

  return inserted.rows[0];
};

const issueVerifiedAccessToken = async (projectId, email) => {
  if (!projectId || !email) {
    throw new Error('projectId and email are required.');
  }
  const access = await getAccessRecord(projectId, email);
  await query(
    'UPDATE access_records SET verified = true, verified_at = NOW(), updated_at = NOW() WHERE id = $1',
    [access.id]
  );
  const token = jwt.sign({ email: access.email }, JWT_SECRET, { expiresIn: '365d' });
  return {
    success: true,
    token,
    email: access.email,
    projectId: access.project_id,
    remaining: access.remaining,
    unlocked: access.unlocked
  };
};

const getTokenPayload = (req) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
};

const auth = (req, res, next) => {
  const payload = getTokenPayload(req);
  if (!payload || !payload.email) {
    return res.status(401).json({ message: 'Invalid token.' });
  }
  req.user = payload;
  return next();
};

const getTokenEmail = (req) => {
  const payload = getTokenPayload(req);
  return payload?.email || null;
};

const isAdminRequest = (req) => {
  const payload = getTokenPayload(req);
  return payload?.role === 'admin';
};
const getAdminOwnerScope = (req) => {
  const payload = getTokenPayload(req);
  if (!payload || payload.role !== 'admin') {
    return null;
  }
  return normalizeOwnerUserId(payload.ownerUserId, ADMIN_OWNER_USER_ID);
};
const isDebugTokenValid = (providedToken) => {
  if (!DEBUG_TOKEN) return false;
  const rawToken = Array.isArray(providedToken) ? providedToken[0] : providedToken;
  const provided = Buffer.from(String(rawToken || '').trim());
  const expected = Buffer.from(DEBUG_TOKEN);
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
};
const isDebugWindowOpen = () =>
  !IS_DEV &&
  Boolean(DEBUG_TOKEN) &&
  Date.now() <= DEBUG_ENDPOINT_STARTED_AT + DEBUG_ENDPOINT_TTL_MS;

const normalizeCoverPath = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};
const ownerUserIdFromData = (data) => {
  const projectData = data && typeof data === 'object' ? data : {};
  return normalizeOwnerUserId(projectData.ownerUserId, ADMIN_OWNER_USER_ID);
};

const getSignedCoverUrlForPath = async (coverPath) => {
  const normalized = normalizeCoverPath(coverPath);
  if (!normalized) return null;
  if (!isAssetRef(normalized)) {
    return normalized;
  }
  try {
    return await signAssetRef(normalized);
  } catch (err) {
    console.error('Cover signing failed:', err?.message || err);
    return null;
  }
};

const isAutoGeneratedGhostProjectRow = (row) => {
  const title = String(row?.title || '').trim();
  if (title !== AUTO_GENERATED_TITLE) return false;
  const trackCount = Number(row?.track_count || 0);
  if (trackCount !== 0) return false;
  const cover = String(row?.cover_image_url || '').trim();
  return cover === LEGACY_DEFAULT_COVER_URL;
};
const generateProjectId = () => crypto.randomBytes(6).toString('hex').slice(0, 9);
const generateProjectSlug = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug = 'tap-';
  for (let i = 0; i < 10; i += 1) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return slug;
};
const sanitizePwaPath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('/api/')) return '/';
  if (raw.includes('..')) return '/';
  return raw;
};
const createDefaultProjectPayload = ({ ownerUserId, projectId, slug, title, artistName }) => {
  const now = new Date().toISOString();
  return {
    projectId,
    ownerUserId,
    slug,
    title,
    artistName,
    coverImageUrl: '',
    published: false,
    emailGateEnabled: true,
    instagramUrl: '',
    twitterUrl: '',
    tiktokUrl: '',
    youtubeUrl: '',
    facebookUrl: '',
    createdAt: now,
    updatedAt: now,
    isPrivate: true
  };
};

const buildProjectPayload = async (row, options = {}) => {
  const includeSignedCover = Boolean(options.includeSignedCover);
  const projectData = row?.data && typeof row.data === 'object' ? row.data : {};
  const ownerUserId = ownerUserIdFromData(projectData);
  const coverPath = normalizeCoverPath(row?.cover_image_url);
  const trackCountValue = Number(row?.track_count);
  const trackCount = Number.isFinite(trackCountValue) ? trackCountValue : undefined;
  const pinUnlockCountValue = Number(row?.pin_unlock_count);
  const pinUnlockCount = Number.isFinite(pinUnlockCountValue) ? Math.max(0, pinUnlockCountValue) : 0;
  const pinActiveCountValue = Number(row?.pin_active_count);
  const pinActiveCount = Number.isFinite(pinActiveCountValue) ? Math.max(0, pinActiveCountValue) : 0;
  const coverSignedUrl = includeSignedCover
    ? await getSignedCoverUrlForPath(coverPath)
    : null;
  const coverSignedUrlReady = Boolean(coverPath && coverSignedUrl);

  return {
    ...projectData,
    projectId: row.project_id,
    ownerUserId,
    slug: row.slug,
    title: row.title,
    artistName: row.artist_name,
    coverImageUrl: coverPath || '',
    coverPath,
    coverSignedUrl,
    coverSignedUrlReady,
    trackCount,
    pinUnlockCount,
    pinUnlockLimit: MAX_PIN_UNLOCKS_PER_PROJECT,
    pinUnlockRemaining: Math.max(0, MAX_PIN_UNLOCKS_PER_PROJECT - pinUnlockCount),
    pinActiveCount,
    pinActiveLimit: MAX_ACTIVE_PINS_PER_PROJECT,
    pinActiveRemaining: Math.max(0, MAX_ACTIVE_PINS_PER_PROJECT - pinActiveCount),
    published: row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    frontend: hasFrontendBuild(),
    distDir: DIST_DIR,
    cwd: process.cwd(),
    appUrl: APP_URL || null,
    supabaseAuthClientConfigured: hasSupabaseAuthClientConfig(),
    supabaseAdminConfigured: hasSupabaseAdminConfig(),
    allowedOrigins: Array.from(ALLOWED_ORIGINS)
  });
});

app.get('/api/health/projects', async (req, res) => {
  if (IS_DEV || !DEBUG_TOKEN) {
    return res.status(404).json({ message: 'Not found.' });
  }
  if (!isDebugWindowOpen()) {
    return res.status(410).json({
      message: 'Debug endpoint expired.',
      expiresAt: DEBUG_ENDPOINT_EXPIRES_AT
    });
  }

  const providedToken = req.headers['x-debug-token'];
  if (!isDebugTokenValid(providedToken)) {
    return res.status(401).json({ message: 'Invalid debug token.' });
  }

  try {
    const params = [
      ADMIN_OWNER_USER_ID,
      ADMIN_OWNER_USER_ID,
      AUTO_GENERATED_TITLE,
      LEGACY_DEFAULT_COVER_URL
    ];
    const ownerClause = `COALESCE(NULLIF(BTRIM(p.data->>'ownerUserId'), ''), $2) = $1`;
    const ghostClause = `
      ${ownerClause}
      AND p.title = $3
      AND COALESCE(tc.track_count, 0) = 0
      AND COALESCE(BTRIM(p.cover_image_url), '') = $4
    `;

    const totalResult = await query(
      `
      SELECT COUNT(*)::int AS total
      FROM projects p
      WHERE ${ownerClause}
      `,
      [params[0], params[1]]
    );

    const ghostCountResult = await query(
      `
      SELECT COUNT(*)::int AS ghost_count
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS track_count
        FROM tracks t
        WHERE t.project_id = p.project_id
      ) tc ON TRUE
      WHERE ${ghostClause}
      `,
      params
    );

    const sampleResult = await query(
      `
      SELECT p.project_id
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS track_count
        FROM tracks t
        WHERE t.project_id = p.project_id
      ) tc ON TRUE
      WHERE ${ghostClause}
      ORDER BY p.updated_at DESC
      LIMIT 25
      `,
      params
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      ownerUserId: ADMIN_OWNER_USER_ID,
      total: Number(totalResult.rows[0]?.total || 0),
      ghostCount: Number(ghostCountResult.rows[0]?.ghost_count || 0),
      sampleIds: sampleResult.rows.map((row) => row.project_id),
      expiresAt: DEBUG_ENDPOINT_EXPIRES_AT
    });
  } catch (err) {
    console.error('Project health debug endpoint failed:', err);
    return res.status(500).json({ message: 'Unable to compute project health metrics.' });
  }
});

app.get('/api/storage/status', (_req, res) => {
  res.json(getStorageStatus());
});

app.get('/api/auth/config', (req, res) => {
  res.json(getSupabaseAuthDiagnostics(req));
});

app.post('/api/uploads/telemetry', (req, res) => {
  if (!UPLOAD_DEBUG) {
    return res.json({ ok: true });
  }
  logUpload('telemetry', req.body || {});
  return res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ message: 'Admin login is not configured.' });
  }
  if (!password || String(password) !== String(ADMIN_PASSWORD)) {
    return res.status(401).json({ message: 'Invalid access key.' });
  }
  const token = jwt.sign(
    {
      role: 'admin',
      ownerUserId: ADMIN_OWNER_USER_ID
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  return res.json({ success: true, token });
});

app.post('/api/auth/supabase/exchange', async (req, res) => {
  const { accessToken, projectId } = req.body || {};
  if (!accessToken || !projectId) {
    return res.status(400).json({ message: 'accessToken and projectId are required.' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({
      message: 'Supabase admin auth is not configured on the server.'
    });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(String(accessToken));
    if (error || !data?.user?.email) {
      return res.status(401).json({ message: 'Invalid Supabase session.' });
    }
    if (!data.user.email_confirmed_at) {
      return res.status(401).json({ message: 'Email is not verified yet.' });
    }
    const payload = await issueVerifiedAccessToken(projectId, data.user.email);
    return res.json(payload);
  } catch (err) {
    console.error('Supabase exchange failed:', err);
    return res.status(500).json({ message: 'Supabase verification exchange failed.' });
  }
});

app.post('/api/auth/request-magic', async (req, res) => {
  const { email, projectId, slug } = req.body || {};
  if (!email || !projectId || !slug) {
    return res.status(400).json({ message: 'Email, projectId, and slug are required.' });
  }

  const verificationId = crypto.randomUUID();
  const code = generateCode();
  const expiresAt = new Date(Date.now() + MAGIC_TTL_MS);
  const normalizedEmail = normalizeEmail(email);

  try {
    await query('DELETE FROM magic_links WHERE project_id = $1 AND email = $2', [projectId, normalizedEmail]);
    await query(
      `INSERT INTO magic_links (id, project_id, email, code, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [verificationId, projectId, normalizedEmail, code, expiresAt]
    );

    const requestOrigin = resolveRequestOrigin(req);
    const baseUrl = APP_URL || requestOrigin;
    if (!baseUrl) {
      return res.status(500).json({ message: 'APP_URL is not configured.' });
    }
    const magicLink = `${baseUrl}/${slug}?verify=${verificationId}&code=${code}&projectId=${encodeURIComponent(projectId)}`;

    if (resend && RESEND_FROM) {
      await resend.emails.send({
        from: RESEND_FROM,
        to: normalizedEmail,
        subject: 'Your TAP access link',
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>TAP Secure Access</h2>
            <p>Click the button below to verify your email and continue:</p>
            <p style="margin:24px 0">
              <a href="${magicLink}" style="background:#22c55e;color:#000;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:bold">Verify Email</a>
            </p>
            <p>Or enter this verification code in the app:</p>
            <p style="font-size:20px;font-weight:bold;letter-spacing:4px">${code}</p>
            <p style="font-size:12px;color:#666">This code expires in 15 minutes.</p>
          </div>
        `
      });
    } else {
      if (process.env.NODE_ENV === 'production') {
        return res.status(500).json({
          message:
            'EMAIL DELIVERY IS NOT CONFIGURED. Configure Supabase Email/SMTP (Auth) or set RESEND_API_KEY and RESEND_FROM.'
        });
      }
      console.log('[DEV] Magic link:', magicLink);
    }

    const payload = { verificationId };
    if (process.env.NODE_ENV !== 'production') {
      payload.devCode = code;
    }

    return res.json(payload);
  } catch (err) {
    console.error('Magic link request failed:', err);
    return res.status(500).json({ message: 'Unable to send magic link.' });
  }
});

app.post('/api/auth/verify-magic', async (req, res) => {
  const { verificationId, code } = req.body || {};
  if (!verificationId || !code) {
    return res.status(400).json({ message: 'Verification code is required.' });
  }

  try {
    const result = await query('SELECT * FROM magic_links WHERE id = $1', [verificationId]);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid verification request.' });
    }

    const record = result.rows[0];
    if (new Date(record.expires_at).getTime() < Date.now()) {
      await query('DELETE FROM magic_links WHERE id = $1', [verificationId]);
      return res.status(400).json({ message: 'Verification expired.' });
    }

    if (String(code).trim() !== String(record.code)) {
      return res.status(400).json({ message: 'Incorrect verification code.' });
    }

    await query('DELETE FROM magic_links WHERE id = $1', [verificationId]);
    const payload = await issueVerifiedAccessToken(record.project_id, record.email);
    if (IS_DEV) {
      console.log('[DEV] verify-magic success', {
        projectId: record.project_id,
        email: payload.email,
        verified: true
      });
    }

    return res.json(payload);
  } catch (err) {
    console.error('Verify magic failed:', err);
    return res.status(500).json({ message: 'Verification failed.' });
  }
});

app.post('/api/access/status', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (!projectId) {
    return res.status(400).json({ message: 'projectId is required.' });
  }

  try {
    const projectCapacityStats = await getProjectCapacityStats(projectId);
    if (!projectCapacityStats) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    const access = await getAccessRecord(projectId, req.user.email);
    const pinResult = await query(
      'SELECT id FROM pins WHERE access_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
      [access.id]
    );

    return res.json({
      verified: access.verified,
      unlocked: access.unlocked,
      remaining: access.remaining,
      hasActivePin: pinResult.rows.length > 0,
      projectUnlocksUsed: projectCapacityStats.unlocksUsed,
      projectUnlocksRemaining: projectCapacityStats.unlocksRemaining,
      projectUnlocksLimit: projectCapacityStats.unlocksLimit,
      projectActivePinsUsed: projectCapacityStats.activePinsUsed,
      projectActivePinsRemaining: projectCapacityStats.activePinsRemaining,
      projectActivePinsLimit: projectCapacityStats.activePinsLimit
    });
  } catch (err) {
    console.error('Access status failed:', err);
    return res.status(500).json({ message: 'Unable to load access status.' });
  }
});

app.post('/api/assets/sign', async (req, res) => {
  const { projectId, assets } = req.body || {};
  const safeProjectId = safeSegment(projectId);
  if (!safeProjectId) {
    return res.status(400).json({ message: 'projectId is required.' });
  }

  const assetRefs = Array.isArray(assets) ? assets.filter((ref) => String(ref || '').startsWith(ASSET_REF_PREFIX)) : [];
  if (assetRefs.length === 0) {
    return res.json({ assets: [] });
  }

  try {
    const projectResult = await query('SELECT data FROM projects WHERE project_id = $1 LIMIT 1', [safeProjectId]);
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found.' });
    }

    const projectData = projectResult.rows[0].data || {};
    const emailGateEnabled = projectData.emailGateEnabled ?? true;

    const isAdmin = isAdminRequest(req);
    let isUnlocked = false;
    if (!IS_DEV && emailGateEnabled && !isAdmin) {
      const email = getTokenEmail(req);
      if (email) {
        const accessResult = await query(
          'SELECT unlocked FROM access_records WHERE project_id = $1 AND email = $2 LIMIT 1',
          [safeProjectId, normalizeEmail(email)]
        );
        isUnlocked = accessResult.rows.length > 0 && Boolean(accessResult.rows[0].unlocked);
      }
    } else {
      isUnlocked = true;
    }

    const signedAssets = [];
    for (const ref of assetRefs) {
      const key = String(ref || '').slice(ASSET_REF_PREFIX.length);
      if (!isSafeAssetKey(key)) {
        continue;
      }
      if (!key.includes(`/${safeProjectId}/`)) {
        continue;
      }
      const isAudioKey = key.includes('/audio/') && key.includes(`/${safeProjectId}/`);
      if (!isUnlocked && isAudioKey) {
        continue;
      }

      try {
        const signedUrl = await signAssetKey(key);
        if (!signedUrl) continue;
        signedAssets.push({ ref, url: signedUrl });
      } catch (err) {
        console.error('Asset sign failed:', err?.message || err);
      }
    }

    return res.json({ assets: signedAssets });
  } catch (err) {
    console.error('Asset signing failed:', err);
    return res.status(500).json({ message: 'Unable to sign assets.' });
  }
});

app.post('/api/pins/issue', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (!projectId) {
    return res.status(400).json({ message: 'projectId is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accessRow = await client.query(
      'SELECT * FROM access_records WHERE project_id = $1 AND email = $2 FOR UPDATE',
      [projectId, normalizeEmail(req.user.email)]
    );

    let access = accessRow.rows[0];
    if (!access) {
      access = (await client.query(
        `INSERT INTO access_records (id, project_id, email, verified, unlocked, remaining)
         VALUES ($1, $2, $3, false, false, $4)
         RETURNING *`,
        [crypto.randomUUID(), projectId, normalizeEmail(req.user.email), MAX_PINS_PER_EMAIL]
      )).rows[0];
    }
    access = await ensureAccessRemaining(access, client);

    if (!access.verified) {
      await client.query('ROLLBACK');
      return res.status(401).json({ message: 'Email not verified.' });
    }
    if (access.unlocked) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Album already unlocked for this email.' });
    }
    if (access.remaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'No remaining PIN uses.' });
    }
    const projectCapacityStats = await getProjectCapacityStats(projectId, client);
    if (!projectCapacityStats) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found.' });
    }
    if (projectCapacityStats.unlocksRemaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Album PIN activation capacity reached.' });
    }
    const existingActivePinCountResult = await client.query(
      'SELECT COUNT(*)::int AS active_count FROM pins WHERE access_id = $1 AND used = false',
      [access.id]
    );
    const existingActivePinCount = toNonNegativeInt(existingActivePinCountResult.rows[0]?.active_count);

    if (existingActivePinCount <= 0) {
      const reservedActivePinSlot = await reserveProjectActivePinSlot(projectId, client);
      if (!reservedActivePinSlot.ok) {
        await client.query('ROLLBACK');
        if (reservedActivePinSlot.reason === 'PROJECT_NOT_FOUND') {
          return res.status(404).json({ message: 'Project not found.' });
        }
        return res.status(403).json({ message: 'Album active PIN capacity reached.' });
      }
    }

    await client.query('DELETE FROM pins WHERE access_id = $1 AND used = false', [access.id]);
    if (existingActivePinCount > 1) {
      await releaseProjectActivePinSlots(projectId, existingActivePinCount - 1, client);
    }

    const pin = generateCode();
    await client.query(
      'INSERT INTO pins (id, access_id, pin_code, used) VALUES ($1, $2, $3, false)',
      [crypto.randomUUID(), access.id, pin]
    );

    const updatedProjectCapacityStats = await getProjectCapacityStats(projectId, client);
    if (!updatedProjectCapacityStats) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found.' });
    }

    await client.query('COMMIT');
    return res.json({
      pin,
      remaining: access.remaining,
      projectUnlocksUsed: updatedProjectCapacityStats.unlocksUsed,
      projectUnlocksRemaining: updatedProjectCapacityStats.unlocksRemaining,
      projectUnlocksLimit: updatedProjectCapacityStats.unlocksLimit,
      projectActivePinsUsed: updatedProjectCapacityStats.activePinsUsed,
      projectActivePinsRemaining: updatedProjectCapacityStats.activePinsRemaining,
      projectActivePinsLimit: updatedProjectCapacityStats.activePinsLimit
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Issue pin failed:', err);
    return res.status(500).json({ message: 'Unable to issue PIN.' });
  } finally {
    client.release();
  }
});

app.post('/api/pins/verify', auth, async (req, res) => {
  const { projectId, pin } = req.body || {};
  if (!projectId || !pin) {
    if (IS_DEV) {
      console.log('[DEV] pin-verify missing fields', { projectIdPresent: Boolean(projectId), pinPresent: Boolean(pin) });
    }
    return res.status(400).json({ message: 'projectId and pin are required.' });
  }

  const client = await pool.connect();
  try {
    if (IS_DEV) {
      console.log('[DEV] pin-verify request', {
        projectId,
        email: req.user.email,
        pinSuffix: String(pin).trim().slice(-2)
      });
    }
    await client.query('BEGIN');
    const accessRow = await client.query(
      'SELECT * FROM access_records WHERE project_id = $1 AND email = $2 FOR UPDATE',
      [projectId, normalizeEmail(req.user.email)]
    );

    let access = accessRow.rows[0];
    if (!access || !access.verified) {
      await client.query('ROLLBACK');
      return res.status(401).json({ message: 'Email not verified.' });
    }
    access = await ensureAccessRemaining(access, client);
    const projectCapacityStats = await getProjectCapacityStats(projectId, client);
    if (!projectCapacityStats) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found.' });
    }
    if (access.unlocked) {
      await client.query('ROLLBACK');
      if (IS_DEV) {
        console.log('[DEV] pin-verify already unlocked', { projectId, email: req.user.email });
      }
      return res.json({
        success: true,
        unlocked: true,
        remaining: access.remaining,
        projectUnlocksUsed: projectCapacityStats.unlocksUsed,
        projectUnlocksRemaining: projectCapacityStats.unlocksRemaining,
        projectUnlocksLimit: projectCapacityStats.unlocksLimit,
        projectActivePinsUsed: projectCapacityStats.activePinsUsed,
        projectActivePinsRemaining: projectCapacityStats.activePinsRemaining,
        projectActivePinsLimit: projectCapacityStats.activePinsLimit
      });
    }

    const pinRow = await client.query(
      'SELECT * FROM pins WHERE access_id = $1 AND pin_code = $2 AND used = false ORDER BY created_at DESC LIMIT 1',
      [access.id, String(pin).trim()]
    );

    if (pinRow.rows.length === 0) {
      await client.query('ROLLBACK');
      if (IS_DEV) {
        console.log('[DEV] pin-verify failed', { projectId, email: req.user.email });
      }
      return res.status(400).json({ message: 'Incorrect PIN.' });
    }

    const reservedSlot = await reserveProjectUnlockSlot(projectId, client);
    if (!reservedSlot.ok) {
      await client.query('ROLLBACK');
      if (reservedSlot.reason === 'PROJECT_NOT_FOUND') {
        return res.status(404).json({ message: 'Project not found.' });
      }
      return res.status(403).json({ message: 'Album PIN activation capacity reached.' });
    }

    const pinRecord = pinRow.rows[0];
    await client.query(
      'UPDATE pins SET used = true, used_at = NOW() WHERE id = $1',
      [pinRecord.id]
    );
    await releaseProjectActivePinSlots(projectId, 1, client);

    const remaining = Math.max(0, access.remaining - 1);
    await client.query(
      'UPDATE access_records SET unlocked = true, unlocked_at = NOW(), remaining = $2, updated_at = NOW() WHERE id = $1',
      [access.id, remaining]
    );

    const updatedProjectCapacityStats = await getProjectCapacityStats(projectId, client);
    if (!updatedProjectCapacityStats) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found.' });
    }

    await client.query('COMMIT');
    if (IS_DEV) {
      console.log('[DEV] pin-verify success', {
        projectId,
        email: req.user.email,
        remaining,
        projectUnlocksUsed: updatedProjectCapacityStats.unlocksUsed,
        projectActivePinsUsed: updatedProjectCapacityStats.activePinsUsed
      });
    }
    return res.json({
      success: true,
      unlocked: true,
      remaining,
      projectUnlocksUsed: updatedProjectCapacityStats.unlocksUsed,
      projectUnlocksRemaining: updatedProjectCapacityStats.unlocksRemaining,
      projectUnlocksLimit: updatedProjectCapacityStats.unlocksLimit,
      projectActivePinsUsed: updatedProjectCapacityStats.activePinsUsed,
      projectActivePinsRemaining: updatedProjectCapacityStats.activePinsRemaining,
      projectActivePinsLimit: updatedProjectCapacityStats.activePinsLimit
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Verify pin failed:', err);
    return res.status(500).json({ message: 'PIN verification failed.' });
  } finally {
    client.release();
  }
});

app.post('/api/projects', async (req, res) => {
  if (!IS_DEV && !isAdminRequest(req)) {
    return res.status(401).json({ message: 'Admin token required.' });
  }

  const body = req.body || {};
  const ownerScope = IS_DEV
    ? normalizeOwnerUserId(body.ownerUserId, ADMIN_OWNER_USER_ID)
    : getAdminOwnerScope(req);
  if (!ownerScope) {
    return res.status(401).json({ message: 'Admin owner scope is required.' });
  }

  const title = String(body.title || AUTO_GENERATED_TITLE).trim() || AUTO_GENERATED_TITLE;
  const artistName = String(body.artistName || 'Artist Name').trim() || 'Artist Name';

  try {
    const existingResult = await query(
      `
      SELECT p.*,
             COALESCE(tc.track_count, 0) AS track_count
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS track_count
        FROM tracks t
        WHERE t.project_id = p.project_id
      ) tc ON TRUE
      WHERE COALESCE(NULLIF(BTRIM(p.data->>'ownerUserId'), ''), $2) = $1
      ORDER BY p.updated_at DESC
      LIMIT 50
      `,
      [ownerScope, ADMIN_OWNER_USER_ID]
    );

    const existingProjectRow = existingResult.rows.find((row) => !isAutoGeneratedGhostProjectRow(row));
    if (existingProjectRow) {
      const existingProject = await buildProjectPayload(existingProjectRow, {
        includeSignedCover: true
      });
      res.set('Cache-Control', 'no-store');
      return res.json({
        success: true,
        created: false,
        reusedDraft: true,
        project: existingProject
      });
    }

    const ghostProjectIds = existingResult.rows
      .filter((row) => isAutoGeneratedGhostProjectRow(row))
      .map((row) => String(row.project_id || '').trim())
      .filter(Boolean);
    if (ghostProjectIds.length > 0) {
      await query('DELETE FROM magic_links WHERE project_id = ANY($1::text[])', [ghostProjectIds]);
      await query('DELETE FROM access_records WHERE project_id = ANY($1::text[])', [ghostProjectIds]);
      await query('DELETE FROM projects WHERE project_id = ANY($1::text[])', [ghostProjectIds]);
    }

    let insertedRow = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const projectId = generateProjectId();
      const slug = generateProjectSlug();
      const payload = createDefaultProjectPayload({
        ownerUserId: ownerScope,
        projectId,
        slug,
        title,
        artistName
      });

      try {
        const insertResult = await query(
          `INSERT INTO projects (project_id, slug, title, artist_name, cover_image_url, published, data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           RETURNING *`,
          [projectId, slug, title, artistName, null, false, payload]
        );
        insertedRow = insertResult.rows[0];
        break;
      } catch (err) {
        if (err?.code === '23505') {
          continue;
        }
        throw err;
      }
    }

    if (!insertedRow) {
      return res.status(500).json({ message: 'Unable to allocate project identifiers.' });
    }

    const project = await buildProjectPayload(insertedRow, { includeSignedCover: true });
    res.set('Cache-Control', 'no-store');
    return res.status(201).json({
      success: true,
      created: true,
      reusedDraft: false,
      project
    });
  } catch (err) {
    console.error('Project create failed:', err);
    return res.status(500).json({ message: 'Unable to create project.' });
  }
});

app.get('/api/projects', async (req, res) => {
  if (!IS_DEV && !isAdminRequest(req)) {
    return res.status(401).json({ message: 'Admin token required.' });
  }

  const ownerScope = IS_DEV ? ADMIN_OWNER_USER_ID : getAdminOwnerScope(req);
  if (!ownerScope) {
    return res.status(401).json({ message: 'Admin owner scope is required.' });
  }

  try {
    const result = await query(
      `
      SELECT p.*,
             COALESCE(tc.track_count, 0) AS track_count
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS track_count
        FROM tracks t
        WHERE t.project_id = p.project_id
      ) tc ON TRUE
      WHERE COALESCE(NULLIF(BTRIM(p.data->>'ownerUserId'), ''), $2) = $1
      ORDER BY p.updated_at DESC
    `,
      [ownerScope, ADMIN_OWNER_USER_ID]
    );
    const projects = [];
    for (const row of result.rows) {
      if (isAutoGeneratedGhostProjectRow(row)) {
        continue;
      }
      const project = await buildProjectPayload(row, { includeSignedCover: true });
      projects.push(project);
    }
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, projects });
  } catch (err) {
    console.error('Projects list failed:', err);
    return res.status(500).json({ message: 'Unable to load projects.' });
  }
});

app.delete('/api/projects/:projectId', async (req, res) => {
  const safeProjectId = safeSegment(req.params.projectId);
  if (!safeProjectId) {
    return res.status(400).json({ message: 'projectId is required.' });
  }
  if (!IS_DEV && !isAdminRequest(req)) {
    return res.status(401).json({ message: 'Admin token required.' });
  }
  const ownerScope = IS_DEV ? ADMIN_OWNER_USER_ID : getAdminOwnerScope(req);
  if (!ownerScope) {
    return res.status(401).json({ message: 'Admin owner scope is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT data FROM projects WHERE project_id = $1 LIMIT 1 FOR UPDATE',
      [safeProjectId]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found.' });
    }
    const existingOwner = ownerUserIdFromData(existing.rows[0].data);
    if (existingOwner !== ownerScope) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found.' });
    }

    await client.query('DELETE FROM magic_links WHERE project_id = $1', [safeProjectId]);
    await client.query('DELETE FROM access_records WHERE project_id = $1', [safeProjectId]);
    await client.query('DELETE FROM projects WHERE project_id = $1', [safeProjectId]);

    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      deleted: true,
      projectId: safeProjectId
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Project delete failed:', err);
    return res.status(500).json({ message: 'Unable to delete project.' });
  } finally {
    client.release();
  }
});

app.get('/api/projects/:projectId/cover-url', async (req, res) => {
  const safeProjectId = safeSegment(req.params.projectId);
  if (!safeProjectId) {
    return res.status(400).json({ message: 'projectId is required.' });
  }
  if (!IS_DEV && !isAdminRequest(req)) {
    return res.status(401).json({ message: 'Admin token required.' });
  }
  const ownerScope = IS_DEV ? ADMIN_OWNER_USER_ID : getAdminOwnerScope(req);
  if (!ownerScope) {
    return res.status(401).json({ message: 'Admin owner scope is required.' });
  }

  try {
    const result = await query(
      'SELECT project_id, cover_image_url, updated_at, data FROM projects WHERE project_id = $1 LIMIT 1',
      [safeProjectId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    const row = result.rows[0];
    const rowOwner = ownerUserIdFromData(row.data);
    if (rowOwner !== ownerScope) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    const coverPath = normalizeCoverPath(row.cover_image_url);
    const coverSignedUrl = await getSignedCoverUrlForPath(coverPath);
    const coverSignedUrlReady = Boolean(coverPath && coverSignedUrl);
    if (!IS_DEV) {
      console.log('[COVER SIGN]', {
        route: 'cover-url',
        projectId: row.project_id,
        hasCoverPath: Boolean(coverPath),
        coverSignedUrlReady
      });
    }
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      projectId: row.project_id,
      coverPath,
      coverSignedUrl,
      coverSignedUrlReady,
      updatedAt: row.updated_at
    });
  } catch (err) {
    console.error('Project cover URL fetch failed:', err);
    return res.status(500).json({ message: 'Unable to resolve cover URL.' });
  }
});

app.patch('/api/projects/:projectId/cover', async (req, res) => {
  const safeProjectId = safeSegment(req.params.projectId);
  const coverImageUrl = normalizeCoverPath(req.body?.coverImageUrl);
  if (!safeProjectId) {
    return res.status(400).json({ message: 'projectId is required.' });
  }
  if (!IS_DEV && !isAdminRequest(req)) {
    return res.status(401).json({ message: 'Admin token required.' });
  }
  const ownerScope = IS_DEV ? ADMIN_OWNER_USER_ID : getAdminOwnerScope(req);
  if (!ownerScope) {
    return res.status(401).json({ message: 'Admin owner scope is required.' });
  }

  try {
    const existing = await query(
      'SELECT data FROM projects WHERE project_id = $1 LIMIT 1',
      [safeProjectId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    const rowOwner = ownerUserIdFromData(existing.rows[0].data);
    if (rowOwner !== ownerScope) {
      return res.status(404).json({ message: 'Project not found.' });
    }

    const currentData = existing.rows[0].data && typeof existing.rows[0].data === 'object'
      ? existing.rows[0].data
      : {};
    const nextData = {
      ...currentData,
      ownerUserId: rowOwner,
      coverImageUrl: coverImageUrl || ''
    };

    const updated = await query(
      `UPDATE projects
       SET cover_image_url = $2,
           data = $3,
           updated_at = NOW()
       WHERE project_id = $1
       RETURNING *`,
      [safeProjectId, coverImageUrl, nextData]
    );
    const project = await buildProjectPayload(updated.rows[0], { includeSignedCover: true });
    const coverSignedUrlReady = Boolean(project.coverPath && project.coverSignedUrl);
    if (!IS_DEV) {
      console.log('[COVER SIGN]', {
        route: 'cover-update',
        projectId: safeProjectId,
        hasCoverPath: Boolean(project.coverPath),
        coverSignedUrlReady
      });
    }
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      coverPath: project.coverPath || null,
      coverSignedUrl: project.coverSignedUrl || null,
      coverSignedUrlReady,
      project
    });
  } catch (err) {
    console.error('Project cover update failed:', err);
    return res.status(500).json({ message: 'Unable to update project cover.' });
  }
});

app.post('/api/projects/sync', async (req, res) => {
  const { project, tracks } = req.body || {};
  if (!project || !project.projectId || !project.slug) {
    return res.status(400).json({ message: 'project and projectId/slug are required.' });
  }
  if (!IS_DEV && !isAdminRequest(req)) {
    return res.status(401).json({ message: 'Admin token required.' });
  }
  const ownerScope = IS_DEV
    ? normalizeOwnerUserId(project.ownerUserId, ADMIN_OWNER_USER_ID)
    : getAdminOwnerScope(req);
  if (!ownerScope) {
    return res.status(401).json({ message: 'Admin owner scope is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT data FROM projects WHERE project_id = $1 LIMIT 1',
      [project.projectId]
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Project not found.' });
    }

    const existingOwner = ownerUserIdFromData(existing.rows[0].data);
    if (existingOwner !== ownerScope) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Project owner mismatch.' });
    }

    const existingData = existing.rows[0].data && typeof existing.rows[0].data === 'object'
      ? existing.rows[0].data
      : {};
    const payload = {
      ...existingData,
      ...project,
      ownerUserId: ownerScope
    };
    const resetSecurity = Boolean(payload.resetSecurity);
    delete payload.resetSecurity;
    const normalizedSlug = String(payload.slug || '').trim();
    if (!normalizedSlug) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'slug is required.' });
    }

    const title = payload.title || 'Untitled';
    const artistName = payload.artistName || 'Unknown Artist';
    const coverImageUrl = payload.coverImageUrl || null;
    const published = Boolean(payload.published);

    if (resetSecurity) {
      await client.query('DELETE FROM magic_links WHERE project_id = $1', [payload.projectId]);
      await client.query('DELETE FROM access_records WHERE project_id = $1', [payload.projectId]);
    }

    const updateResult = await client.query(
      `UPDATE projects
       SET slug = $2,
           title = $3,
           artist_name = $4,
           cover_image_url = $5,
           published = $6,
           data = $7,
           pin_unlock_count = CASE WHEN $8 THEN 0 ELSE pin_unlock_count END,
           pin_active_count = CASE WHEN $8 THEN 0 ELSE pin_active_count END,
           updated_at = NOW()
       WHERE project_id = $1
       RETURNING *`,
      [payload.projectId, normalizedSlug, title, artistName, coverImageUrl, published, payload, resetSecurity]
    );

    if (UPLOAD_DEBUG && coverImageUrl) {
      logUpload('project sync cover', {
        projectId: payload.projectId,
        coverImageUrl
      });
    }

    await client.query('DELETE FROM tracks WHERE project_id = $1', [payload.projectId]);

    const trackRows = Array.isArray(tracks) ? tracks : [];
    for (const track of trackRows) {
      await client.query(
        `INSERT INTO tracks (track_id, project_id, title, mp3_url, artwork_url, sort_order, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          track.trackId,
          payload.projectId,
          track.title || 'Untitled',
          track.mp3Url || null,
          track.artworkUrl || null,
          track.sortOrder || 0
        ]
      );
    }

    await client.query('COMMIT');
    const persistedProject = await buildProjectPayload(updateResult.rows[0], {
      includeSignedCover: true
    });
    if (UPLOAD_DEBUG) {
      logUpload('project sync', {
        projectId: payload.projectId,
        slug: normalizedSlug,
        tracks: trackRows.length,
        coverImageUrl: coverImageUrl || null
      });
    }
    if (IS_DEV) {
      console.log('[DEV] project sync', {
        projectId: payload.projectId,
        slug: normalizedSlug,
        tracks: trackRows.length
      });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, project: persistedProject });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return res.status(409).json({ message: 'Slug is already in use.' });
    }
    console.error('Project sync failed:', err);
    return res.status(500).json({ message: 'Project sync failed.' });
  } finally {
    client.release();
  }
});

app.get('/api/projects/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!slug) {
    return res.status(400).json({ message: 'slug is required.' });
  }

  try {
    const projectResult = await query(
      IS_DEV
        ? 'SELECT * FROM projects WHERE slug = $1 ORDER BY updated_at DESC LIMIT 1'
        : 'SELECT * FROM projects WHERE slug = $1 AND published = true LIMIT 1',
      [slug]
    );
    if (projectResult.rows.length === 0) {
      if (IS_DEV) {
        console.log('[DEV] project fetch miss', { slug });
      }
      return res.status(404).json({ message: 'Project not found.' });
    }

    const row = projectResult.rows[0];
    const trackResult = await query(
      'SELECT * FROM tracks WHERE project_id = $1 ORDER BY sort_order ASC',
      [row.project_id]
    );

    const project = await buildProjectPayload(row, { includeSignedCover: true });

    const tracks = trackResult.rows.map((track) => ({
      trackId: track.track_id,
      projectId: track.project_id,
      title: track.title,
      mp3Url: track.mp3_url || '',
      artworkUrl: track.artwork_url || '',
      sortOrder: track.sort_order,
      createdAt: track.created_at
    }));

    if (IS_DEV) {
      console.log('[DEV] project fetch', {
        slug,
        projectId: row.project_id,
        tracks: tracks.length
      });

      const suspectUrls = [
        project.coverImageUrl,
        ...tracks.map((t) => t.mp3Url),
        ...tracks.map((t) => t.artworkUrl)
      ].filter(Boolean);
      const hasLocalPaths = suspectUrls.some((url) => /^([a-zA-Z]:\\\\|file:|\\\\)/.test(url));
      if (hasLocalPaths) {
        console.log('[DEV] project asset warning: local file paths detected.');
      }
    }

    return res.json({ success: true, project, tracks });
  } catch (err) {
    console.error('Project fetch failed:', err);
    return res.status(500).json({ message: 'Project fetch failed.' });
  }
});

app.get('/api/pwa/manifest', async (req, res) => {
  const slug = String(req.query.slug || '').trim().toLowerCase();
  const requestedPath = sanitizePwaPath(req.query.path);

  let appName = PWA_APP_NAME;
  let appShortName = 'TAP';
  let appDescription = 'Live album experience';
  let startPath = requestedPath !== '/' ? requestedPath : '/';

  if (slug) {
    try {
      const projectResult = await query(
        IS_DEV
          ? 'SELECT title, artist_name, slug FROM projects WHERE slug = $1 ORDER BY updated_at DESC LIMIT 1'
          : 'SELECT title, artist_name, slug FROM projects WHERE slug = $1 AND published = true LIMIT 1',
        [slug]
      );

      if (projectResult.rows.length > 0) {
        const row = projectResult.rows[0];
        const title = String(row.title || '').trim();
        const artistName = String(row.artist_name || '').trim();
        if (title) {
          appName = artistName ? `${title} - ${artistName}` : title;
          appShortName = title.slice(0, 12) || 'TAP';
          appDescription = artistName
            ? `Listen to ${title} by ${artistName}`
            : `Listen to ${title}`;
        }
        if (requestedPath === '/' && row.slug) {
          startPath = `/${String(row.slug).trim()}`;
        }
      }
    } catch (err) {
      console.error('PWA manifest project lookup failed:', err?.message || err);
    }
  }

  const manifest = {
    id: startPath,
    name: appName,
    short_name: appShortName,
    description: appDescription,
    start_url: startPath,
    scope: '/',
    display: 'standalone',
    display_override: ['fullscreen', 'standalone', 'minimal-ui'],
    background_color: '#020617',
    theme_color: '#020617',
    orientation: 'portrait',
    categories: ['music', 'entertainment'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  };

  res.set('Cache-Control', 'no-store');
  res.type('application/manifest+json');
  return res.send(JSON.stringify(manifest));
});

app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), { fallthrough: false }));
app.get('/sw.js', (req, res) => {
  const swPath = path.join(DIST_DIR, 'sw.js');
  if (!fs.existsSync(swPath)) {
    return res.status(404).json({ message: 'Service worker not found.' });
  }
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Service-Worker-Allowed', '/');
  return res.sendFile(swPath);
});
app.use(express.static(DIST_DIR, { index: false }));

app.get('/', (_req, res) => {
  if (hasFrontendBuild()) {
    return res.sendFile(INDEX_HTML);
  }
  return res.status(200).json({
    status: 'ok',
    message: 'Frontend build not found. Run `npm run build` before starting the server.'
  });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'Not found.' });
  }
  if (!hasFrontendBuild()) {
    return res.status(404).json({
      message: 'Frontend build not found. Run `npm run build` before starting the server.'
    });
  }
  return res.sendFile(INDEX_HTML);
});

const startServer = async () => {
  await ensureSchema();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`Serving frontend from ${DIST_DIR} (${hasFrontendBuild() ? 'index.html found' : 'index.html missing'})`);
    console.log(`Process CWD: ${process.cwd()}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('ADMIN_PASSWORD not set. Default admin password is in use.');
    }
  });
};

startServer();
