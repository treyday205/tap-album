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
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '200038';
const UPLOAD_DEBUG = process.env.UPLOAD_DEBUG === 'true';
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
const MAX_PINS_PER_EMAIL = 5;
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

const getAccessRecord = async (projectId, email, client) => {
  const normalized = normalizeEmail(email);
  const existing = await query(
    'SELECT * FROM access_records WHERE project_id = $1 AND email = $2',
    [projectId, normalized],
    client
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
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

const normalizeCoverPath = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
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
  return !cover || cover === LEGACY_DEFAULT_COVER_URL;
};

const buildProjectPayload = async (row, options = {}) => {
  const includeSignedCover = Boolean(options.includeSignedCover);
  const projectData = row?.data && typeof row.data === 'object' ? row.data : {};
  const coverPath = normalizeCoverPath(row?.cover_image_url);
  const trackCountValue = Number(row?.track_count);
  const trackCount = Number.isFinite(trackCountValue) ? trackCountValue : undefined;
  const coverSignedUrl = includeSignedCover
    ? await getSignedCoverUrlForPath(coverPath)
    : null;

  return {
    ...projectData,
    projectId: row.project_id,
    slug: row.slug,
    title: row.title,
    artistName: row.artist_name,
    coverImageUrl: coverPath || '',
    coverPath,
    coverSignedUrl,
    trackCount,
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
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '30d' });
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
    const access = await getAccessRecord(projectId, req.user.email);
    const pinResult = await query(
      'SELECT id FROM pins WHERE access_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
      [access.id]
    );

    return res.json({
      verified: access.verified,
      unlocked: access.unlocked,
      remaining: access.remaining,
      hasActivePin: pinResult.rows.length > 0
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

    await client.query('DELETE FROM pins WHERE access_id = $1 AND used = false', [access.id]);

    const pin = generateCode();
    await client.query(
      'INSERT INTO pins (id, access_id, pin_code, used) VALUES ($1, $2, $3, false)',
      [crypto.randomUUID(), access.id, pin]
    );

    await client.query('COMMIT');
    return res.json({ pin, remaining: access.remaining });
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

    const access = accessRow.rows[0];
    if (!access || !access.verified) {
      await client.query('ROLLBACK');
      return res.status(401).json({ message: 'Email not verified.' });
    }
    if (access.unlocked) {
      await client.query('ROLLBACK');
      if (IS_DEV) {
        console.log('[DEV] pin-verify already unlocked', { projectId, email: req.user.email });
      }
      return res.json({ success: true, unlocked: true, remaining: access.remaining });
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

    const pinRecord = pinRow.rows[0];
    await client.query(
      'UPDATE pins SET used = true, used_at = NOW() WHERE id = $1',
      [pinRecord.id]
    );

    const remaining = Math.max(0, access.remaining - 1);
    await client.query(
      'UPDATE access_records SET unlocked = true, unlocked_at = NOW(), remaining = $2, updated_at = NOW() WHERE id = $1',
      [access.id, remaining]
    );

    await client.query('COMMIT');
    if (IS_DEV) {
      console.log('[DEV] pin-verify success', { projectId, email: req.user.email, remaining });
    }
    return res.json({ success: true, unlocked: true, remaining });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Verify pin failed:', err);
    return res.status(500).json({ message: 'PIN verification failed.' });
  } finally {
    client.release();
  }
});

app.get('/api/projects', async (req, res) => {
  if (!IS_DEV && !isAdminRequest(req)) {
    return res.status(401).json({ message: 'Admin token required.' });
  }

  try {
    const result = await query(`
      SELECT p.*,
             COALESCE(tc.track_count, 0) AS track_count
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS track_count
        FROM tracks t
        WHERE t.project_id = p.project_id
      ) tc ON TRUE
      ORDER BY p.updated_at DESC
    `);
    const projects = [];
    for (const row of result.rows) {
      if (isAutoGeneratedGhostProjectRow(row)) {
        continue;
      }
      const project = await buildProjectPayload(row, { includeSignedCover: true });
      projects.push(project);
    }
    return res.json({ success: true, projects });
  } catch (err) {
    console.error('Projects list failed:', err);
    return res.status(500).json({ message: 'Unable to load projects.' });
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

  try {
    const result = await query(
      'SELECT project_id, cover_image_url, updated_at FROM projects WHERE project_id = $1 LIMIT 1',
      [safeProjectId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    const row = result.rows[0];
    const coverPath = normalizeCoverPath(row.cover_image_url);
    const coverSignedUrl = await getSignedCoverUrlForPath(coverPath);
    return res.json({
      success: true,
      projectId: row.project_id,
      coverPath,
      coverSignedUrl,
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

  try {
    const existing = await query(
      'SELECT data FROM projects WHERE project_id = $1 LIMIT 1',
      [safeProjectId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found.' });
    }

    const currentData = existing.rows[0].data && typeof existing.rows[0].data === 'object'
      ? existing.rows[0].data
      : {};
    const nextData = {
      ...currentData,
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
    return res.json({
      success: true,
      coverPath: project.coverPath || null,
      coverSignedUrl: project.coverSignedUrl || null,
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

  const normalizedSlug = String(project.slug).trim();
  const title = project.title || 'Untitled';
  const artistName = project.artistName || 'Unknown Artist';
  const coverImageUrl = project.coverImageUrl || null;
  const published = Boolean(project.published);
  const payload = { ...project };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upsertResult = await client.query(
      `INSERT INTO projects (project_id, slug, title, artist_name, cover_image_url, published, data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (project_id)
       DO UPDATE SET slug = EXCLUDED.slug,
                     title = EXCLUDED.title,
                     artist_name = EXCLUDED.artist_name,
                    cover_image_url = EXCLUDED.cover_image_url,
                    published = EXCLUDED.published,
                    data = EXCLUDED.data,
                    updated_at = NOW()
       RETURNING *`,
      [project.projectId, normalizedSlug, title, artistName, coverImageUrl, published, payload]
    );

    if (UPLOAD_DEBUG && coverImageUrl) {
      logUpload('project sync cover', {
        projectId: project.projectId,
        coverImageUrl
      });
    }

    await client.query('DELETE FROM tracks WHERE project_id = $1', [project.projectId]);

    const trackRows = Array.isArray(tracks) ? tracks : [];
    for (const track of trackRows) {
      await client.query(
        `INSERT INTO tracks (track_id, project_id, title, mp3_url, artwork_url, sort_order, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          track.trackId,
          project.projectId,
          track.title || 'Untitled',
          track.mp3Url || null,
          track.artworkUrl || null,
          track.sortOrder || 0
        ]
      );
    }

    await client.query('COMMIT');
    const persistedProject = await buildProjectPayload(upsertResult.rows[0], {
      includeSignedCover: true
    });
    if (UPLOAD_DEBUG) {
      logUpload('project sync', {
        projectId: project.projectId,
        slug: normalizedSlug,
        tracks: trackRows.length,
        coverImageUrl: coverImageUrl || null
      });
    }
    if (IS_DEV) {
      console.log('[DEV] project sync', {
        projectId: project.projectId,
        slug: normalizedSlug,
        tracks: trackRows.length
      });
    }

    return res.json({ success: true, project: persistedProject });
  } catch (err) {
    await client.query('ROLLBACK');
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

app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), { fallthrough: false }));
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
