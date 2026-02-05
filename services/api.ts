const resolveApiBase = (): string => {
  const envBase =
    (process.env as any).API_BASE_URL ||
    (import.meta as any).env?.API_BASE_URL ||
    (import.meta as any).env?.VITE_API_BASE_URL ||
    (import.meta as any).env?.VITE_API_URL;
  const isProd = Boolean((import.meta as any).env?.PROD) || process.env.NODE_ENV === 'production';

  if (envBase) {
    const normalized = String(envBase).trim();
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(normalized);
    const isRelative = normalized.startsWith('/');
    if (!isProd || (!isLocalhost && !isRelative)) {
      return normalized;
    }
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return isProd ? '' : 'http://localhost:3000';
};

const API_BASE_URL = resolveApiBase();

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
    const message = data?.message || 'Request failed.';
    throw new Error(message);
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

  syncProject: (project: any, tracks: any[]) =>
    request('/api/projects/sync', {
      method: 'POST',
      body: JSON.stringify({ project, tracks })
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
  ): Promise<{ assetRef: string }> =>
    new Promise(async (resolve, reject) => {
      const contentType = file.type || 'application/octet-stream';

      const requestPresign = (preferLocal = false) =>
        request('/api/uploads/presign', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            trackId: options.trackId,
            assetKind: options.assetKind,
            contentType,
            fileName: file.name,
            size: file.size,
            preferLocal
          })
        });

      const uploadWithConfig = (presign: any) =>
        new Promise<void>((resolveUpload, rejectUpload) => {
          const uploadUrl = String(presign?.uploadUrl || '');
          const assetRef = String(presign?.assetRef || '');
          const method = String(presign?.method || 'PUT').toUpperCase();
          const headers = presign?.headers || {};

          if (!uploadUrl || !assetRef) {
            rejectUpload(new Error('Upload configuration missing.'));
            return;
          }

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
            rejectUpload(new Error(data?.message || 'Upload failed.'));
          };

          xhr.onerror = () => rejectUpload(new Error('Upload failed.'));
          xhr.send(file);
        });

      try {
        const presign = await requestPresign(false);
        await uploadWithConfig(presign);
        resolve({ assetRef: String(presign?.assetRef || '') });
      } catch (err: any) {
        try {
          const presignFallback = await requestPresign(true);
          await uploadWithConfig(presignFallback);
          resolve({ assetRef: String(presignFallback?.assetRef || '') });
        } catch (fallbackErr: any) {
          reject(fallbackErr);
        }
      }
    }),

  uploadTrackAudio: (
    file: File,
    projectId: string,
    trackId: string,
    onProgress?: (percent: number) => void
  ): Promise<{ assetRef: string }> =>
    Api.uploadAsset(file, projectId, {
      assetKind: 'track-audio',
      trackId,
      onProgress
    }),

  adminLogin: (password: string) =>
    request('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    })
};

export { API_BASE_URL };
