const normalizeApiBase = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) {
    return `http://${raw}`.replace(/\/+$/g, '');
  }
  return raw.replace(/\/+$/g, '');
};

const API = normalizeApiBase(import.meta.env?.VITE_API_URL);
const API_BASE_URL =
  API ||
  (typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '');

const reportUploadTelemetry = async (payload: Record<string, any>) => {
  try {
    await fetch(`${API_BASE_URL}/api/uploads/telemetry`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    // best-effort logging
  }
};

const inflightRequests = new Map<string, Promise<any>>();
const responseCache = new Map<string, any>();

const cachedRequest = <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
  if (responseCache.has(key)) {
    return Promise.resolve(responseCache.get(key) as T);
  }
  const inflight = inflightRequests.get(key);
  if (inflight) return inflight as Promise<T>;

  const promise = fn()
    .then((data) => {
      responseCache.set(key, data);
      return data;
    })
    .catch((err) => {
      responseCache.delete(key);
      throw err;
    })
    .finally(() => {
      inflightRequests.delete(key);
    });

  inflightRequests.set(key, promise);
  return promise;
};

const request = async (path: string, options: RequestInit = {}) => {
  const { headers, ...rest } = options;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(data?.message || `Request failed (${res.status}).`).trim();
    const error = new Error(message) as Error & { status?: number; body?: unknown };
    error.status = res.status;
    error.body = data;
    throw error;
  }
  return data;
};

