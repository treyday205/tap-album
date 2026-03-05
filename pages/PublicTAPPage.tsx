import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { StorageService } from '../services/storage';
import { Project, Track, EventType } from '../types';
import TAPRenderer from '../components/TAPRenderer';
import { Api, API_BASE_URL } from '../services/api';
import { ShieldAlert, Mail, ArrowRight, Loader2, CheckCircle2, XCircle, Key } from 'lucide-react';
import { collectAssetRefs, resolveAssetUrl, isAssetRef } from '../services/assets';
import { collectBankRefs, resolveBankUrls } from '../services/assetBank';
import {
  applyTrackStorageRecoveries,
  collectTrackStorageRecoveries,
  type TrackStorageRecovery
} from '../services/trackStorageRecovery';
import { registerSW } from 'virtual:pwa-register';
import {
  createTrackAudioUrlResolver,
  DEFAULT_TRACK_STORAGE,
  normalizeTrackStorageConfig,
  type SignedTrackUrlCache,
  type TrackStorageConfig
} from '../services/trackAudio';
import {
  buildSupabaseEmailRedirectUrl,
  hasSupabaseAuthUrlState,
  isSupabaseAuthEnabled,
  supabaseAuthClient
} from '../services/supabaseAuth';

const AUTH_TOKEN_KEY = 'tap_auth_token';
const AUTH_EMAIL_KEY = 'tap_auth_email';
const IS_DEV = import.meta.env.DEV;
const AUTH_TOKEN_PREFIX = `${AUTH_TOKEN_KEY}_`;
const AUTH_EMAIL_PREFIX = `${AUTH_EMAIL_KEY}_`;
const UNLOCKED_KEY_PREFIX = 'tap_unlocked_';
const scopedAuthTokenKey = (projectId: string) => `${AUTH_TOKEN_KEY}_${projectId}`;
const scopedAuthEmailKey = (projectId: string) => `${AUTH_EMAIL_KEY}_${projectId}`;
const normalizeProjectId = (value?: string | null) => String(value || '').trim();
const PUBLIC_CACHE_PREFIX = 'tap_public_cache_';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};

type PlayerState = {
  isPlaying: boolean;
  currentTrackId: string | null;
};

const AUTO_REFRESH_INTERVAL_MS = 60_000;

const PublicTAPPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const PWA_MANIFEST_VERSION = String(import.meta.env?.VITE_PWA_MANIFEST_VERSION || '2026.02.17.3').trim() || '2026.02.17.3';
  const PWA_ENV_VALUE = String(import.meta.env?.VITE_PWA_ENABLED || '').toLowerCase();
  const PWA_ENV_ENABLED = PWA_ENV_VALUE === 'true';
  const PWA_ENV_DISABLED = PWA_ENV_VALUE === 'false';
  const PWA_LOCAL_OVERRIDE = typeof window !== 'undefined' ? localStorage.getItem('PWA_ENABLED') : null;
  const PWA_LOCAL_ENABLED = PWA_LOCAL_OVERRIDE === 'true';
  const PWA_LOCAL_DISABLED = PWA_LOCAL_OVERRIDE === 'false';
  const PWA_DEFAULT = import.meta.env.DEV ? true : false;
  const PWA_ENABLED = PWA_LOCAL_ENABLED
    ? true
    : PWA_LOCAL_DISABLED
      ? false
      : PWA_ENV_ENABLED
        ? true
        : PWA_ENV_DISABLED
          ? false
          : PWA_DEFAULT;
  const normalizedPath = location.pathname.replace(/\/+$/, '');
  const publicSlugPaths = slug ? [`/${slug}`, `/t/${slug}`] : [];
  const isPublicGoLiveRoute = publicSlugPaths.includes(normalizedPath);
  const isTapAlbumSlug = /^tap-[a-z0-9_-]+$/i.test(String(slug || ''));
  const isPwaInstallRoute = Boolean(slug) && isTapAlbumSlug && normalizedPath === `/${slug}`;

  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackStorage, setTrackStorage] = useState<TrackStorageConfig>(DEFAULT_TRACK_STORAGE);
  const [loading, setLoading] = useState(true);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const signedTrackAudioUrlsRef = useRef<SignedTrackUrlCache>({});
  const signedAssetRequestsRef = useRef(new Set<string>());
  const bankAssetRequestsRef = useRef(new Set<string>());
  const swRegisteredRef = useRef(false);
  const viewLoggedRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<{ slug: string; promise: Promise<void> } | null>(null);
  const refreshIntervalRef = useRef<number | null>(null);
  const serviceWorkerRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const pendingHardReloadRef = useRef(false);
  const playerStateRef = useRef<PlayerState>({ isPlaying: false, currentTrackId: null });
  const [playerState, setPlayerState] = useState<PlayerState>({ isPlaying: false, currentTrackId: null });
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [cachedPublicProject, setCachedPublicProject] = useState<{
    title: string;
    artistName: string;
    slug?: string;
  } | null>(null);
  const [recoveryToastMessage, setRecoveryToastMessage] = useState<string | null>(null);
  const recoveryToastTimeoutRef = useRef<number | null>(null);
  const recoveryToastShownRef = useRef(false);
  const storageRecoveryQueueRef = useRef(new Map<string, TrackStorageRecovery>());
  const storageRecoveryTimerRef = useRef<number | null>(null);

  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [magicCode, setMagicCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [issuedPin, setIssuedPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [step, setStep] = useState<'email' | 'code' | 'pin'>('email');
  const [autoVerifyPayload, setAutoVerifyPayload] = useState<{ verificationId: string; code: string } | null>(null);
  const [routeProjectId, setRouteProjectId] = useState<string | null>(null);
  const autoVerifyRef = useRef<string | null>(null);
  const supabaseExchangeInFlightRef = useRef<Promise<string | null> | null>(null);
  const lastSupabaseAccessTokenRef = useRef<string | null>(null);
  const cleanedSupabaseUrlRef = useRef(false);

  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAuthToken = (projectId?: string | null) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (normalizedProjectId) {
      const scoped = localStorage.getItem(scopedAuthTokenKey(normalizedProjectId));
      if (scoped) return scoped;
    }
    return localStorage.getItem(AUTH_TOKEN_KEY);
  };

  const getAuthEmail = (projectId?: string | null) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (normalizedProjectId) {
      const scoped = localStorage.getItem(scopedAuthEmailKey(normalizedProjectId));
      if (scoped) return scoped;
    }
    return localStorage.getItem(AUTH_EMAIL_KEY);
  };

  const setAuthPayload = (projectId: string | null | undefined, token: string, authEmail: string) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (normalizedProjectId) {
      localStorage.setItem(scopedAuthTokenKey(normalizedProjectId), token);
      localStorage.setItem(scopedAuthEmailKey(normalizedProjectId), authEmail);
    }
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_EMAIL_KEY, authEmail);
  };

  const clearAuthPayload = (projectId?: string | null) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (normalizedProjectId) {
      localStorage.removeItem(scopedAuthTokenKey(normalizedProjectId));
      localStorage.removeItem(scopedAuthEmailKey(normalizedProjectId));
      localStorage.removeItem(`${UNLOCKED_KEY_PREFIX}${normalizedProjectId}`);
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_EMAIL_KEY);
  };

  const clearAllAuthStorage = () => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key === AUTH_TOKEN_KEY ||
        key === AUTH_EMAIL_KEY ||
        key.startsWith(AUTH_TOKEN_PREFIX) ||
        key.startsWith(AUTH_EMAIL_PREFIX) ||
        key.startsWith(UNLOCKED_KEY_PREFIX)
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  };

  const clearAuthCookies = () => {
    if (typeof document === 'undefined') return;
    const names = String(document.cookie || '')
      .split(';')
      .map((entry) => entry.split('=')[0]?.trim())
      .filter(Boolean);
    names.forEach((name) => {
      if (
        name === AUTH_TOKEN_KEY ||
        name === AUTH_EMAIL_KEY ||
        name.startsWith('tap_') ||
        name.startsWith('sb-')
      ) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        if (typeof window !== 'undefined' && window.location?.hostname) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
        }
      }
    });
  };

  const logSessionPath = ({
    source,
    sessionReuse,
    cachedEmail,
    typedEmail
  }: {
    source: string;
    sessionReuse: boolean;
    cachedEmail?: string | null;
    typedEmail?: string | null;
  }) => {
    if (!IS_DEV) return;
    console.log('[DEBUG] session-path', {
      source,
      session_reuse: sessionReuse,
      cachedEmail: cachedEmail || null,
      typedEmail: typedEmail || null
    });
  };

  const formatEmailSendError = (value: unknown) => {
    const message = String((value as any)?.message || value || '').trim();
    if (!message) return 'Email failed. Please try again.';
    if (/^email failed:/i.test(message)) return message;
    return `Email failed: ${message}`;
  };

  const triggerHardReload = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (playerStateRef.current.isPlaying) {
      pendingHardReloadRef.current = true;
      if (IS_DEV) {
        console.log('[DEBUG] delaying hard reload until playback ends');
      }
      return;
    }
    pendingHardReloadRef.current = false;
    window.location.reload();
  }, []);

  const handlePlayerStateChange = useCallback((next: PlayerState) => {
    playerStateRef.current = next;
    setPlayerState((prev) => {
      if (prev.isPlaying === next.isPlaying && prev.currentTrackId === next.currentTrackId) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (recoveryToastTimeoutRef.current) {
        window.clearTimeout(recoveryToastTimeoutRef.current);
      }
      if (storageRecoveryTimerRef.current) {
        window.clearTimeout(storageRecoveryTimerRef.current);
      }
    };
  }, []);

  const showRecoveryToast = useCallback((message: string) => {
    setRecoveryToastMessage(message);
    if (recoveryToastTimeoutRef.current) {
      window.clearTimeout(recoveryToastTimeoutRef.current);
    }
    recoveryToastTimeoutRef.current = window.setTimeout(() => {
      setRecoveryToastMessage(null);
      recoveryToastTimeoutRef.current = null;
    }, 2600);
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
    if (failed > 0 && IS_DEV) {
      console.warn('[DEBUG] silent track storage recovery persist failed', {
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

  const updateServiceWorkerOnResume = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    try {
      const registration =
        serviceWorkerRegistrationRef.current ||
        (await navigator.serviceWorker.getRegistration()) ||
        (await navigator.serviceWorker.ready.catch(() => null));
      if (!registration) return;
      serviceWorkerRegistrationRef.current = registration;
      await registration.update();
      if (registration.waiting) {
        triggerHardReload();
      }
    } catch (err) {
      if (IS_DEV) {
        console.warn('[DEBUG] service worker update failed', err);
      }
    }
  }, [triggerHardReload]);

  useEffect(() => {
    playerStateRef.current = playerState;
    if (!playerState.isPlaying && pendingHardReloadRef.current) {
      pendingHardReloadRef.current = false;
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  }, [playerState]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateOfflineState = () => setIsOffline(!navigator.onLine);
    updateOfflineState();
    window.addEventListener('online', updateOfflineState);
    window.addEventListener('offline', updateOfflineState);
    return () => {
      window.removeEventListener('online', updateOfflineState);
      window.removeEventListener('offline', updateOfflineState);
    };
  }, []);

  useEffect(() => {
    recoveryToastShownRef.current = false;
    storageRecoveryQueueRef.current.clear();
    if (storageRecoveryTimerRef.current) {
      window.clearTimeout(storageRecoveryTimerRef.current);
      storageRecoveryTimerRef.current = null;
    }
  }, [slug]);

  useEffect(() => {
    if (!slug || typeof window === 'undefined') return;
    const cacheKey = `${PUBLIC_CACHE_PREFIX}${slug}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setCachedPublicProject(JSON.parse(cached));
      }
    } catch {
      // ignore cache parse errors
    }
  }, [slug]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!PWA_ENABLED || !isPwaInstallRoute) {
      setInstallPromptEvent(null);
      setShowIosInstall(false);
      return;
    }
    const canRegisterSw =
      import.meta.env.PROD ||
      String(import.meta.env?.VITE_PWA_DEV || '').toLowerCase() === 'true';
    if (canRegisterSw && !swRegisteredRef.current) {
      swRegisteredRef.current = true;
      registerSW({ immediate: true });
    }

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPromptEvent(null);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);

    const ua = navigator.userAgent || '';
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = isIos && /safari/i.test(ua) && !/crios|fxios|opios/i.test(ua);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;

    setIsStandalone(Boolean(standalone));
    setShowIosInstall(isSafari && !standalone);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, [PWA_ENABLED, isPwaInstallRoute]);

  const refreshAlbumData = useCallback(async ({
    initial = false,
    reason = 'auto-refresh'
  }: {
    initial?: boolean;
    reason?: string;
  } = {}) => {
    if (!slug) return;

    const inFlight = refreshInFlightRef.current;
    if (inFlight && inFlight.slug === slug) {
      return inFlight.promise;
    }

    const run = (async () => {
      if (initial) {
        setLoading(true);
      }

      try {
        const response = await Api.getProjectBySlug(slug);
        const rawProject = response?.project || null;
        const normalizedProject = rawProject
          ? {
              ...rawProject,
              coverImageUrl: String(rawProject.coverUrl || rawProject.coverImageUrl || '').trim()
            }
          : null;
        const normalizedTracks = Array.isArray(response?.tracks)
          ? response.tracks.map((track: any) => {
              const signedAudioUrl = String(track?.audioUrl || track?.trackUrl || track?.mp3Url || '').trim();
              return {
                ...track,
                audioUrl: signedAudioUrl,
                audio_url: signedAudioUrl,
                trackUrl: signedAudioUrl || String(track?.trackUrl || '').trim(),
                mp3Url: signedAudioUrl || String(track?.mp3Url || '').trim()
              };
            })
          : [];

        setProject(normalizedProject);
        setTracks(normalizedTracks);
        setTrackStorage(normalizeTrackStorageConfig(response?.trackStorage));
        if (initial) {
          signedTrackAudioUrlsRef.current = {};
        }
        if (typeof window !== 'undefined' && normalizedProject?.slug) {
          const cacheKey = `${PUBLIC_CACHE_PREFIX}${normalizedProject.slug}`;
          const cachePayload = {
            slug: normalizedProject.slug,
            title: normalizedProject.title,
            artistName: normalizedProject.artistName
          };
          try {
            localStorage.setItem(cacheKey, JSON.stringify(cachePayload));
            setCachedPublicProject(cachePayload);
          } catch {
            // ignore cache write errors
          }
        }
        if (normalizedProject?.coverKey && !normalizedProject.coverImageUrl) {
          console.error('[GOLIVE_COVER_MISSING_FROM_DB]', {
            slug: normalizedProject.slug,
            projectId: normalizedProject.projectId,
            coverKey: normalizedProject.coverKey
          });
        }
        if ((Number(normalizedProject?.trackCount || 0) > 0) && normalizedTracks.length === 0) {
          console.error('[GOLIVE_NO_TRACKS_FROM_DB]', {
            slug: normalizedProject?.slug || slug,
            projectId: normalizedProject?.projectId || null,
            trackCount: normalizedProject?.trackCount || null
          });
        }
        if (initial && normalizedProject?.projectId && viewLoggedRef.current !== normalizedProject.projectId) {
          viewLoggedRef.current = normalizedProject.projectId;
          StorageService.logEvent(normalizedProject.projectId, EventType.VIEW, 'Page Load');
        }
        if (IS_DEV) {
          console.log('[DEBUG] project refresh (api)', {
            reason,
            projectId: normalizedProject?.projectId || null,
            slug: normalizedProject?.slug || slug,
            tracks: normalizedTracks.length
          });
        }
      } catch (err) {
        if (initial) {
          setProject(null);
          setTracks([]);
          setTrackStorage(DEFAULT_TRACK_STORAGE);
          signedTrackAudioUrlsRef.current = {};
        }
        if (IS_DEV) {
          console.warn('[DEBUG] project refresh failed', { reason, err });
        }
      } finally {
        if (initial) {
          setLoading(false);
        }
      }
    })().finally(() => {
      if (refreshInFlightRef.current?.slug === slug) {
        refreshInFlightRef.current = null;
      }
    });

    refreshInFlightRef.current = { slug, promise: run };
    return run;
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    void refreshAlbumData({ initial: true, reason: 'initial-load' });
  }, [slug, refreshAlbumData]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !slug) return;

    const refreshOnResume = (reason: string) => {
      if (document.visibilityState !== 'visible') return;
      void updateServiceWorkerOnResume();
      void refreshAlbumData({ reason });
    };

    const startVisibleInterval = () => {
      if (refreshIntervalRef.current !== null) return;
      refreshIntervalRef.current = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          void refreshAlbumData({ reason: 'visible-interval' });
        }
      }, AUTO_REFRESH_INTERVAL_MS);
    };

    const stopVisibleInterval = () => {
      if (refreshIntervalRef.current === null) return;
      window.clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startVisibleInterval();
        refreshOnResume('visibilitychange-visible');
      } else {
        stopVisibleInterval();
      }
    };

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        refreshOnResume('window-focus');
      }
    };

    if (document.visibilityState === 'visible') {
      startVisibleInterval();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      stopVisibleInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [slug, refreshAlbumData, updateServiceWorkerOnResume]);

  useEffect(() => {
    if (!PWA_ENABLED || !isPwaInstallRoute || !project?.slug || !slug || typeof window === 'undefined') return;

    // Canonical PWA launch path must stay on the exact /tap-:slug album route.
    const albumPath = `/${slug}`;
    const manifestUrl = new URL('/api/pwa/manifest', window.location.origin);
    manifestUrl.searchParams.set('slug', slug);
    manifestUrl.searchParams.set('path', albumPath);
    manifestUrl.searchParams.set('v', PWA_MANIFEST_VERSION);
    const dynamicHref = `${manifestUrl.pathname}${manifestUrl.search}`;

    let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    const createdManifestLink = !manifestLink;
    const previousManifestHref = manifestLink?.getAttribute('href') || '';
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.setAttribute('rel', 'manifest');
      document.head.appendChild(manifestLink);
    }
    manifestLink.setAttribute('href', dynamicHref);
    manifestLink.setAttribute('data-tap-go-live-manifest', 'true');

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const previousTheme = themeMeta?.getAttribute('content') || '';
    if (themeMeta) {
      themeMeta.setAttribute('content', '#020617');
    }

    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const previousAppleTitle = appleTitleMeta?.getAttribute('content') || '';
    if (appleTitleMeta) {
      appleTitleMeta.setAttribute('content', String(project.title || 'TAP').trim().slice(0, 15) || 'TAP');
    }

    return () => {
      if (manifestLink?.getAttribute('data-tap-go-live-manifest') === 'true') {
        manifestLink.removeAttribute('data-tap-go-live-manifest');
        if (createdManifestLink) {
          manifestLink.remove();
        } else {
          manifestLink.setAttribute('href', previousManifestHref || 'about:blank');
        }
      }
      if (themeMeta && previousTheme) {
        themeMeta.setAttribute('content', previousTheme);
      }
      if (appleTitleMeta && previousAppleTitle) {
        appleTitleMeta.setAttribute('content', previousAppleTitle);
      }
    };
  }, [PWA_ENABLED, isPwaInstallRoute, project?.slug, project?.title, slug, PWA_MANIFEST_VERSION]);

  useEffect(() => {
    const search = location.search || '';
    let params = new URLSearchParams(search);
    if ([...params.keys()].length === 0) {
      const hash = location.hash || '';
      const queryIndex = hash.indexOf('?');
      if (queryIndex !== -1) {
        const hashSearch = hash.slice(queryIndex + 1);
        params = new URLSearchParams(hashSearch);
      }
    }
    const verify = params.get('verify') || params.get('verificationId');
    const code = params.get('code');
    const projectIdParam = params.get('projectId') || params.get('albumId') || params.get('id');
    if (projectIdParam) {
      setRouteProjectId(projectIdParam);
    }
    if (verify && code) {
      setVerificationId(verify);
      setMagicCode(code);
      setStep('code');
      setShowModal(true);
      setAutoVerifyPayload({ verificationId: verify, code });
      return;
    }
    if (hasSupabaseAuthUrlState()) {
      setShowModal(true);
    }
  }, [location.search, location.hash]);

  useEffect(() => {
    let canceled = false;
    const checkAccess = async () => {
      if (!project) return;
      const gateEnabled = project.emailGateEnabled ?? true;
      if (!gateEnabled) {
        setIsUnlocked(true);
        return;
      }

      const token = await ensureAppToken(project.projectId);
      if (!token) {
        if (canceled) return;
        setIsUnlocked(false);
        return;
      }

      try {
        const status = await Api.getAccessStatus(project.projectId, token);
        if (canceled) return;
        setRemaining(status.remaining ?? null);
        if (status.unlocked) {
          setIsUnlocked(true);
        } else {
          setIsUnlocked(false);
        }
      } catch (err) {
        if (canceled) return;
        clearAuthPayload(project.projectId);
        lastSupabaseAccessTokenRef.current = null;
        setIsUnlocked(false);
      }
    };

    checkAccess();
    return () => {
      canceled = true;
    };
  }, [project]);

  const resolveAsset = useCallback((value: string) => resolveAssetUrl(value, assetUrls), [assetUrls]);

  const refreshSignedTrackUrl = useCallback(
    async ({ track, storagePath }: { track: Track; storagePath: string }) => {
      const projectId = String(project?.projectId || '').trim();
      const key = String(storagePath || '').trim();
      if (!projectId || !key) return null;
      const explicitRef = String(track.mp3Url || '').trim();
      const assetRef = isAssetRef(explicitRef) ? explicitRef : `asset:${key}`;
      const token = getAuthToken(projectId);
      if (!token && (project?.emailGateEnabled ?? true)) {
        return null;
      }

      try {
        const response = await Api.signAssets(projectId, [assetRef], token || undefined);
        const signedUrl = String(response?.assets?.[0]?.url || '').trim();
        if (!signedUrl) return null;
        const ttlMs = Math.max(60, Math.floor(Number(trackStorage?.signedUrlTtl || 900))) * 1000;
        const expiresAt = Date.now() + ttlMs;
        setTracks((prev) =>
          prev.map((item) =>
            item.trackId === track.trackId
              ? {
                  ...item,
                  audioUrl: signedUrl,
                  audio_url: signedUrl,
                  trackUrl: signedUrl,
                  audioUrlExpiresAt: expiresAt
                }
              : item
          )
        );
        return { url: signedUrl, expiresAt };
      } catch (error) {
        console.error('[AUDIO][GoLive] signed URL refresh failed', {
          projectId,
          trackId: track.trackId,
          storagePath: key,
          error: String((error as any)?.message || error || 'unknown')
        });
        return null;
      }
    },
    [project?.projectId, project?.emailGateEnabled, trackStorage?.signedUrlTtl]
  );

  const resolveTrackAudioForPlayback = useCallback(
    createTrackAudioUrlResolver({
      storage: trackStorage,
      cache: signedTrackAudioUrlsRef.current,
      resolveAssetUrl: resolveAsset,
      resolveBankAssetUrls: resolveBankUrls,
      onBankAssetsResolved: (resolved) => {
        if (Object.keys(resolved).length > 0) {
          setAssetUrls((prev) => ({ ...prev, ...resolved }));
        }
      },
      resolveSignedStorageUrl: async ({ track, storagePath }) =>
        refreshSignedTrackUrl({ track, storagePath }),
      getPlayerState: () => playerStateRef.current,
      onResolvedUrl: ({
        track: resolvedTrack,
        url,
        source,
        reason,
        storagePath,
        storageBucket,
        resolveMode,
        fromCache
      }) => {
        if (!isPublicGoLiveRoute) return;
        console.log('[AUDIO][GoLive] resolved-track-url', {
          projectId: project?.projectId || null,
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
        if (source === 'storage' && url) {
          setTracks((prev) =>
            prev.map((item) =>
              item.trackId === resolvedTrack.trackId
                ? {
                    ...item,
                    audioUrl: url,
                    audio_url: url,
                    trackUrl: url
                  }
                : item
            )
          );
        }
      }
    }),
    [isPublicGoLiveRoute, project?.projectId, refreshSignedTrackUrl, resolveAsset, trackStorage]
  );

  useEffect(() => {
    const projectId = String(project?.projectId || '').trim();
    if (!projectId || tracks.length === 0) return;

    const recoveries = collectTrackStorageRecoveries(tracks);
    if (recoveries.length === 0) return;

    const { tracks: recoveredTracks, recoveredCount } = applyTrackStorageRecoveries(tracks, recoveries);
    if (recoveredCount === 0) return;

    setTracks(recoveredTracks);
    queueStorageRecoveryPersist(projectId, recoveries);

    if (!recoveryToastShownRef.current) {
      recoveryToastShownRef.current = true;
      showRecoveryToast(`Recovered ${recoveredCount} track${recoveredCount === 1 ? '' : 's'}`);
    }

    if (IS_DEV) {
      console.log('[DEBUG] silent storage path recovery applied', {
        projectId,
        recoveredCount,
        recoveries: recoveries.map((item) => ({
          trackId: item.trackId,
          bucket: item.bucket,
          storagePath: item.storagePath
        }))
      });
    }
  }, [project?.projectId, tracks, queueStorageRecoveryPersist, showRecoveryToast]);

  const ensureSignedAssets = async (refs: string[]) => {
    if (!project) return;
    const token = getAuthToken(project.projectId);
    if (!token && (project.emailGateEnabled ?? true)) return;
    const missing = refs
      .filter((ref) => isAssetRef(ref) && !assetUrls[ref])
      .filter((ref) => !signedAssetRequestsRef.current.has(ref));
    if (missing.length === 0) return;
    missing.forEach((ref) => signedAssetRequestsRef.current.add(ref));
    try {
      const response = await Api.signAssets(project.projectId, missing, token || undefined);
      const next = { ...assetUrls };
      (response.assets || []).forEach((asset: any) => {
        if (asset?.ref && asset?.url) {
          next[asset.ref] = asset.url;
        }
      });
      setAssetUrls(next);
    } catch (err) {
      missing.forEach((ref) => signedAssetRequestsRef.current.delete(ref));
      if (IS_DEV) {
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
      if (IS_DEV) {
        console.warn('[DEV] bank asset hydration failed', err);
      }
    }
  };

  useEffect(() => {
    if (!project || !isUnlocked) return;
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
  }, [project, tracks, isUnlocked]);

  const resetModal = () => {
    setVerificationId(null);
    setMagicCode('');
    setDevCode(null);
    setIssuedPin(null);
    setPinInput('');
    setError(null);
    setStep('email');
  };

  const resetAuth = (projectIdOverride?: string | null) => {
    const effectiveProjectId = normalizeProjectId(projectIdOverride || project?.projectId || routeProjectId);
    clearAuthPayload(effectiveProjectId || null);
    clearAllAuthStorage();
    clearAuthCookies();
    lastSupabaseAccessTokenRef.current = null;
    supabaseExchangeInFlightRef.current = null;
    if (supabaseAuthClient) {
      void supabaseAuthClient.auth.signOut();
    }
    setIssuedPin(null);
    setPinInput('');
    setRemaining(null);
    setIsUnlocked(false);
    setStep('email');
  };

  const persistAuthPayload = (payload: any) => {
    if (!payload?.token || !payload?.email) return;
    const effectiveProjectId = normalizeProjectId(payload?.projectId || project?.projectId || routeProjectId);
    setAuthPayload(effectiveProjectId || null, payload.token, payload.email);
    setRemaining(payload.remaining ?? null);
  };

  const exchangeSupabaseSession = async (projectId: string, accessToken: string): Promise<string | null> => {
    if (!projectId || !accessToken) return null;
    const existingToken = getAuthToken(projectId);
    if (lastSupabaseAccessTokenRef.current === accessToken && existingToken) {
      return existingToken;
    }
    const response = await Api.exchangeSupabaseSession(projectId, accessToken);
    persistAuthPayload(response);
    lastSupabaseAccessTokenRef.current = accessToken;
    return response.token || null;
  };

  const ensureAppToken = async (projectId: string): Promise<string | null> => {
    const existingToken = getAuthToken(projectId);
    if (existingToken) return existingToken;
    if (!projectId || !isSupabaseAuthEnabled || !supabaseAuthClient) return null;
    if (supabaseExchangeInFlightRef.current) {
      return supabaseExchangeInFlightRef.current;
    }

    const run = (async () => {
      const { data, error } = await supabaseAuthClient.auth.getSession();
      if (error || !data?.session?.access_token) {
        if (IS_DEV && error) {
          console.warn('[DEBUG] supabase session fetch failed', error.message || error);
        }
        return null;
      }
      return exchangeSupabaseSession(projectId, data.session.access_token);
    })().finally(() => {
      supabaseExchangeInFlightRef.current = null;
    });

    supabaseExchangeInFlightRef.current = run;
    return run;
  };

  const openModal = () => {
    const effectiveProjectId = project?.projectId || routeProjectId;
    const cachedEmail = String(getAuthEmail(effectiveProjectId) || '').trim().toLowerCase();
    logSessionPath({
      source: 'continue_with_different_email',
      sessionReuse: false,
      cachedEmail,
      typedEmail: null
    });
    resetModal();
    setEmail('');
    setPinInput('');
    setError(null);
    setStep('email');
    setShowModal(true);
  };

  const handleContinueAsCachedEmail = async () => {
    const effectiveProjectId = project?.projectId || routeProjectId;
    if (!effectiveProjectId) {
      openModal();
      return;
    }

    const cachedEmail = String(getAuthEmail(effectiveProjectId) || '').trim().toLowerCase();
    logSessionPath({
      source: 'continue_as_cached_email',
      sessionReuse: true,
      cachedEmail,
      typedEmail: null
    });

    let token = getAuthToken(effectiveProjectId);
    if (!token) {
      token = await ensureAppToken(effectiveProjectId);
    }
    if (!token) {
      openModal();
      return;
    }

    setShowModal(true);
    setError(null);
    try {
      const status = await Api.getAccessStatus(effectiveProjectId, token);
      setRemaining(status.remaining ?? null);
      if (status?.unlocked) {
        setIsUnlocked(true);
        setShowModal(false);
        resetModal();
        return;
      }
      if (!status?.verified) {
        resetAuth(effectiveProjectId);
        openModal();
        return;
      }
      setStep('pin');
      await handleIssuePin(token, effectiveProjectId);
    } catch {
      resetAuth(effectiveProjectId);
      openModal();
    }
  };

  const closeModal = () => {
    setShowModal(false);
    resetModal();
  };

  const handleRequestMagic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    const slugValue = project.slug || slug;
    if (!slugValue) {
      setError('Missing album slug.');
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Email is required.');
      return;
    }
    const cachedEmail = String(getAuthEmail(project.projectId) || '').trim().toLowerCase();
    logSessionPath({
      source: 'send_magic_link',
      sessionReuse: false,
      cachedEmail,
      typedEmail: normalizedEmail
    });
    setIsSending(true);
    setError(null);

    try {
      setEmail(normalizedEmail);
      const currentEmail = String(getAuthEmail(project.projectId) || '').trim().toLowerCase();
      if (currentEmail && currentEmail !== normalizedEmail) {
        clearAuthPayload(project.projectId);
        lastSupabaseAccessTokenRef.current = null;
      }
      if (IS_DEV) {
        console.log('[DEBUG] request-magic start', {
          apiBaseUrl: API_BASE_URL,
          projectId: project.projectId,
          slug: slugValue,
          email: normalizedEmail,
          via: isSupabaseAuthEnabled && supabaseAuthClient ? 'supabase' : 'backend'
        });
      }
      if (isSupabaseAuthEnabled && supabaseAuthClient) {
        const redirectTo = buildSupabaseEmailRedirectUrl(slugValue, project.projectId);
        const { error: otpError } = await supabaseAuthClient.auth.signInWithOtp({
          email: normalizedEmail,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: redirectTo
          }
        });
        if (otpError) {
          throw otpError;
        }
        setVerificationId('supabase');
        setDevCode(null);
        setStep('code');
        return;
      }

      const response = await Api.requestMagicLink(normalizedEmail, project.projectId, slugValue);
      if (IS_DEV) {
        console.log('[DEBUG] request-magic success', {
          verificationId: response?.verificationId || null
        });
      }
      setVerificationId(response.verificationId);
      setDevCode(response.devCode || null);
      setStep('code');
    } catch (err: any) {
      if (IS_DEV) {
        console.warn('[DEBUG] request-magic failed', {
          message: String(err?.message || err || ''),
          status: (err as any)?.status,
          body: (err as any)?.body || null
        });
      }
      setError(formatEmailSendError(err));
    } finally {
      setIsSending(false);
    }
  };

  const performVerifyMagic = async (id: string, code: string) => {
    setIsVerifying(true);
    setError(null);

    try {
      if (IS_DEV) {
        const debugProjectId = project?.projectId || routeProjectId;
        console.log('[DEBUG] verify-magic', {
          apiBaseUrl: API_BASE_URL,
          projectId: debugProjectId,
          code
        });
      }
      const response = await Api.verifyMagicLink(id, code.trim());
      persistAuthPayload(response);
      setStep('pin');
      await handleIssuePin(response.token, response.projectId);
    } catch (err: any) {
      setError(err.message || 'Verification failed.');
    } finally {
      setIsVerifying(false);
    }
  };

  const performSupabaseOtpVerify = async (projectId: string, code: string) => {
    if (!supabaseAuthClient) {
      throw new Error('Supabase auth is not configured.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error('Enter the same email you used for the magic link.');
    }

    let { data, error: verifyError } = await supabaseAuthClient.auth.verifyOtp({
      email: normalizedEmail,
      token: code.trim(),
      type: 'email'
    });
    if (verifyError) {
      const retry = await supabaseAuthClient.auth.verifyOtp({
        email: normalizedEmail,
        token: code.trim(),
        type: 'magiclink'
      });
      data = retry.data;
      verifyError = retry.error;
    }
    if (verifyError) {
      throw verifyError;
    }
    const accessToken =
      data?.session?.access_token ||
      (await supabaseAuthClient.auth.getSession()).data.session?.access_token;
    if (!accessToken) {
      throw new Error('Email verified but no session was created.');
    }
    const appToken = await exchangeSupabaseSession(projectId, accessToken);
    if (!appToken) {
      throw new Error('Could not create app session.');
    }
    setStep('pin');
    await handleIssuePin(appToken, projectId);
  };

  const handleVerifyMagic = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveProjectId = project?.projectId || routeProjectId;
    if (!effectiveProjectId) {
      setError('Missing project ID for verification.');
      return;
    }
    if (isSupabaseAuthEnabled && supabaseAuthClient) {
      setIsVerifying(true);
      setError(null);
      try {
        await performSupabaseOtpVerify(effectiveProjectId, magicCode);
      } catch (err: any) {
        setError(err.message || 'Verification failed.');
      } finally {
        setIsVerifying(false);
      }
      return;
    }
    if (!verificationId) return;
    await performVerifyMagic(verificationId, magicCode);
  };

  useEffect(() => {
    if (!autoVerifyPayload || !project) return;
    const verifyKey = `${project.projectId}:${autoVerifyPayload.verificationId}:${autoVerifyPayload.code}`;
    if (autoVerifyRef.current === verifyKey) return;
    autoVerifyRef.current = verifyKey;
    performVerifyMagic(autoVerifyPayload.verificationId, autoVerifyPayload.code).finally(() => {
      const cleanUrl = window.location.href.split('?')[0];
      window.history.replaceState({}, document.title, cleanUrl);
      setAutoVerifyPayload(null);
    });
  }, [autoVerifyPayload, project]);

  useEffect(() => {
    if (!project || !isSupabaseAuthEnabled || !supabaseAuthClient) return;
    let canceled = false;

    const clearSupabaseUrlState = () => {
      if (cleanedSupabaseUrlRef.current) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get('verify')) return;
      const authParamKeys = ['code', 'type', 'access_token', 'refresh_token', 'token_type', 'expires_in', 'expires_at'];
      let mutated = false;
      authParamKeys.forEach((key) => {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          mutated = true;
        }
      });
      if (url.hash && /(access_token=|refresh_token=|type=magiclink|type=recovery)/i.test(url.hash)) {
        url.hash = '';
        mutated = true;
      }
      if (mutated) {
        cleanedSupabaseUrlRef.current = true;
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      }
    };

    const hydrateFromSupabaseSession = async () => {
      try {
        const { data, error } = await supabaseAuthClient.auth.getSession();
        if (canceled || error || !data?.session?.access_token) {
          return;
        }
        await exchangeSupabaseSession(project.projectId, data.session.access_token);
        clearSupabaseUrlState();
      } catch (err) {
        if (IS_DEV) {
          console.warn('[DEBUG] supabase session hydration failed', err);
        }
      }
    };

    void hydrateFromSupabaseSession();

    const { data: authSubscription } = supabaseAuthClient.auth.onAuthStateChange((_event, session) => {
      if (canceled || !session?.access_token) return;
      void exchangeSupabaseSession(project.projectId, session.access_token)
        .then(() => {
          clearSupabaseUrlState();
        })
        .catch((err) => {
          if (IS_DEV) {
            console.warn('[DEBUG] supabase auth state exchange failed', err);
          }
        });
    });

    return () => {
      canceled = true;
      authSubscription.subscription.unsubscribe();
    };
  }, [project]);

  const handleIssuePin = async (tokenOverride?: string, projectIdOverride?: string) => {
    const effectiveProjectId = projectIdOverride || project?.projectId || routeProjectId;
    if (!effectiveProjectId) {
      setError('Missing project ID for PIN issuance.');
      return;
    }
    const token = tokenOverride || (await ensureAppToken(effectiveProjectId));
    if (!token) return;

    setIsIssuing(true);
    setError(null);
    try {
      const response = await Api.issuePin(effectiveProjectId, token);
      setIssuedPin(response.pin);
      setRemaining(response.remaining ?? null);
    } catch (err: any) {
      setError(err.message || 'Could not issue PIN.');
    } finally {
      setIsIssuing(false);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveProjectId = project?.projectId || routeProjectId;
    if (!effectiveProjectId) {
      setError('Missing project ID for PIN verification.');
      return;
    }
    const token = await ensureAppToken(effectiveProjectId);
    if (!token) return;

    setIsUnlocking(true);
    setError(null);
    try {
      const response = await Api.verifyPin(effectiveProjectId, pinInput.trim(), token);
      setRemaining(response.remaining ?? null);
      setIsUnlocked(true);
      if (project) {
        StorageService.logEvent(project.projectId, EventType.ACTIVATION_SUCCESS, 'Email + PIN');
      }
      closeModal();
    } catch (err: any) {
      setError(err.message || 'PIN verification failed.');
      if (project) {
        StorageService.logEvent(project.projectId, EventType.ACTIVATION_FAILED, 'Invalid PIN');
      }
    } finally {
      setIsUnlocking(false);
    }
  };

  const PublicPageSkeleton = () => (
    <div className="w-full tap-full-height bg-slate-950 flex justify-center">
      <div className="w-full max-w-[520px] tap-full-height overflow-hidden flex flex-col md:my-3 md:h-[calc(100dvh-1.5rem)] md:rounded-[2rem] md:border md:border-slate-800/70 md:shadow-2xl">
        <div className="px-4 pt-5 pb-4 flex justify-center">
          <div className="w-full max-w-[360px] aspect-square rounded-[2.1rem] bg-slate-900/60 border border-slate-800/50 animate-pulse" />
        </div>
        <div className="px-4 space-y-3 animate-pulse">
          <div className="h-4 w-3/4 bg-slate-800/60 rounded-full" />
          <div className="h-3 w-1/2 bg-slate-800/50 rounded-full" />
          <div className="h-24 w-full bg-slate-900/50 rounded-2xl border border-slate-800/50" />
          <div className="h-24 w-full bg-slate-900/50 rounded-2xl border border-slate-800/50" />
        </div>
      </div>
    </div>
  );

  const OfflineScreen = () => {
    return (
      <div className="flex flex-col items-center justify-center tap-full-height bg-slate-950 px-6 text-center tap-safe-top tap-safe-bottom">
        <div className="w-full max-w-md rounded-[2rem] border border-slate-800/70 bg-slate-900/35 shadow-[0_24px_60px_rgba(0,0,0,0.5)] px-6 py-8">
          <div className="w-32 h-32 mx-auto rounded-[2rem] border border-slate-800/70 bg-slate-900/60 mb-6" />
          <h1 className="text-2xl font-black text-white">You&#39;re Offline</h1>
          <p className="text-slate-400 text-sm mt-2">Connect to load album content.</p>
          {cachedPublicProject && (
            <div className="mt-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Cached Album</p>
              <p className="text-lg font-bold text-white mt-2">{cachedPublicProject.title}</p>
              <p className="text-sm text-slate-400">{cachedPublicProject.artistName}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleInstallClick = async () => {
    if (!installPromptEvent) return;
    try {
      await installPromptEvent.prompt();
      const result = await installPromptEvent.userChoice;
      if (result?.outcome) {
        setInstallPromptEvent(null);
      }
    } catch {
      // ignore install prompt errors
    }
  };

  const showInstallButton =
    PWA_ENABLED && isPwaInstallRoute && Boolean(installPromptEvent) && !isStandalone;
  const showIosInstructions =
    PWA_ENABLED && isPwaInstallRoute && showIosInstall && !isStandalone;
  const showInstallCard = showIosInstructions;
  const offlineBanner = isOffline ? (
    <div className="mx-4 mt-4 rounded-2xl border border-slate-800/70 bg-slate-900/60 px-4 py-3 text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
      You&#39;re offline — connect to load album content.
    </div>
  ) : null;

  if (loading) {
    return <PublicPageSkeleton />;
  }

  if (!project) {
    if (isOffline) {
      return <OfflineScreen />;
    }
    return (
      <div className="flex flex-col items-center justify-center tap-full-height bg-slate-950 px-6 text-center tap-safe-top tap-safe-bottom">
        <h1 className="text-2xl font-bold mb-2">TAP Not Found</h1>
        <p className="text-slate-400 italic">This album experience is currently private or does not exist.</p>
      </div>
    );
  }

  const cachedSessionEmail = String(getAuthEmail(project.projectId) || '').trim().toLowerCase();

  if (!isUnlocked) {
    return (
      <div className="w-full tap-full-height bg-slate-950 flex flex-col items-center justify-center px-5 sm:px-8 text-center animate-in fade-in duration-700 tap-safe-top tap-safe-bottom">
        {recoveryToastMessage && (
          <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-green-400/35 bg-slate-900/95 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-green-300 shadow-xl">
            {recoveryToastMessage}
          </div>
        )}
        {offlineBanner}
        <div className="w-full max-w-md rounded-[2rem] border border-slate-800/70 bg-slate-900/35 shadow-[0_24px_60px_rgba(0,0,0,0.5)] px-6 py-8 sm:p-8">
          <div className="mb-10 flex flex-col items-center">
            <div className="w-20 h-20 bg-green-500/10 rounded-[2rem] border border-green-500/20 flex items-center justify-center text-green-500 mb-8 shadow-2xl shadow-green-500/10">
              <ShieldAlert size={36} />
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white mb-3">Secure Entry</h1>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-[0.2em] max-w-[240px] leading-relaxed">
              Verify your email to unlock this album.
            </p>
            <p className="text-[10px] text-slate-600 font-bold uppercase tracking-[0.2em] mt-4">
              {remaining !== null ? `Remaining PIN uses: ${remaining}` : 'Up to 1,000,000 PIN uses per email'}
            </p>
          </div>

          <button
            onClick={openModal}
            className="w-full min-h-[56px] px-4 rounded-3xl font-black text-xs uppercase tracking-[0.24em] flex items-center justify-center gap-3 transition-all bg-green-500 text-black shadow-xl shadow-green-500/20 active:scale-95 touch-manipulation"
          >
            <Mail size={18} />
            Continue with a Different Email
            <ArrowRight size={18} />
          </button>
          {cachedSessionEmail && (
            <button
              type="button"
              onClick={() => void handleContinueAsCachedEmail()}
              className="mt-3 w-full min-h-[48px] px-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] flex items-center justify-center transition-all bg-slate-800/60 text-slate-200 hover:bg-slate-800 touch-manipulation"
            >
              Continue as {cachedSessionEmail}
            </button>
          )}

          <div className="mt-16 pt-8 border-t border-white/5">
            <p className="text-[9px] font-bold text-slate-700 uppercase tracking-[0.4em] leading-relaxed">
              Unique distribution hardware ID:<br />
              <span className="text-slate-500">{project.slug.toUpperCase()}</span>
            </p>
          </div>
        </div>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/90 backdrop-blur-md p-0 sm:p-6">
            <div className="w-full sm:max-w-md bg-slate-900 rounded-t-[30px] sm:rounded-[32px] border border-slate-800 p-6 sm:p-8 text-left max-h-[92dvh] overflow-y-auto tap-native-scroll tap-safe-bottom">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black">Verify Ownership</h2>
                <button onClick={closeModal} className="w-10 h-10 flex items-center justify-center text-slate-500 hover:text-white bg-slate-800/70 rounded-full touch-manipulation">×</button>
              </div>

              {step === 'email' && (
                <form onSubmit={handleRequestMagic} className="space-y-5">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@domain.com"
                      className="w-full bg-slate-800/50 border border-slate-700 rounded-2xl px-4 py-4 text-base focus:outline-none focus:ring-1 focus:ring-green-500 text-white"
                      required
                    />
                  </div>
                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-[10px] font-black uppercase tracking-widest">
                      <XCircle size={14} />
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isSending}
                    className="w-full min-h-[52px] px-4 rounded-2xl font-black text-xs uppercase tracking-[0.24em] flex items-center justify-center gap-3 transition-all bg-green-500 text-black shadow-xl shadow-green-500/20 active:scale-95 touch-manipulation"
                  >
                    {isSending ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
                    Send Magic Link
                  </button>
                </form>
              )}

              {step === 'code' && (
                <form onSubmit={handleVerifyMagic} className="space-y-5">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Verification Code</label>
                    <input
                      type="text"
                      value={magicCode}
                      onChange={(e) => setMagicCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6-digit code"
                      className="w-full bg-slate-800/50 border border-slate-700 rounded-2xl px-4 py-4 text-base focus:outline-none focus:ring-1 focus:ring-green-500 text-white tracking-[0.34em] text-center font-mono"
                      required
                    />
                    <p className="mt-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                      {isSupabaseAuthEnabled
                        ? 'Click the email magic link. If a 6-digit code is included, enter it here.'
                        : 'Check your email for the magic link or enter the code.'}
                    </p>
                    {devCode && (
                      <p className="mt-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                        Dev Code: <span className="text-green-400">{devCode}</span>
                      </p>
                    )}
                  </div>
                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-[10px] font-black uppercase tracking-widest">
                      <XCircle size={14} />
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isVerifying}
                    className="w-full min-h-[52px] px-4 rounded-2xl font-black text-xs uppercase tracking-[0.24em] flex items-center justify-center gap-3 transition-all bg-green-500 text-black shadow-xl shadow-green-500/20 active:scale-95 touch-manipulation"
                  >
                    {isVerifying ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                    Verify Email
                  </button>
                </form>
              )}

              {step === 'pin' && (
                <form onSubmit={handleVerifyPin} className="space-y-5">
                  <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Your PIN</p>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-mono font-black tracking-[0.4em] text-green-400">
                        {isIssuing ? '••••••' : issuedPin || '------'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleIssuePin()}
                        disabled={isIssuing}
                        className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white"
                      >
                        {isIssuing ? 'Issuing...' : 'Reissue'}
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-600 font-bold uppercase tracking-[0.2em]">
                      {remaining !== null ? `Remaining PIN uses: ${remaining}` : 'Up to 1,000,000 PIN uses per email'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Enter PIN to Unlock</label>
                    <input
                      type="text"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6-digit PIN"
                      className="w-full bg-slate-800/50 border border-slate-700 rounded-2xl px-4 py-4 text-base focus:outline-none focus:ring-1 focus:ring-green-500 text-white tracking-[0.34em] text-center font-mono"
                      required
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-[10px] font-black uppercase tracking-widest">
                      <XCircle size={14} />
                      {error}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      logSessionPath({
                        source: 'reset_access',
                        sessionReuse: false,
                        cachedEmail: String(getAuthEmail(project.projectId) || '').trim().toLowerCase(),
                        typedEmail: null
                      });
                      resetAuth();
                      closeModal();
                    }}
                    className="w-full min-h-[48px] px-4 rounded-xl font-black text-[10px] uppercase tracking-[0.24em] flex items-center justify-center transition-all bg-slate-800/60 text-slate-300 hover:bg-slate-800 touch-manipulation"
                  >
                    Use Different Email
                  </button>

                  <button
                    type="submit"
                    disabled={isUnlocking || pinInput.length < 6}
                    className={`w-full min-h-[56px] px-4 rounded-2xl font-black text-xs uppercase tracking-[0.24em] flex items-center justify-center gap-3 transition-all touch-manipulation ${
                      isUnlocking || pinInput.length < 6
                        ? 'bg-slate-800 text-slate-600'
                        : 'bg-green-500 text-black shadow-xl shadow-green-500/20 active:scale-95'
                    }`}
                  >
                    {isUnlocking ? <Loader2 size={18} className="animate-spin" /> : <Key size={18} />}
                    Unlock Album
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full tap-full-height bg-slate-950 flex justify-center overflow-hidden">
      {recoveryToastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-green-400/35 bg-slate-900/95 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-green-300 shadow-xl">
          {recoveryToastMessage}
        </div>
      )}
      <div className="w-full max-w-[520px] tap-full-height overflow-hidden flex flex-col md:my-3 md:h-[calc(100dvh-1.5rem)] md:rounded-[2rem] md:border md:border-slate-800/70 md:shadow-2xl">
        {offlineBanner}
        {showInstallCard && (
          <div className="px-4 pt-4">
            <div className="rounded-2xl border border-green-500/30 bg-slate-900/70 px-4 py-3 text-left">
              {showIosInstructions && (
                <p className="mt-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">
                  Add to Home Screen from this album page.
                </p>
              )}
            </div>
          </div>
        )}
        <TAPRenderer
          project={project}
          tracks={tracks}
          isPreview={false}
          showCover={true}
          showMeta={true}
          showAllTracks={true}
          redirectToAlbumOnLoad={true}
          useGoLiveHeader={isPublicGoLiveRoute}
          resolveAssetUrl={resolveAsset}
          resolveTrackAudioUrl={resolveTrackAudioForPlayback}
          suppressBenignPlaybackErrors={true}
          onPlayerStateChange={handlePlayerStateChange}
          showInstallButton={showInstallButton}
          onInstallClick={handleInstallClick}
        />
      </div>
    </div>
  );
};

export default PublicTAPPage;

