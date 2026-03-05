
import React, { useState, useEffect, useRef, Suspense, lazy, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ChevronLeft, Globe, Music, Link as LinkIcon,
  Camera, MonitorSmartphone, ShieldAlert
} from 'lucide-react';
import { StorageService } from '../services/storage';
import { Api } from '../services/api';
import { Project, Track, ProjectLink, LinkCategory } from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import {
  collectAssetRefs,
  getAssetKey,
  isAssetRef,
  resolveAssetUrl
} from '../services/assets';
import { collectBankRefs, resolveBankUrls } from '../services/assetBank';
import {
  applyTrackStorageRecoveries,
  collectTrackStorageRecoveries,
  type TrackStorageRecovery
} from '../services/trackStorageRecovery';
import {
  createTrackAudioUrlResolver,
  DEFAULT_TRACK_STORAGE,
  type SignedTrackUrlCache
} from '../services/trackAudio';
import ResponsiveImage from '../components/ResponsiveImage';

const TracklistTab = lazy(() => import('../components/editor/EditorTracklistTab'));
const LinksTab = lazy(() => import('../components/editor/EditorLinksTab'));
const SecurityTab = lazy(() => import('../components/editor/EditorSecurityTab'));
const DistributionV2 = lazy(() => import('../components/editor/EditorDistributionV2'));
const DevicePreview = lazy(() => import('../components/editor/EditorDevicePreview'));

const parseOptionalBooleanFlag = (value: unknown): boolean | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
};