export const Api = {
  requestMagicLink: (email: string, projectId: string, slug: string) =>
    request('/api/auth/request-magic', {
      method: 'POST',
      body: JSON.stringify({ email, projectId, slug })
    }),

  verifyMagicLink: (verificationId: string, code: string) =>
    request('/api/auth/verify-magic', {
      method: 'POST',
      body: JSON.stringify({ verificationId, code })
    }),

  exchangeSupabaseSession: (projectId: string, accessToken: string) =>
    request('/api/auth/supabase/exchange', {
      method: 'POST',
      body: JSON.stringify({ projectId, accessToken })
    }),

  getAuthConfig: () =>
    request('/api/auth/config', {
      method: 'GET'
    }),

  getAccessStatus: (projectId: string, token: string) =>
    request('/api/access/status', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
      headers: {
        Authorization: `Bearer ${token}`
      }
    }),

  issuePin: (projectId: string, token: string) =>
    request('/api/pins/issue', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
      headers: {
        Authorization: `Bearer ${token}`
      }
    }),

  verifyPin: (projectId: string, pin: string, token: string) =>
    request('/api/pins/verify', {
      method: 'POST',
      body: JSON.stringify({ projectId, pin }),
      headers: {
        Authorization: `Bearer ${token}`
      }
    }),

  syncProject: (project: any, tracks: any[], token?: string) =>
    request('/api/projects/sync', {
      method: 'POST',
      body: JSON.stringify({ project, tracks }),
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  createProject: (
    options?: {
      ownerUserId?: string;
      title?: string;
      artistName?: string;
    },
    token?: string
  ) =>
    request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(options || {}),
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  deleteProject: (projectId: string, token?: string) =>
    request(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  getProjects: (token?: string) =>
    cachedRequest(`projects:${token || 'public'}`, () =>
      request('/api/projects', {
        method: 'GET',
        headers: token
          ? {
              Authorization: `Bearer ${token}`
            }
          : undefined
      })
    ),

  getProjectSecurityStats: (projectId: string, token?: string) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/security-stats`, {
      method: 'GET',
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  getUnlockActivity: (projectId: string, token?: string) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/unlock-activity`, {
      method: 'GET',
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  getProjectCoverUrl: (projectId: string, token?: string) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/cover-url`, {
      method: 'GET',
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  rotateProjectPins: (projectId: string, token?: string) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/rotate-pins`, {
      method: 'POST',
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  invalidateProjectSessions: (projectId: string, token?: string) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/invalidate-sessions`, {
      method: 'POST',
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  resetProjectCounters: (projectId: string, token?: string) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/reset-counters`, {
      method: 'POST',
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  regenerateProjectSlug: (projectId: string, token?: string) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/regenerate-link`, {
      method: 'POST',
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  updateProjectCover: (projectId: string, coverImageUrl: string, token?: string) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/cover`, {
      method: 'PATCH',
      body: JSON.stringify({ coverImageUrl }),
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  getProjectBySlug: (slug: string) =>
    request(`/api/projects/${encodeURIComponent(slug)}`, {
      method: 'GET'
    }),

  signAssets: (projectId: string, assetRefs: string[], token?: string) =>
    request('/api/assets/sign', {
      method: 'POST',
      body: JSON.stringify({ projectId, assets: assetRefs }),
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  uploadAsset: (
    file: File,
    projectId: string,
    options: {
      assetKind: 'track-audio' | 'track-artwork' | 'project-cover';
      trackId?: string;
      onProgress?: (percent: number) => void;
    }
  ): Promise<{
    assetRef: string;
    storagePath?: string;
    bucket?: string;
    bucketPublic?: boolean;
  }> =>
    new Promise(async (resolve, reject) => {
      const isTrackAudio = options.assetKind === 'track-audio';
      const contentType = String(file.type || '').trim() || (isTrackAudio ? 'audio/mpeg' : 'application/octet-stream');

      const requestPresign = () =>
        request('/api/uploads/presign', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            trackId: options.trackId,
            assetKind: options.assetKind,
            contentType,
            fileName: file.name,
            size: file.size
          })
        });

      const uploadWithConfig = (presign: any) =>
        new Promise<void>((resolveUpload, rejectUpload) => {
          const uploadUrl = String(presign?.uploadUrl || '');
          const assetRef = String(presign?.assetRef || '');
          const method = String(presign?.method || 'PUT').toUpperCase();
          const headers = {
            ...(presign?.headers || {})
          } as Record<string, string>;
          const storage = presign?.storage || 'unknown';
          const cacheControl = String(presign?.cacheControl || '3600');

          if (!uploadUrl || !assetRef) {
            rejectUpload(new Error('Upload configuration missing.'));
            return;
          }

          if (storage === 'supabase') {
            headers['Content-Type'] = contentType;
            if (cacheControl) {
              headers['cache-control'] = cacheControl;
            }
          }

          reportUploadTelemetry({
            stage: 'presign',
            storage,
            assetKind: options.assetKind,
            projectId,
            trackId: options.trackId || null,
            fileName: file.name,
            size: file.size
          });

          const resolvedUploadUrl = /^https?:\/\//i.test(uploadUrl)
            ? uploadUrl
            : `${API_BASE_URL}${uploadUrl}`;

          const xhr = new XMLHttpRequest();
          xhr.open(method, resolvedUploadUrl);
          xhr.responseType = 'json';

          if (options.onProgress) {
            xhr.upload.onprogress = (event) => {
              if (!event.lengthComputable) return;
              const percent = Math.round((event.loaded / event.total) * 100);
              options.onProgress?.(Math.min(100, Math.max(0, percent)));
            };
          }

          Object.entries(headers).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            xhr.setRequestHeader(key, String(value));
          });

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              reportUploadTelemetry({
                stage: 'put',
                status: xhr.status,
                storage,
                assetKind: options.assetKind,
                projectId,
                trackId: options.trackId || null,
                fileName: file.name
              });
              resolveUpload();
              return;
            }
            const data = xhr.response || (() => {
              try {
                return JSON.parse(xhr.responseText || '{}');
              } catch {
                return {};
              }
            })();
            reportUploadTelemetry({
              stage: 'put',
              status: xhr.status,
              storage,
              assetKind: options.assetKind,
              projectId,
              trackId: options.trackId || null,
              fileName: file.name,
              error: data?.message || xhr.responseText || 'upload failed'
            });
            const message = data?.message || `Upload failed (status ${xhr.status})`;
            rejectUpload(new Error(message));
          };

          xhr.onerror = () => {
            reportUploadTelemetry({
              stage: 'put',
              status: xhr.status || 0,
              storage,
              assetKind: options.assetKind,
              projectId,
              trackId: options.trackId || null,
              fileName: file.name,
              error: 'network error'
            });
            rejectUpload(new Error(`Upload failed (status ${xhr.status || 0})`));
          };

          xhr.send(file);
        });

      try {
        const presign = await requestPresign();
        await uploadWithConfig(presign);
        resolve({
          assetRef: String(presign?.assetRef || ''),
          storagePath: String(presign?.storagePath || '').trim() || undefined,
          bucket: String(presign?.bucket || '').trim() || undefined,
          bucketPublic: typeof presign?.bucketPublic === 'boolean' ? presign.bucketPublic : undefined
        });
      } catch (err: any) {
        reject(err);
      }
    }),

  uploadTrackAudio: (
    file: File,
    projectId: string,
    trackId: string,
    onProgress?: (percent: number) => void
  ): Promise<{
    assetRef: string;
    storagePath?: string;
    bucket?: string;
    bucketPublic?: boolean;
  }> =>
    Api.uploadAsset(file, projectId, {
      assetKind: 'track-audio',
      trackId,
      onProgress
    }),

  saveTrackAudioUrl: (
    projectId: string,
    trackId: string,
    payload?: { storagePath?: string | null; trackUrl?: string | null },
    token?: string
  ) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/tracks/${encodeURIComponent(trackId)}/audio-url`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  adminLogin: (password: string) =>
    request('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    })
};

export { API_BASE_URL };
