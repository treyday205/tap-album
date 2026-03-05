const API_BASE_URL = '';

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

  updateProjectCover: (
    projectId: string,
    payload: { coverKey: string; coverMime?: string | null },
    token?: string
  ) =>
    request(`/api/projects/${encodeURIComponent(projectId)}/cover`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    }),

  uploadProjectCoverServer: (
    projectId: string,
    file: File,
    token?: string,
    onProgress?: (percent: number) => void
  ): Promise<any> =>
    new Promise((resolve, reject) => {
      type UploadError = Error & {
        status?: number;
        code?: string;
        hint?: string;
        body?: unknown;
      };

      const buildUploadError = (
        message: string,
        extras: Partial<UploadError> = {}
      ): UploadError => {
        const err = new Error(message) as UploadError;
        if (extras.status !== undefined) err.status = extras.status;
        if (extras.code) err.code = extras.code;
        if (extras.hint) err.hint = extras.hint;
        if (extras.body !== undefined) err.body = extras.body;
        return err;
      };

      const projectKey = String(projectId || '').trim();
      if (!projectKey) {
        reject(buildUploadError('projectId is required.'));
        return;
      }
      if (!(file instanceof File)) {
        reject(buildUploadError('Cover file is required.'));
        return;
      }

      const formData = new FormData();
      formData.append('file', file, file.name || 'cover');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE_URL}/api/projects/${encodeURIComponent(projectKey)}/cover-upload`);
      xhr.withCredentials = true;
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (onProgress) {
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(Math.min(100, Math.max(0, percent)));
        };
      }

      xhr.onload = () => {
        const payloadText = String(xhr.responseText || '').trim();
        const payload = (() => {
          if (!payloadText) return {};
          try {
            return JSON.parse(payloadText);
          } catch {
            return { message: payloadText };
          }
        })();

        if (xhr.status >= 200 && xhr.status < 300) {
          reportUploadTelemetry({
            stage: 'cover-upload-server',
            status: xhr.status,
            projectId: projectKey,
            fileName: file.name,
            size: file.size
          });
          resolve(payload);
          return;
        }

        reportUploadTelemetry({
          stage: 'cover-upload-server-failed',
          status: xhr.status,
          projectId: projectKey,
          fileName: file.name,
          size: file.size,
          error: String((payload as any)?.message || payloadText || `Upload failed (status ${xhr.status})`)
        });
        reject(
          buildUploadError(
            String((payload as any)?.message || `Upload failed (status ${xhr.status})`),
            {
              status: xhr.status,
              code: 'COVER_UPLOAD_SERVER_FAILED',
              body: payload
            }
          )
        );
      };

      xhr.onerror = () => {
        reportUploadTelemetry({
          stage: 'cover-upload-server-failed',
          status: 0,
          projectId: projectKey,
          fileName: file.name,
          size: file.size,
          error: 'CORS/Network blocked'
        });
        reject(
          buildUploadError('CORS/Network blocked', {
            status: 0,
            code: 'COVER_UPLOAD_SERVER_FAILED',
            hint: 'CORS/Network blocked'
          })
        );
      };

      xhr.send(formData);
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
      trackNumber?: number;
      title?: string;
      onProgress?: (percent: number) => void;
    }
  ): Promise<{
    assetRef: string;
    storagePath?: string;
    bucket?: string;
    contentType?: string;
  }> =>
    new Promise(async (resolve, reject) => {
      type UploadError = Error & {
        status?: number;
        code?: string;
        hint?: string;
      };

      const buildUploadError = (
        message: string,
        extras: Partial<UploadError> = {}
      ): UploadError => {
        const err = new Error(message) as UploadError;
        if (extras.status !== undefined) err.status = extras.status;
        if (extras.code) err.code = extras.code;
        if (extras.hint) err.hint = extras.hint;
        return err;
      };

      const isTrackAudio = options.assetKind === 'track-audio';
      const isProjectCover = options.assetKind === 'project-cover';
      const browserContentType = String(file.type || '').trim();

      if (isProjectCover && !browserContentType) {
        reject(buildUploadError('Cover file type missing.'));
        return;
      }

      const contentType = browserContentType || (isTrackAudio ? 'audio/mpeg' : 'application/octet-stream');

      const requestPresign = () =>
        request('/api/uploads/presign', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            trackId: options.trackId,
            trackNumber: options.trackNumber,
            title: options.title,
            assetKind: options.assetKind,
            contentType,
            fileName: file.name,
            size: file.size
          })
        });

      const uploadWithConfig = async (presign: any) => {
        const uploadUrl = String(presign?.uploadUrl || '');
        const assetRef = String(presign?.assetRef || '');
        const method = String(presign?.method || 'PUT').toUpperCase();
        const storage = presign?.storage || 'unknown';

        if (!uploadUrl || !assetRef) {
          throw buildUploadError('Upload configuration missing.');
        }

        const resolvedUploadUrl = /^https?:\/\//i.test(uploadUrl)
          ? uploadUrl
          : `${API_BASE_URL}${uploadUrl}`;
        const uploadHost = (() => {
          try {
            return new URL(resolvedUploadUrl).host;
          } catch {
            return null;
          }
        })();

        const putContentType = String(
          (isProjectCover ? browserContentType : '') ||
          presign?.contentType ||
          contentType
        ).trim();

        if (!putContentType) {
          throw buildUploadError('Upload MIME type missing.');
        }

        reportUploadTelemetry({
          stage: 'presign',
          storage,
          assetKind: options.assetKind,
          projectId,
          trackId: options.trackId || null,
          fileName: file.name,
          size: file.size,
          uploadHost
        });

        if (options.onProgress) {
          await new Promise<void>((resolveUpload, rejectUpload) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, resolvedUploadUrl);
            xhr.responseType = 'json';

            xhr.upload.onprogress = (event) => {
              if (!event.lengthComputable) return;
              const percent = Math.round((event.loaded / event.total) * 100);
              options.onProgress?.(Math.min(100, Math.max(0, percent)));
            };

            xhr.setRequestHeader('Content-Type', putContentType);

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                reportUploadTelemetry({
                  stage: 'put',
                  status: xhr.status,
                  storage,
                  uploadHost,
                  assetKind: options.assetKind,
                  projectId,
                  trackId: options.trackId || null,
                  fileName: file.name
                });
                resolveUpload();
                return;
              }

              const bodyText = String(xhr.responseText || '').trim();
              console.error('UPLOAD_PUT_FAILED', {
                assetKind: options.assetKind,
                projectId,
                trackId: options.trackId || null,
                uploadHost,
                status: xhr.status,
                bodyText
              });
              reportUploadTelemetry({
                stage: 'put_failed',
                status: xhr.status,
                storage,
                uploadHost,
                assetKind: options.assetKind,
                projectId,
                trackId: options.trackId || null,
                fileName: file.name,
                error: bodyText || `Upload failed (status ${xhr.status})`
              });
              rejectUpload(
                buildUploadError(bodyText || `Upload failed (status ${xhr.status})`, {
                  status: xhr.status,
                  code: 'UPLOAD_PUT_FAILED'
                })
              );
            };

            xhr.onerror = () => {
              console.error('UPLOAD_PUT_FAILED', {
                assetKind: options.assetKind,
                projectId,
                trackId: options.trackId || null,
                uploadHost,
                status: 0,
                error: 'CORS/Network blocked'
              });
              reportUploadTelemetry({
                stage: 'put_failed',
                status: 0,
                storage,
                uploadHost,
                assetKind: options.assetKind,
                projectId,
                trackId: options.trackId || null,
                fileName: file.name,
                error: 'CORS/Network blocked'
              });
              rejectUpload(
                buildUploadError('CORS/Network blocked', {
                  status: 0,
                  code: 'UPLOAD_PUT_FAILED',
                  hint: 'CORS/Network blocked'
                })
              );
            };

            xhr.send(file);
          });
          return;
        }

        let response: Response;
        try {
          response = await fetch(resolvedUploadUrl, {
            method,
            body: file,
            headers: {
              'Content-Type': putContentType
            }
          });
        } catch {
          console.error('UPLOAD_PUT_FAILED', {
            assetKind: options.assetKind,
            projectId,
            trackId: options.trackId || null,
            uploadHost,
            status: 0,
            error: 'CORS/Network blocked'
          });
          reportUploadTelemetry({
            stage: 'put_failed',
            status: 0,
            storage,
            uploadHost,
            assetKind: options.assetKind,
            projectId,
            trackId: options.trackId || null,
            fileName: file.name,
            error: 'CORS/Network blocked'
          });
          throw buildUploadError('CORS/Network blocked', {
            status: 0,
            code: 'UPLOAD_PUT_FAILED',
            hint: 'CORS/Network blocked'
          });
        }

        if (!response.ok) {
          const bodyText = (await response.text().catch(() => '')).trim();
          console.error('UPLOAD_PUT_FAILED', {
            assetKind: options.assetKind,
            projectId,
            trackId: options.trackId || null,
            uploadHost,
            status: response.status,
            bodyText
          });
          reportUploadTelemetry({
            stage: 'put_failed',
            status: response.status,
            storage,
            uploadHost,
            assetKind: options.assetKind,
            projectId,
            trackId: options.trackId || null,
            fileName: file.name,
            error: bodyText || `Upload failed (status ${response.status})`
          });
          throw buildUploadError(bodyText || `Upload failed (status ${response.status})`, {
            status: response.status,
            code: 'UPLOAD_PUT_FAILED'
          });
        }

        reportUploadTelemetry({
          stage: 'put',
          status: response.status,
          storage,
          uploadHost,
          assetKind: options.assetKind,
          projectId,
          trackId: options.trackId || null,
          fileName: file.name
        });
      };

      try {
        const presign = await requestPresign();
        await uploadWithConfig(presign);
        resolve({
          assetRef: String(presign?.assetRef || ''),
          storagePath: String(presign?.storagePath || '').trim() || undefined,
          bucket: String(presign?.bucket || '').trim() || undefined,
          contentType: String(presign?.contentType || '').trim() || undefined
        });
      } catch (err: any) {
        reject(err);
      }
    }),

  uploadTrackAudio: (
    file: File,
    projectId: string,
    trackId: string,
    metadata?: { trackNumber?: number; title?: string },
    onProgress?: (percent: number) => void
  ): Promise<{
    assetRef: string;
    storagePath?: string;
    bucket?: string;
    contentType?: string;
  }> =>
    Api.uploadAsset(file, projectId, {
      assetKind: 'track-audio',
      trackId,
      trackNumber: metadata?.trackNumber,
      title: metadata?.title,
      onProgress
    }),

  saveTrackAudioUrl: (
    projectId: string,
    trackId: string,
    payload?: {
      storagePath?: string | null;
      audioKey?: string | null;
      trackUrl?: string | null;
      title?: string | null;
      trackNumber?: number | null;
      trackNo?: number | null;
    },
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