const EditorPage: React.FC = () => {
  const MAX_TRACKS = 24;
  const DEFAULT_SECURITY_LIMIT = 1_000_000;
  const SECURITY_V2_ENV =
    String(import.meta.env?.VITE_SECURITY_V2 || '').toLowerCase() === 'true';
  const SECURITY_V2_OVERRIDE =
    typeof window !== 'undefined' ? localStorage.getItem('SECURITY_V2') : null;
  const SECURITY_V2_OVERRIDE_VALUE =
    SECURITY_V2_OVERRIDE === 'true' ? true : SECURITY_V2_OVERRIDE === 'false' ? false : null;
  const SECURITY_V2_ENABLED =
    SECURITY_V2_OVERRIDE_VALUE ?? SECURITY_V2_ENV;
  const UPLOAD_PER_TRACK_ENV = parseOptionalBooleanFlag(
    String(import.meta.env?.VITE_UPLOAD_PER_TRACK || '').trim()
  );
  const UPLOAD_PER_TRACK_FALLBACK = import.meta.env.PROD ? true : false;
  const UPLOAD_PER_TRACK_OVERRIDE =
    typeof window !== 'undefined' ? localStorage.getItem('UPLOAD_PER_TRACK') : null;
  const UPLOAD_PER_TRACK_OVERRIDE_VALUE = parseOptionalBooleanFlag(UPLOAD_PER_TRACK_OVERRIDE);
  const uploadPerTrackEnabled =
    UPLOAD_PER_TRACK_OVERRIDE_VALUE ?? UPLOAD_PER_TRACK_ENV ?? UPLOAD_PER_TRACK_FALLBACK;
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  
  const projectImageInputRef = useRef<HTMLInputElement>(null);
  const trackImageInputRef = useRef<HTMLInputElement>(null);
  const trackAudioInputRef = useRef<HTMLInputElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  
  const [uploadTargetTrackId, setUploadTargetTrackId] = useState<string | null>(null);
  const [resolvingTrackId, setResolvingTrackId] = useState<string | null>(null);
  const [previewingTrackId, setPreviewingTrackId] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [downloadingTrackId, setDownloadingTrackId] = useState<string | null>(null);
  const [downloadSuccessId, setDownloadSuccessId] = useState<string | null>(null);
  const [savingUrlTrackId, setSavingUrlTrackId] = useState<string | null>(null);
  const [copiedUrlTrackId, setCopiedUrlTrackId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [uploadingTrackId, setUploadingTrackId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const signedAssetRequestsRef = useRef(new Set<string>());
  const bankAssetRequestsRef = useRef(new Set<string>());
  const signedTrackAudioUrlsRef = useRef<SignedTrackUrlCache>({});
  
  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [links, setLinks] = useState<ProjectLink[]>([]);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [activeTab, setActiveTab] = useState<'general' | 'tracks' | 'links' | 'security'>('general');
  const [isSaved, setIsSaved] = useState(true);
  const [showMobilePreview, setShowMobilePreview] = useState(true);
  const [accessStatus, setAccessStatus] = useState<{
    verified: boolean;
    unlocked: boolean;
    remaining: number;
    hasActivePin: boolean;
    projectUnlocksUsed?: number;
    projectUnlocksRemaining?: number;
    projectUnlocksLimit?: number;
    projectActivePinsUsed?: number;
    projectActivePinsRemaining?: number;
    projectActivePinsLimit?: number;
  } | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [projectSecurityStats, setProjectSecurityStats] = useState<{
    pinUnlockUsed: number;
    pinUnlockRemaining: number;
    pinUnlockLimit: number;
    pinActiveUsed: number;
    pinActiveRemaining: number;
    pinActiveLimit: number;
  } | null>(null);
  const [projectSecurityLoading, setProjectSecurityLoading] = useState(false);
  const [projectSecurityError, setProjectSecurityError] = useState<string | null>(null);
  const [unlockActivity, setUnlockActivity] = useState<Array<{ email: string; unlockedAt: string | null; ip?: string | null; userAgent?: string | null }>>([]);
  const [unlockActivityLoading, setUnlockActivityLoading] = useState(false);
  const [unlockActivityError, setUnlockActivityError] = useState<string | null>(null);
  const [syncTick, setSyncTick] = useState(0);
  const syncTimeoutRef = useRef<number | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const copiedUrlTimeoutRef = useRef<number | null>(null);
  const storageRecoveryToastShownRef = useRef(false);
  const storageRecoveryQueueRef = useRef(new Map<string, TrackStorageRecovery>());
  const storageRecoveryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[DEV] Security tab mode:', SECURITY_V2_ENABLED ? 'V2' : 'V1');
      console.log('[DEV] Upload per-track mode:', uploadPerTrackEnabled ? 'on' : 'off');
    }
  }, [SECURITY_V2_ENABLED, uploadPerTrackEnabled]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
      if (copiedUrlTimeoutRef.current) {
        window.clearTimeout(copiedUrlTimeoutRef.current);
      }
      if (storageRecoveryTimerRef.current) {
        window.clearTimeout(storageRecoveryTimerRef.current);
      }
    };
  }, []);

  const toSafeNonNegativeNumber = (value: unknown, fallback = 0) => {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
      return fallback;
    }
    return Math.floor(normalized);
  };

  const fallbackProjectSecurityStats = project
    ? (() => {
        const pinUnlockLimit = toSafeNonNegativeNumber(project.pinUnlockLimit, DEFAULT_SECURITY_LIMIT);
        const pinUnlockUsed = toSafeNonNegativeNumber(project.pinUnlockCount, 0);
        const pinUnlockRemainingRaw = project.pinUnlockRemaining;
        const pinUnlockRemaining = Number.isFinite(Number(pinUnlockRemainingRaw))
          ? toSafeNonNegativeNumber(pinUnlockRemainingRaw, Math.max(0, pinUnlockLimit - pinUnlockUsed))
          : Math.max(0, pinUnlockLimit - pinUnlockUsed);
        const pinActiveLimit = toSafeNonNegativeNumber(project.pinActiveLimit, DEFAULT_SECURITY_LIMIT);
        const pinActiveUsed = toSafeNonNegativeNumber(project.pinActiveCount, 0);
        const pinActiveRemainingRaw = project.pinActiveRemaining;
        const pinActiveRemaining = Number.isFinite(Number(pinActiveRemainingRaw))
          ? toSafeNonNegativeNumber(pinActiveRemainingRaw, Math.max(0, pinActiveLimit - pinActiveUsed))
          : Math.max(0, pinActiveLimit - pinActiveUsed);

        return {
          pinUnlockUsed,
          pinUnlockRemaining,
          pinUnlockLimit,
          pinActiveUsed,
          pinActiveRemaining,
          pinActiveLimit
        };
      })()
    : null;

  const effectiveProjectSecurityStats = projectSecurityStats || fallbackProjectSecurityStats;

  useEffect(() => {
    if (projectId) {
      setIsLoadingProject(true);
      const p = StorageService.getProjectById(projectId);
      if (p) {
        setProject(p);
        setTracks(StorageService.getTracks(projectId));
        setLinks(StorageService.getLinks(projectId));
      } else {
        navigate('/control-admin/dashboard');
      }
      setIsLoadingProject(false);
    }
  }, [projectId, navigate]);

  useEffect(() => {
    storageRecoveryToastShownRef.current = false;
    storageRecoveryQueueRef.current.clear();
    if (storageRecoveryTimerRef.current) {
      window.clearTimeout(storageRecoveryTimerRef.current);
      storageRecoveryTimerRef.current = null;
    }
  }, [projectId]);

  useEffect(() => {
    if (activeTab !== 'security' || !project) return;
    const adminToken = localStorage.getItem('tap_admin_token') || undefined;
    if (!adminToken && !import.meta.env.DEV) {
      setProjectSecurityError('Admin token required to load album security stats.');
      setProjectSecurityStats(null);
      return;
    }

    setProjectSecurityLoading(true);
    setProjectSecurityError(null);
    Api.getProjectSecurityStats(project.projectId, adminToken)
      .then((stats) => {
        setProjectSecurityStats({
          pinUnlockUsed: toSafeNonNegativeNumber(stats?.pinUnlockUsed, 0),
          pinUnlockRemaining: toSafeNonNegativeNumber(stats?.pinUnlockRemaining, DEFAULT_SECURITY_LIMIT),
          pinUnlockLimit: toSafeNonNegativeNumber(stats?.pinUnlockLimit, DEFAULT_SECURITY_LIMIT),
          pinActiveUsed: toSafeNonNegativeNumber(stats?.pinActiveUsed, 0),
          pinActiveRemaining: toSafeNonNegativeNumber(stats?.pinActiveRemaining, DEFAULT_SECURITY_LIMIT),
          pinActiveLimit: toSafeNonNegativeNumber(stats?.pinActiveLimit, DEFAULT_SECURITY_LIMIT)
        });
      })
      .catch((err) => {
        setProjectSecurityStats(null);
        setProjectSecurityError(err.message || 'Unable to load album security stats.');
      })
      .finally(() => setProjectSecurityLoading(false));
  }, [activeTab, project?.projectId, syncTick]);

  useEffect(() => {
    if (activeTab !== 'security' || !project) return;
    const token = localStorage.getItem('tap_auth_token');
    if (!token) {
      setAccessStatus(null);
      setAccessError(null);
      return;
    }

    setAccessLoading(true);
    setAccessError(null);
    Api.getAccessStatus(project.projectId, token)
      .then((status) => setAccessStatus(status))
      .catch((err) => setAccessError(err.message || 'Unable to load access status.'))
      .finally(() => setAccessLoading(false));
  }, [activeTab, project?.projectId, syncTick]);

  const handleRetrySecurityStats = () => {
    setProjectSecurityError(null);
    setProjectSecurityStats(null);
    setSyncTick((tick) => tick + 1);
  };

  const handleRetryAccessStatus = () => {
    setAccessError(null);
    setAccessStatus(null);
    setSyncTick((tick) => tick + 1);
  };

  useEffect(() => {
    if (!SECURITY_V2_ENABLED || activeTab !== 'security' || !project) return;
    const adminToken = localStorage.getItem('tap_admin_token') || undefined;
    if (!adminToken && !import.meta.env.DEV) {
      setUnlockActivityError('Admin token required to load unlock activity.');
      setUnlockActivity([]);
      return;
    }
    setUnlockActivityLoading(true);
    setUnlockActivityError(null);
    Api.getUnlockActivity(project.projectId, adminToken)
      .then((data) => setUnlockActivity(Array.isArray(data?.activity) ? data.activity : []))
      .catch((err) => {
        setUnlockActivity([]);
        setUnlockActivityError(err.message || 'Unable to load unlock activity.');
      })
      .finally(() => setUnlockActivityLoading(false));
  }, [SECURITY_V2_ENABLED, activeTab, project?.projectId, syncTick]);

  const resolveAsset = useCallback((value: string) => resolveAssetUrl(value, assetUrls), [assetUrls]);

  const resolveTrackAudioForPreview = useCallback(
    createTrackAudioUrlResolver({
      storage: DEFAULT_TRACK_STORAGE,
      cache: signedTrackAudioUrlsRef.current,
      resolveAssetUrl: resolveAsset,
      resolveBankAssetUrls: resolveBankUrls,
      onBankAssetsResolved: (resolved) => {
        if (Object.keys(resolved).length > 0) {
          setAssetUrls((prev) => ({ ...prev, ...resolved }));
        }
      },
      resolveSignedStorageUrl: async ({ track, storagePath, bucket, forceRefresh, reason }) => {
        const normalizedProjectId = String(projectId || '').trim();
        const normalizedTrackId = String(track.trackId || '').trim();
        const normalizedStoragePath = String(storagePath || '').trim();
        if (!normalizedProjectId || !normalizedTrackId || !normalizedStoragePath) {
          return null;
        }

        const adminToken = localStorage.getItem('tap_admin_token') || undefined;
        if (!adminToken && !import.meta.env.DEV) {
          return null;
        }

        try {
          const response = await Api.saveTrackAudioUrl(
            normalizedProjectId,
            normalizedTrackId,
            {
              storagePath: normalizedStoragePath
            },
            adminToken
          );
          const payload = response?.track || {};
          const resolvedUrl = String(payload.audioUrl || payload.audio_url || '').trim();
          const resolvedBucket = String(
            payload.storageBucket || payload.storage_bucket || bucket || ''
          ).trim();
          if (import.meta.env.DEV) {
            console.log('[DEV][AUDIO] backend signed preview URL', {
              projectId: normalizedProjectId,
              trackId: normalizedTrackId,
              storagePath: normalizedStoragePath,
              storageBucket: resolvedBucket || null,
              reason,
              forceRefresh: Boolean(forceRefresh),
              url: resolvedUrl || null
            });
          }
          return resolvedUrl ? { url: resolvedUrl } : null;
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn('[DEV][AUDIO] backend signed preview URL failed', {
              projectId: normalizedProjectId,
              trackId: normalizedTrackId,
              storagePath: normalizedStoragePath,
              storageBucket: bucket || null,
              reason,
              forceRefresh: Boolean(forceRefresh),
              error: String((error as { message?: string } | null)?.message || error || 'unknown')
            });
          }
          return null;
        }
      },
      onResolvedUrl: ({ track: resolvedTrack, url, source, reason, storagePath, storageBucket, resolveMode, fromCache }) => {
        if (!import.meta.env.DEV) return;
        console.log('[DEV][AUDIO] preview resolved-track-url', {
          projectId: projectId || null,
          trackId: resolvedTrack.trackId,
          title: resolvedTrack.title,
          reason,
          source,
          resolveMode: resolveMode || null,
          storageBucket: storageBucket || null,
          storagePath: storagePath || null,
          fromCache,
          url
        });
      }
    }),
    [projectId, resolveAsset]
  );

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 2200);
  }, []);

  const flushStorageRecoveryQueue = useCallback(async (targetProjectId: string) => {
    const projectKey = String(targetProjectId || '').trim();
    if (!projectKey) return;

    const queued = Array.from<TrackStorageRecovery>(storageRecoveryQueueRef.current.values());
    storageRecoveryQueueRef.current.clear();
    if (queued.length === 0) return;

    const token = localStorage.getItem('tap_admin_token') || undefined;
    if (!token && !import.meta.env.DEV) {
      return;
    }

    const results = await Promise.allSettled(
      queued.map((item) =>
        Api.saveTrackAudioUrl(
          projectKey,
          item.trackId,
          {
            storagePath: item.storagePath,
            trackUrl: item.trackUrl
          },
          token
        )
      )
    );

    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0 && import.meta.env.DEV) {
      console.warn('[DEV] silent track storage recovery persist failed', {
        projectId: projectKey,
        attempted: queued.length,
        failed
      });
    }
  }, []);

  const queueStorageRecoveryPersist = useCallback((
    targetProjectId: string,
    recoveries: TrackStorageRecovery[]
  ) => {
    const projectKey = String(targetProjectId || '').trim();
    if (!projectKey || recoveries.length === 0) return;

    recoveries.forEach((item) => {
      storageRecoveryQueueRef.current.set(item.trackId, item);
    });

    if (storageRecoveryTimerRef.current) {
      window.clearTimeout(storageRecoveryTimerRef.current);
    }
    storageRecoveryTimerRef.current = window.setTimeout(() => {
      storageRecoveryTimerRef.current = null;
      void flushStorageRecoveryQueue(projectKey);
    }, 900);
  }, [flushStorageRecoveryQueue]);

  const copyTextToClipboard = async (value: string) => {
    const text = String(value || '').trim();
    if (!text) {
      throw new Error('Track URL is empty.');
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'true');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const didCopy = document.execCommand('copy');
    document.body.removeChild(area);
    if (!didCopy) {
      throw new Error('Clipboard access failed.');
    }
  };

  useEffect(() => {
    if (!projectId || tracks.length === 0) return;

    const recoveries = collectTrackStorageRecoveries(tracks);
    if (recoveries.length === 0) return;

    const { tracks: recoveredTracks, recoveredCount } = applyTrackStorageRecoveries(tracks, recoveries);
    if (recoveredCount === 0) return;

    setTracks(recoveredTracks);
    const recoveredTrackIds = new Set(recoveries.map((item) => item.trackId));
    recoveredTracks.forEach((track) => {
      if (recoveredTrackIds.has(track.trackId)) {
        StorageService.saveTrack(track);
      }
    });

    queueStorageRecoveryPersist(projectId, recoveries);

    if (!storageRecoveryToastShownRef.current) {
      storageRecoveryToastShownRef.current = true;
      showToast(`Recovered ${recoveredCount} track${recoveredCount === 1 ? '' : 's'}`);
    }

    if (import.meta.env.DEV) {
      console.log('[DEV] silent storage path recovery applied', {
        projectId,
        recoveredCount,
        recoveries: recoveries.map((item) => ({
          trackId: item.trackId,
          bucket: item.bucket,
          storagePath: item.storagePath
        }))
      });
    }
  }, [projectId, tracks, queueStorageRecoveryPersist, showToast]);

  const ensureSignedAssets = async (refs: string[]) => {
    if (!project) return;
    const missing = refs
      .filter((ref) => isAssetRef(ref) && !assetUrls[ref])
      .filter((ref) => !signedAssetRequestsRef.current.has(ref));
    if (missing.length === 0) return;
    missing.forEach((ref) => signedAssetRequestsRef.current.add(ref));
    try {
      const token =
        localStorage.getItem('tap_admin_token') ||
        localStorage.getItem('tap_auth_token') ||
        undefined;
      const response = await Api.signAssets(project.projectId, missing, token);
      const next = { ...assetUrls };
      (response.assets || []).forEach((asset: any) => {
        if (asset?.ref && asset?.url) {
          next[asset.ref] = asset.url;
        }
      });
      setAssetUrls(next);
    } catch (err) {
      missing.forEach((ref) => signedAssetRequestsRef.current.delete(ref));
      if (import.meta.env.DEV) {
        console.warn('[DEV] asset signing failed', err);
      }
    }
  };

  const ensureBankAssets = async (refs: string[]) => {
    const missing = refs
      .filter((ref) => !assetUrls[ref])
      .filter((ref) => !bankAssetRequestsRef.current.has(ref));
    if (missing.length === 0) return;
    missing.forEach((ref) => bankAssetRequestsRef.current.add(ref));
    try {
      const resolved = await resolveBankUrls(missing);
      if (Object.keys(resolved).length > 0) {
        setAssetUrls((prev) => ({ ...prev, ...resolved }));
      }
    } catch (err) {
      missing.forEach((ref) => bankAssetRequestsRef.current.delete(ref));
      if (import.meta.env.DEV) {
        console.warn('[DEV] bank asset resolution failed', err);
      }
    }
  };

  const defaultStorageBucket = String(DEFAULT_TRACK_STORAGE.bucket || '').trim() || 'tap-album';
  const ASSET_KEY_REGEX = /^[a-z0-9/_\-.]+$/i;

  const deriveTrackStorageTarget = (value: string | undefined | null) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;

    if (isAssetRef(trimmed)) {
      return {
        bucket: defaultStorageBucket,
        storagePath: getAssetKey(trimmed)
      };
    }

    if (
      ASSET_KEY_REGEX.test(trimmed) &&
      trimmed.includes('/') &&
      !trimmed.includes('..') &&
      !/^https?:\/\//i.test(trimmed)
    ) {
      return {
        bucket: defaultStorageBucket,
        storagePath: trimmed
      };
    }

    return null;
  };

  const storagePathFromTrackValue = (value: string | undefined | null) =>
    deriveTrackStorageTarget(value)?.storagePath || '';

  useEffect(() => {
    if (!project) return;
    const values = [
      project.coverImageUrl,
      ...tracks.map((track) => track.audioUrl),
      ...tracks.map((track) => track.mp3Url),
      ...tracks.map((track) => track.artworkUrl)
    ];
    const signedRefs = collectAssetRefs(values);
    if (signedRefs.length) {
      ensureSignedAssets(signedRefs);
    }
    const bankRefs = collectBankRefs(values);
    if (bankRefs.length) {
      ensureBankAssets(bankRefs);
    }
  }, [project, tracks, syncTick]);

  useEffect(() => {
    if (!project) return;
    if (syncTimeoutRef.current) {
      window.clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = window.setTimeout(() => {
      const adminToken = localStorage.getItem('tap_admin_token') || undefined;
      Api.syncProject(project, tracks, adminToken)
        .then(() => setSyncTick((tick) => tick + 1))
        .catch((err: any) => {
          const message = String(err?.message || '');
          if (message.toLowerCase().includes('project not found')) {
            StorageService.deleteProject(project.projectId);
            navigate('/control-admin/dashboard');
            return;
          }
          if (import.meta.env.DEV) {
            console.warn('[DEV] project sync failed', message || err);
          }
        });
    }, 800);

    return () => {
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [project, tracks, navigate]);

  const handleSaveProject = (updates: Partial<Project>) => {
    if (project) {
      const updated = { ...project, ...updates };
      setProject(updated);
      StorageService.saveProject(updated);
      setIsSaved(false);
      setTimeout(() => setIsSaved(true), 1500);
    }
  };

  const handleInvalidateSessions = async () => {
    if (!project) return;
    if (!confirm('Invalidate all sessions and clear unlock records for this album?')) return;
    try {
      const token = localStorage.getItem('tap_admin_token') || undefined;
      await Api.invalidateProjectSessions(project.projectId, token);
      setSyncTick((tick) => tick + 1);
    } catch (err: any) {
      alert(err?.message || 'Unable to invalidate sessions.');
    }
  };

  const handleResetCounters = async () => {
    if (!project) return;
    if (!confirm('Reset unlock and active PIN counters?')) return;
    try {
      const token = localStorage.getItem('tap_admin_token') || undefined;
      await Api.resetProjectCounters(project.projectId, token);
      setSyncTick((tick) => tick + 1);
    } catch (err: any) {
      alert(err?.message || 'Unable to reset counters.');
    }
  };

  const handleRotatePins = async () => {
    if (!project) return;
    if (!confirm('Rotate PINs and invalidate all active pins?')) return;
    try {
      const token = localStorage.getItem('tap_admin_token') || undefined;
      await Api.rotateProjectPins(project.projectId, token);
      setSyncTick((tick) => tick + 1);
    } catch (err: any) {
      alert(err?.message || 'Unable to rotate pins.');
    }
  };

  const handleRegenerateLink = async () => {
    if (!project) return;
    if (!confirm('Regenerate secure link (album slug)? This will change the public URL.')) return;
    try {
      const token = localStorage.getItem('tap_admin_token') || undefined;
      const response = await Api.regenerateProjectSlug(project.projectId, token);
      if (response?.slug) {
        handleSaveProject({ slug: response.slug });
      }
      setSyncTick((tick) => tick + 1);
    } catch (err: any) {
      alert(err?.message || 'Unable to regenerate link.');
    }
  };

  const getUploadErrorMessage = (err: any, fallback = 'Upload failed.') => {
    const status = Number(err?.status);
    if (Number.isFinite(status) && status === 0) {
      return 'CORS/Network blocked';
    }
    const hint = String(err?.hint || '').trim();
    if (hint) {
      return hint;
    }
    const message = String(err?.message || '').trim();
    return message || fallback;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'PROJECT_IMAGE' | 'TRACK_IMAGE' | 'TRACK_AUDIO') => {
    const inputFiles = e.target.files;
    if (!inputFiles || inputFiles.length === 0) {
      if (import.meta.env.DEV) {
        console.warn('[DEV] upload canceled', { type });
      }
      return;
    }
    const files: File[] = Array.from(inputFiles);
    setUploadError(null);

    const isAudioUpload = type === 'TRACK_AUDIO';
    const autoTitle = (name: string) => name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'New Track';
    const limit = isAudioUpload ? 1024 * 1024 * 1024 : 10 * 1024 * 1024;
    const oversize = files.find((file) => file.size > limit);
    if (oversize) {
      const message = isAudioUpload
        ? 'For audio files, please keep them under 1GB or use external links.'
        : 'For images, please keep them under 10MB.';
      alert(`File is too large (${(oversize.size / 1024 / 1024).toFixed(1)}MB). ${message}`);
      e.target.value = '';
      return;
    }

    if (type === 'TRACK_AUDIO') {
      if (!uploadTargetTrackId || !projectId) {
        alert('Select a track before uploading audio.');
        e.target.value = '';
        return;
      }

      const targetTrackId = uploadTargetTrackId;
      const isPerTrackMode = uploadPerTrackEnabled;
      let selectedFiles = files;
      if (isPerTrackMode && selectedFiles.length > 1) {
        selectedFiles = selectedFiles.slice(0, 1);
        alert('Per-track upload accepts one MP3 at a time.');
      }

      if (!isPerTrackMode) {
        const maxNewTracks = Math.max(0, MAX_TRACKS - tracks.length);
        const maxFiles = 1 + maxNewTracks;
        if (selectedFiles.length > maxFiles) {
          selectedFiles = selectedFiles.slice(0, maxFiles);
          alert(`You can upload up to ${maxFiles} files right now (limit ${MAX_TRACKS} tracks).`);
        }
      }

      const newTracks: Track[] = [];
      if (!isPerTrackMode && selectedFiles.length > 1) {
        for (let i = 1; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          if (!file) continue;
          const newTrack: Track = {
            trackId: Math.random().toString(36).substr(2, 9),
            projectId: projectId!,
            title: autoTitle(file.name),
            mp3Url: '',
            trackUrl: '',
            storageBucket: '',
            audioUrl: '',
            audioPath: '',
            storagePath: '',
            trackNo: tracks.length + newTracks.length + 1,
            sortOrder: tracks.length + newTracks.length + 1,
            createdAt: new Date().toISOString()
          };
          newTracks.push(newTrack);
          StorageService.saveTrack(newTrack);
        }
        if (newTracks.length > 0) {
          setTracks([...tracks, ...newTracks]);
        }
      }

      type UploadCandidate = { trackId: string; file?: File };
      type UploadJob = { trackId: string; file: File };
      const orderedUploads: UploadJob[] = [
        { trackId: targetTrackId, file: selectedFiles[0] },
        ...newTracks.map((track, index) => ({ trackId: track.trackId, file: selectedFiles[index + 1] }))
      ]
        .filter((item: UploadCandidate): item is UploadJob => Boolean(item.file));

      const uploadAudioToTrack = async (file: File, trackId: string) => {
        setUploadingTrackId(trackId);
        setUploadProgress(prev => ({ ...prev, [trackId]: 0 }));
        try {
          const trackSnapshot =
            tracks.find((item) => item.trackId === trackId) ||
            newTracks.find((item) => item.trackId === trackId);
          const trackNumberHint = Number(trackSnapshot?.trackNo ?? trackSnapshot?.sortOrder ?? 1);
          const resolvedTrackNumber = Number.isFinite(trackNumberHint)
            ? Math.max(1, Math.floor(trackNumberHint))
            : 1;
          const trackTitleHint = String(trackSnapshot?.title || autoTitle(file.name)).trim() || autoTitle(file.name);
          const result = await Api.uploadTrackAudio(
            file,
            projectId,
            trackId,
            {
              trackNumber: resolvedTrackNumber,
              title: trackTitleHint
            },
            (percent) => {
              setUploadProgress(prev => ({ ...prev, [trackId]: percent }));
            }
          );
          const assetRef = result?.assetRef || '';
          if (!assetRef) {
            throw new Error('Upload did not return a file URL.');
          }
          const nextStoragePath = String(
            result?.storagePath || storagePathFromTrackValue(assetRef)
          ).trim();
          if (!nextStoragePath) {
            throw new Error('Upload did not return a storage path.');
          }
          const nextStorageBucket = String(result?.bucket || defaultStorageBucket).trim() || defaultStorageBucket;
          if (import.meta.env.DEV) {
            console.log('[DEV] track upload storage target', {
              projectId,
              trackId,
              assetRef,
              storagePath: nextStoragePath || null,
              bucket: nextStorageBucket
            });
          }

          handleUpdateTrack(trackId, {
            mp3Url: assetRef,
            trackUrl: '',
            storageBucket: nextStorageBucket,
            storagePath: nextStoragePath,
            audioPath: nextStoragePath,
            audioUrl: '',
            title: trackTitleHint
          });
          ensureSignedAssets([assetRef]);
          try {
            const adminToken = localStorage.getItem('tap_admin_token') || undefined;
            const persisted = await Api.saveTrackAudioUrl(
              projectId,
              trackId,
              {
                storagePath: nextStoragePath,
                trackNumber: resolvedTrackNumber,
                title: trackTitleHint
              },
              adminToken
            );
            const persistedTrack = persisted?.track || {};
            const persistedAudioUrl = String(
              persistedTrack.audioUrl ||
              persistedTrack.audio_url ||
              ''
            ).trim();
            const persistedAudioPath = String(
              persistedTrack.audioPath ||
              persistedTrack.audio_path ||
              persistedTrack.storagePath ||
              persistedTrack.storage_path ||
              nextStoragePath
            ).trim();
            const persistedTrackUrl = String(
              persistedTrack.trackUrl ||
              persistedTrack.track_url ||
              persistedAudioUrl ||
              ''
            ).trim();
            const persistedStorageBucket = String(
              persistedTrack.storageBucket ||
              persistedTrack.storage_bucket ||
              nextStorageBucket
            ).trim();

            if (uploadPerTrackEnabled) {
              handleUpdateTrack(trackId, {
                audioUrl: persistedAudioUrl || '',
                audioPath: persistedAudioPath || nextStoragePath,
                storagePath: persistedAudioPath || nextStoragePath,
                storageBucket: persistedStorageBucket || nextStorageBucket,
                trackUrl: persistedTrackUrl
              });
            } else if (persistedAudioUrl) {
              handleUpdateTrack(trackId, {
                audioUrl: persistedAudioUrl,
                audioPath: persistedAudioPath || nextStoragePath,
                storagePath: persistedAudioPath || nextStoragePath,
                storageBucket: persistedStorageBucket || nextStorageBucket,
                trackUrl: persistedTrackUrl
              });
            }
          } catch (persistErr) {
            console.error('[UPLOAD][TRACK] DB persist failed', {
              projectId,
              trackId,
              storagePath: nextStoragePath,
              error: String((persistErr as any)?.message || persistErr || 'unknown')
            });
            throw persistErr;
          }

          if (uploadPerTrackEnabled && orderedUploads.length === 1) {
            const sourceTrack = tracks.find((item) => item.trackId === trackId);
            const previewTrack: Track = sourceTrack
              ? {
                  ...sourceTrack,
                  mp3Url: assetRef,
                  trackUrl: sourceTrack.trackUrl || '',
                  storageBucket: nextStorageBucket,
                  audioPath: nextStoragePath,
                  storagePath: nextStoragePath,
                  audioUrl: ''
                }
              : {
                  trackId,
                  projectId,
                  title: autoTitle(file.name),
                  mp3Url: assetRef,
                  trackUrl: '',
                  storageBucket: nextStorageBucket,
                  audioPath: nextStoragePath,
                  storagePath: nextStoragePath,
                  audioUrl: '',
                  sortOrder: 0,
                  createdAt: new Date().toISOString()
                };

            try {
              const previewUrl = await resolveTrackAudioForPreview(previewTrack, {
                forceRefresh: true,
                reason: 'manual'
              });
              if (previewUrl && audioPreviewRef.current) {
                stopPreview();
                audioPreviewRef.current.src = previewUrl;
                await audioPreviewRef.current.play();
                setPreviewingTrackId(trackId);
                setIsPlayingPreview(true);
              }
            } catch (previewErr) {
              if (import.meta.env.DEV) {
                console.warn('[DEV] track upload preview failed', previewErr);
              }
            }
          }

          setUploadError(null);
        } catch (err: any) {
          throw err;
        }
      };

      try {
        for (const item of orderedUploads) {
          await uploadAudioToTrack(item.file, item.trackId);
        }
      } catch (err: any) {
        const message = getUploadErrorMessage(err);
        setUploadError(message);
        alert(message);
      } finally {
        setUploadingTrackId(null);
        setUploadProgress(prev => {
          const next = { ...prev };
          orderedUploads.forEach((item) => {
            if (item?.trackId) {
              delete next[item.trackId];
            }
          });
          return next;
        });
        setUploadTargetTrackId(null);
        e.target.value = '';
      }
      return;
    }

    const file = files[0];
    if (!file) {
      e.target.value = '';
      return;
    }
    if (import.meta.env.DEV) {
      console.log('[DEV] upload file', {
        type,
        name: file.name,
        size: file.size,
        mime: file.type || 'unknown',
        projectId,
        trackId: uploadTargetTrackId
      });
    }

    if (!projectId) {
      alert('Missing project ID for upload.');
      e.target.value = '';
      return;
    }

    if (type === 'PROJECT_IMAGE') {
      try {
        const result = await Api.uploadAsset(file, projectId, { assetKind: 'project-cover' });
        const assetRef = result?.assetRef || '';
        const coverKey = String(result?.storagePath || storagePathFromTrackValue(assetRef)).trim();
        if (!assetRef) {
          throw new Error('Upload did not return a file URL.');
        }
        if (!coverKey) {
          throw new Error('Upload did not return a cover key.');
        }
        const adminToken = localStorage.getItem('tap_admin_token') || undefined;
        const persisted = await Api.updateProjectCover(
          projectId,
          {
            coverKey,
            coverMime: result?.contentType || file.type || undefined
          },
          adminToken
        );

        const refreshedCover = await Api.getProjectCoverUrl(projectId, adminToken);
        const refreshedCoverKey = String(refreshedCover?.coverKey || coverKey).trim();
        const refreshedCoverMime = String(
          refreshedCover?.coverMime ||
          persisted?.coverMime ||
          result?.contentType ||
          file.type ||
          ''
        ).trim();
        const refreshedCoverUrl = String(
          refreshedCover?.coverUrl ||
          persisted?.coverUrl ||
          persisted?.project?.coverUrl ||
          ''
        ).trim();
        const refreshedCoverExpiresAtValue = Number(
          refreshedCover?.coverUrlExpiresAt ??
          persisted?.coverUrlExpiresAt ??
          persisted?.project?.coverUrlExpiresAt
        );
        const refreshedCoverExpiresAt = Number.isFinite(refreshedCoverExpiresAtValue)
          ? refreshedCoverExpiresAtValue
          : null;
        const coverRef = refreshedCoverKey ? `asset:${refreshedCoverKey}` : assetRef;

        handleSaveProject({
          coverImageUrl: refreshedCoverUrl || coverRef || '',
          coverRef: coverRef || null,
          coverKey: refreshedCoverKey || null,
          coverMime: refreshedCoverMime || null,
          coverUrl: refreshedCoverUrl || null,
          coverUrlExpiresAt: refreshedCoverExpiresAt,
          updatedAt:
            String(refreshedCover?.updatedAt || persisted?.project?.updatedAt || '').trim() ||
            new Date().toISOString()
        });
        if (coverRef) {
          ensureSignedAssets([coverRef]);
        }
        setUploadError(null);
      } catch (err: any) {
        const message = getUploadErrorMessage(err);
        setUploadError(message);
        alert(message);
      } finally {
        e.target.value = '';
      }
      return;
    }

    if (!uploadTargetTrackId) {
      alert('Select a track before uploading artwork.');
      e.target.value = '';
      return;
    }

    try {
      const result = await Api.uploadAsset(file, projectId, {
        assetKind: 'track-artwork',
        trackId: uploadTargetTrackId
      });
      const assetRef = result?.assetRef || '';
      if (!assetRef) {
        throw new Error('Upload did not return a file URL.');
      }
      handleUpdateTrack(uploadTargetTrackId, { artworkUrl: assetRef });
      ensureSignedAssets([assetRef]);
      setUploadError(null);
    } catch (err: any) {
      const message = getUploadErrorMessage(err);
      setUploadError(message);
      alert(message);
    } finally {
      setUploadTargetTrackId(null);
      e.target.value = '';
    }
  };

  const triggerFileUpload = (type: 'PROJECT_IMAGE' | 'TRACK_IMAGE' | 'TRACK_AUDIO', trackId?: string) => {
    if (trackId) setUploadTargetTrackId(trackId);
    if (type === 'PROJECT_IMAGE') {
      if (projectImageInputRef.current) {
        projectImageInputRef.current.value = '';
        projectImageInputRef.current.click();
      }
    }
    if (type === 'TRACK_IMAGE') {
      if (trackImageInputRef.current) {
        trackImageInputRef.current.value = '';
        trackImageInputRef.current.click();
      }
    }
    if (type === 'TRACK_AUDIO') {
      if (trackAudioInputRef.current) {
        trackAudioInputRef.current.multiple = !uploadPerTrackEnabled;
        trackAudioInputRef.current.value = '';
        trackAudioInputRef.current.click();
      }
    }
  };

  const handleAddTrack = () => {
    if (tracks.length >= MAX_TRACKS) return;
    const newTrack: Track = {
      trackId: Math.random().toString(36).substr(2, 9),
      projectId: projectId!,
      title: 'New Track',
      mp3Url: '',
      trackUrl: '',
      storageBucket: '',
      audioUrl: '',
      audioPath: '',
      storagePath: '',
      trackNo: tracks.length + 1,
      sortOrder: tracks.length + 1,
      createdAt: new Date().toISOString()
    };
    StorageService.saveTrack(newTrack);
    setTracks([...tracks, newTrack]);
  };

  const handleDeleteTrack = (id: string) => {
    StorageService.deleteTrack(id);
    setTracks(tracks.filter(t => t.trackId !== id));
    if (previewingTrackId === id) stopPreview();
  };

  const handleRemoveTrackAudio = (id: string) => {
    const target = tracks.find((track) => track.trackId === id);
    if (!target) return;
    const hasAudio = Boolean(
      String(target.mp3Url || '').trim() ||
      String(target.audioUrl || '').trim() ||
      String(target.audioPath || target.storagePath || '').trim()
    );
    if (!hasAudio) return;
    if (!confirm('Remove uploaded MP3 from this track?')) return;
    if (previewingTrackId === id) {
      stopPreview();
    }
    handleUpdateTrack(id, {
      mp3Url: '',
      trackUrl: '',
      storageBucket: '',
      audioUrl: '',
      audioPath: '',
      storagePath: ''
    });
    delete signedTrackAudioUrlsRef.current[id];
    showToast('Track MP3 removed');
  };

  const handleUpdateTrack = (id: string, updates: Partial<Track>) => {
    const normalizedUpdates: Partial<Track> = { ...updates };
    if (Object.prototype.hasOwnProperty.call(updates, 'mp3Url')) {
      const normalizedMp3 = String(updates.mp3Url || '').trim();
      const storageTarget = deriveTrackStorageTarget(normalizedMp3);
      const normalizedStoragePath = String(storageTarget?.storagePath || '').trim();
      const normalizedStorageBucket = normalizedStoragePath
        ? String(storageTarget?.bucket || defaultStorageBucket).trim()
        : '';
      const normalizedTrackUrl = normalizedStoragePath && isAssetRef(normalizedMp3)
        ? ''
        : normalizedMp3;
      const hasExplicitAudioPath = Object.prototype.hasOwnProperty.call(updates, 'audioPath');
      const hasExplicitAudioUrl = Object.prototype.hasOwnProperty.call(updates, 'audioUrl');
      const hasExplicitTrackUrl = Object.prototype.hasOwnProperty.call(updates, 'trackUrl');
      const hasExplicitStorageBucket = Object.prototype.hasOwnProperty.call(updates, 'storageBucket');

      normalizedUpdates.storagePath = normalizedStoragePath;
      normalizedUpdates.storageBucket = hasExplicitStorageBucket
        ? String(updates.storageBucket || '').trim()
        : normalizedStorageBucket;
      normalizedUpdates.trackUrl = hasExplicitTrackUrl
        ? String(updates.trackUrl || '').trim()
        : normalizedTrackUrl;
      if (!hasExplicitAudioPath) {
        normalizedUpdates.audioPath = normalizedStoragePath;
      }
      if (!hasExplicitAudioUrl) {
        normalizedUpdates.audioUrl = normalizedStoragePath ? '' : normalizedMp3;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'audioPath')) {
      const normalizedAudioPath = String(updates.audioPath || '').trim();
      normalizedUpdates.audioPath = normalizedAudioPath;
      normalizedUpdates.storagePath = normalizedAudioPath || normalizedUpdates.storagePath || '';
      if (!normalizedAudioPath) {
        normalizedUpdates.storageBucket = '';
      }
    }

    const updatedTracks = tracks.map((t, index) => {
      if (t.trackId !== id) return t;
      const nextTrack = { ...t, ...normalizedUpdates };
      const nextTrackNo = Number(nextTrack.trackNo ?? nextTrack.sortOrder ?? index + 1);
      nextTrack.trackNo = Number.isFinite(nextTrackNo) ? Math.max(1, Math.floor(nextTrackNo)) : index + 1;
      return nextTrack;
    });
    setTracks(updatedTracks);
    const track = updatedTracks.find(t => t.trackId === id);
    if (track) StorageService.saveTrack(track);

    if (normalizedUpdates.mp3Url && normalizedUpdates.mp3Url.includes('spotify.com') && !normalizedUpdates.mp3Url.includes('p.scdn.co')) {
      const targetTrack = updatedTracks.find(t => t.trackId === id);
      if (targetTrack) handleMagicResolve(targetTrack);
    }
  };

  const handleSaveTrackUrl = async (track: Track) => {
    if (!projectId) {
      alert('Missing project ID for track URL save.');
      return;
    }

    const trackUrl = String(track.trackUrl || track.mp3Url || track.audioUrl || '').trim();
    const parsedStorageFromUrl = deriveTrackStorageTarget(trackUrl);
    const derivedStoragePath = String(
      track.audioPath || track.storagePath || parsedStorageFromUrl?.storagePath || ''
    ).trim();

    if (import.meta.env.DEV) {
      console.log('[DEV] save track URL derived storage', {
        trackId: track.trackId,
        trackUrl: trackUrl || null,
        bucket: parsedStorageFromUrl?.bucket || null,
        storagePath: derivedStoragePath || null
      });
    }

    setSavingUrlTrackId(track.trackId);
    try {
      const token = localStorage.getItem('tap_admin_token') || undefined;
      const response = await Api.saveTrackAudioUrl(
        projectId,
        track.trackId,
        {
          storagePath: derivedStoragePath || null,
          trackUrl: trackUrl || null
        },
        token
      );
      const payload = response?.track || {};
      const audioUrl = String(payload.audioUrl || payload.audio_url || '').trim();
      const audioPath = String(
        payload.audioPath ||
        payload.audio_path ||
        payload.storagePath ||
        payload.storage_path ||
        track.audioPath ||
        track.storagePath ||
        ''
      ).trim();
      const persistedTrackUrl = String(
        payload.trackUrl ||
        payload.track_url ||
        track.trackUrl ||
        trackUrl ||
        ''
      ).trim();
      const persistedStorageBucket = String(
        payload.storageBucket ||
        payload.storage_bucket ||
        track.storageBucket ||
        parsedStorageFromUrl?.bucket ||
        defaultStorageBucket
      ).trim();

      if (!audioUrl) {
        throw new Error('Track URL is unavailable.');
      }

      handleUpdateTrack(track.trackId, {
        audioUrl,
        audioPath,
        storagePath: audioPath || '',
        storageBucket: audioPath ? persistedStorageBucket : '',
        trackUrl: persistedTrackUrl,
        mp3Url: String(track.mp3Url || payload.mp3Url || '').trim()
      });

      await copyTextToClipboard(audioUrl);
      setCopiedUrlTrackId(track.trackId);
      if (copiedUrlTimeoutRef.current) {
        window.clearTimeout(copiedUrlTimeoutRef.current);
      }
      copiedUrlTimeoutRef.current = window.setTimeout(() => {
        setCopiedUrlTrackId((current) => (current === track.trackId ? null : current));
        copiedUrlTimeoutRef.current = null;
      }, 2000);
      showToast(
        derivedStoragePath
          ? `Track URL copied (${derivedStoragePath})`
          : 'Track URL copied (external URL)'
      );
    } catch (err: any) {
      alert(err?.message || 'Unable to save track URL.');
    } finally {
      setSavingUrlTrackId(null);
    }
  };

  const handleMagicResolve = async (track: Track) => {
    if (!track.title && !track.mp3Url) {
      alert("Please enter a song title or a Spotify link first.");
      return;
    }
    setResolvingTrackId(track.trackId);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Find a direct 30-second preview MP3 URL (starts with p.scdn.co) and high-res square artwork for: "${track.title}" ${track.mp3Url.includes('spotify') ? '(Link: ' + track.mp3Url + ')' : ''}. Return JSON.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              mp3Url: { type: Type.STRING },
              artworkUrl: { type: Type.STRING }
            },
            required: ["title", "mp3Url", "artworkUrl"]
          }
        }
      });
      const result = JSON.parse(response.text || '{}');
      if (result.mp3Url && result.mp3Url.startsWith('http')) {
        handleUpdateTrack(track.trackId, {
          title: result.title || track.title,
          mp3Url: result.mp3Url,
          artworkUrl: result.artworkUrl || track.artworkUrl
        });
      }
    } catch (error) {
      console.error("Magic Resolve failed:", error);
    } finally {
      setResolvingTrackId(null);
    }
  };

  const togglePreview = async (track: Track) => {
    if (!audioPreviewRef.current) return;
    if (previewingTrackId === track.trackId && isPlayingPreview) {
      stopPreview();
    } else {
      let resolvedUrl = '';
      try {
        resolvedUrl = await resolveTrackAudioForPreview(track, { reason: 'manual' });
      } catch {
        resolvedUrl = resolveAsset(String(track.audioUrl || track.mp3Url || ''));
      }
      if (!resolvedUrl) {
        alert("Audio not available yet.");
        return;
      }
      audioPreviewRef.current.src = resolvedUrl;
      audioPreviewRef.current.play().then(() => {
        setPreviewingTrackId(track.trackId);
        setIsPlayingPreview(true);
      }).catch(() => alert("Cannot play this audio source."));
    }
  };

  const stopPreview = () => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      setIsPlayingPreview(false);
      setPreviewingTrackId(null);
    }
  };

  const handleDownloadTrack = async (track: Track) => {
    let url = resolveAsset(String(track.audioUrl || track.mp3Url || '')).trim();
    if (!url && String(track.audioPath || track.storagePath || '').trim()) {
      try {
        url = await resolveTrackAudioForPreview(track, { reason: 'manual' });
      } catch {
        url = '';
      }
    }
    if (!url) return;

    setDownloadingTrackId(track.trackId);
    try {
      if (url.startsWith('data:')) {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${track.title.replace(/[^a-z0-9]/gi, '_')}.mp3`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${track.title.replace(/[^a-z0-9]/gi, '_')}.mp3`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      }
      setDownloadSuccessId(track.trackId);
      setTimeout(() => setDownloadSuccessId(null), 2000);
    } catch (err) {
      window.open(url, '_blank');
    } finally {
      setDownloadingTrackId(null);
    }
  };

  const handleAddLink = (category: LinkCategory) => {
    const newLink: ProjectLink = {
      linkId: Math.random().toString(36).substr(2, 9),
      projectId: projectId!,
      label: category === LinkCategory.STREAMING ? 'New Platform' : 'New Link',
      url: 'https://',
      category,
      sortOrder: links.length + 1
    };
    StorageService.saveLink(newLink);
    setLinks([...links, newLink]);
  };

  const handleDeleteLink = (id: string) => {
    StorageService.deleteLink(id);
    setLinks(links.filter(l => l.linkId !== id));
  };

  const handleUpdateLink = (id: string, updates: Partial<ProjectLink>) => {
    const updatedLinks = links.map(l => l.linkId === id ? { ...l, ...updates } : l);
    setLinks(updatedLinks);
    const link = updatedLinks.find(l => l.linkId === id);
    if (link) StorageService.saveLink(link);
  };

  const EditorSkeleton = () => (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10 animate-pulse">
      <div className="h-8 w-64 bg-slate-800/70 rounded-full mb-6" />
      <div className="h-4 w-48 bg-slate-800/50 rounded-full mb-10" />
      <div className="grid gap-6">
        <div className="h-48 bg-slate-900/60 rounded-3xl border border-slate-800/50" />
        <div className="h-56 bg-slate-900/60 rounded-3xl border border-slate-800/50" />
        <div className="h-40 bg-slate-900/60 rounded-3xl border border-slate-800/50" />
      </div>
    </div>
  );

  const TabSkeleton = () => (
    <div className="space-y-4 animate-pulse pb-12">
      <div className="h-6 w-40 bg-slate-800/60 rounded-full" />
      <div className="h-24 bg-slate-900/60 rounded-3xl border border-slate-800/50" />
      <div className="h-24 bg-slate-900/60 rounded-3xl border border-slate-800/50" />
      <div className="h-24 bg-slate-900/60 rounded-3xl border border-slate-800/50" />
    </div>
  );

  const DevicePreviewSkeleton = () => (
    <div className="relative flex flex-col w-full lg:w-[440px] px-4 py-8 lg:p-10 items-center justify-center lg:sticky lg:top-0 lg:h-[calc(100vh-73px)] border-t border-slate-800/60 lg:border-t-0">
      <div className="mb-6 h-3 w-40 bg-slate-800/60 rounded-full animate-pulse" />
      <div className="w-[268px] h-[540px] lg:w-[300px] lg:h-[600px] bg-slate-900/70 rounded-[44px] lg:rounded-[50px] border border-slate-800/60 animate-pulse" />
    </div>
  );

  if (isLoadingProject) return <EditorSkeleton />;
  if (!project) return null;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100">
      <audio ref={audioPreviewRef} onEnded={stopPreview} className="hidden" />
      <input type="file" ref={projectImageInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'PROJECT_IMAGE')} />
      <input type="file" ref={trackImageInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'TRACK_IMAGE')} />
      <input type="file" ref={trackAudioInputRef} className="hidden" accept=".mp3,audio/mpeg" multiple={!uploadPerTrackEnabled} onChange={(e) => handleFileUpload(e, 'TRACK_AUDIO')} />
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-green-400/40 bg-slate-900/95 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-green-300 shadow-xl">
          {toastMessage}
        </div>
      )}

      <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/control-admin/dashboard')} className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400">
            <ChevronLeft />
          </button>
          <div>
            <h1 className="font-bold text-lg leading-none">{project.title}</h1>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-bold">
              {isSaved ? 'Sync Active' : 'Saving...'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowMobilePreview(!showMobilePreview)} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all ${showMobilePreview ? 'bg-slate-800 text-green-400' : 'bg-slate-900 text-slate-500'}`}>
            <MonitorSmartphone size={16} />
            Device View
          </button>
          <Link to={`/${project.slug}`} target="_blank" className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-full transition-colors shadow-lg shadow-green-500/10">
            <Globe size={16} />
            <span className="hidden sm:inline">Go Live</span>
          </Link>
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row lg:overflow-hidden">
        <div className={`flex-1 overflow-y-auto px-6 py-8 ${showMobilePreview ? 'lg:border-r border-slate-800' : ''}`}>
          <div className="max-w-3xl mx-auto">
            <div className="flex border-b border-slate-800 mb-8 sticky top-0 bg-slate-950 z-20">
              {[
                { id: 'general', label: 'Identity', icon: <Globe size={16} /> },
                { id: 'tracks', label: `Tracklist`, icon: <Music size={16} /> },
                { id: 'links', label: 'E-Comm', icon: <LinkIcon size={16} /> },
                { id: 'security', label: 'Security', icon: <ShieldAlert size={16} /> }
              ].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex items-center gap-2 px-6 py-4 text-sm font-bold transition-colors border-b-2 ${activeTab === tab.id ? 'border-green-500 text-green-500' : 'border-transparent text-slate-400 hover:text-slate-100'}`}>
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'general' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300 pb-10">
                <section className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/50">
                  <h2 className="text-xl font-black mb-6">Album Visuals</h2>
                  <div className="flex flex-col md:flex-row gap-8">
                    <div onClick={() => triggerFileUpload('PROJECT_IMAGE')} className="group relative w-48 h-48 bg-slate-800 rounded-3xl overflow-hidden cursor-pointer border-2 border-dashed border-slate-700 hover:border-green-500 transition-all flex-shrink-0">
                      <ResponsiveImage
                        src={resolveAsset(project.coverImageUrl || '')}
                        assetRef={project.coverRef || (project.coverKey ? `asset:${project.coverKey}` : project.coverImageUrl)}
                        alt="Album Art"
                        className="w-full h-full object-cover group-hover:opacity-40 transition-opacity"
                        sizes="(max-width: 768px) 40vw, 192px"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white">
                        <Camera size={24} className="mb-2" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Album Art</span>
                      </div>
                    </div>
                    <div className="flex-grow space-y-6">
                      {uploadError && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-[10px] font-black uppercase tracking-widest rounded-2xl px-4 py-3">
                          Upload error: {uploadError}
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Project Title</label>
                          <input type="text" value={project.title} onChange={(e) => handleSaveProject({ title: e.target.value })} className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-green-500 text-white" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Artist Name</label>
                          <input type="text" value={project.artistName} onChange={(e) => handleSaveProject({ artistName: e.target.value })} className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-green-500 text-white" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Custom URL Slug</label>
                        <div className="flex items-center bg-slate-800/50 border border-slate-700 rounded-xl px-4">
                          <span className="text-slate-500 text-sm font-bold">/</span>
                          <input type="text" value={project.slug} onChange={(e) => handleSaveProject({ slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })} className="w-full bg-transparent py-3 focus:outline-none ml-1 text-green-400 font-bold" />
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
                <section className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/50">
                  <h2 className="text-xl font-black mb-6 text-red-500">Publication</h2>
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                    <div>
                      <p className="font-bold">Landing Page Status</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Visible to anyone with the link</p>
                    </div>
                    <button onClick={() => handleSaveProject({ published: !project.published })} className={`w-14 h-8 rounded-full relative transition-colors ${project.published ? 'bg-green-500' : 'bg-slate-600'}`}>
                      <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${project.published ? 'right-1' : 'left-1'}`} />
                    </button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'tracks' && (
              <Suspense fallback={<TabSkeleton />}>
                <TracklistTab
                  project={project}
                  tracks={tracks}
                  uploadPerTrackEnabled={uploadPerTrackEnabled}
                  uploadingTrackId={uploadingTrackId}
                  uploadProgress={uploadProgress}
                  previewingTrackId={previewingTrackId}
                  isPlayingPreview={isPlayingPreview}
                  downloadingTrackId={downloadingTrackId}
                  downloadSuccessId={downloadSuccessId}
                  savingUrlTrackId={savingUrlTrackId}
                  copiedUrlTrackId={copiedUrlTrackId}
                  resolvingTrackId={resolvingTrackId}
                  handleAddTrack={handleAddTrack}
                  handleUpdateTrack={handleUpdateTrack}
                  triggerFileUpload={triggerFileUpload}
                  togglePreview={togglePreview}
                  handleDownloadTrack={handleDownloadTrack}
                  handleSaveTrackUrl={handleSaveTrackUrl}
                  handleRemoveTrackAudio={handleRemoveTrackAudio}
                  handleMagicResolve={handleMagicResolve}
                  handleDeleteTrack={handleDeleteTrack}
                  resolveAsset={resolveAsset}
                />
              </Suspense>
            )}

            {activeTab === 'security' && (
              <Suspense fallback={<TabSkeleton />}>
                {SECURITY_V2_ENABLED ? (
                  <DistributionV2
                    project={project}
                    projectSecurityLoading={projectSecurityLoading}
                    projectSecurityError={projectSecurityError}
                    effectiveProjectSecurityStats={effectiveProjectSecurityStats}
                    unlockActivity={unlockActivity}
                    unlockActivityLoading={unlockActivityLoading}
                    unlockActivityError={unlockActivityError}
                    onSaveProject={handleSaveProject}
                    onResetCounters={handleResetCounters}
                    onRotatePins={handleRotatePins}
                  />
                ) : (
                  <SecurityTab
                    projectSecurityLoading={projectSecurityLoading}
                    projectSecurityError={projectSecurityError}
                    effectiveProjectSecurityStats={effectiveProjectSecurityStats}
                    accessStatus={accessStatus}
                    accessLoading={accessLoading}
                    accessError={accessError}
                    authEmail={localStorage.getItem('tap_auth_email')}
                    hasAuthToken={Boolean(localStorage.getItem('tap_auth_token'))}
                    onRetrySecurityStats={handleRetrySecurityStats}
                    onRetryAccessStatus={handleRetryAccessStatus}
                  />
                )}
              </Suspense>
            )}

            {activeTab === 'links' && (
              <Suspense fallback={<TabSkeleton />}>
                <LinksTab
                  project={project}
                  links={links}
                  handleAddLink={handleAddLink}
                  handleUpdateLink={handleUpdateLink}
                  handleDeleteLink={handleDeleteLink}
                  handleSaveProject={handleSaveProject}
                />
              </Suspense>
            )}
          </div>
        </div>

        {showMobilePreview && (
          <Suspense fallback={<DevicePreviewSkeleton />}>
            <DevicePreview
              project={project}
              tracks={tracks}
              resolveAssetUrl={resolveAsset}
              resolveTrackAudioUrl={resolveTrackAudioForPreview}
            />
          </Suspense>
        )}
      </div>

    </div>
  );
};

export default EditorPage;
