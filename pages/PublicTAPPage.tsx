import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { StorageService } from '../services/storage';
import { Project, Track, EventType } from '../types';
import TAPRenderer from '../components/TAPRenderer';
import { Api, API_BASE_URL } from '../services/api';
import { ShieldAlert, Mail, ArrowRight, Loader2, CheckCircle2, XCircle, Key } from 'lucide-react';
import { collectAssetRefs, resolveAssetUrl, isAssetRef } from '../services/assets';
import { collectBankRefs, resolveBankUrls } from '../services/assetBank';
import {
  buildSupabaseEmailRedirectUrl,
  hasSupabaseAuthUrlState,
  isSupabaseAuthEnabled,
  supabaseAuthClient
} from '../services/supabaseAuth';

const AUTH_TOKEN_KEY = 'tap_auth_token';
const AUTH_EMAIL_KEY = 'tap_auth_email';
const IS_DEV = import.meta.env.DEV;

const PublicTAPPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});

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
  const autoVerifyRef = useRef(false);
  const supabaseExchangeInFlightRef = useRef<Promise<string | null> | null>(null);
  const lastSupabaseAccessTokenRef = useRef<string | null>(null);
  const cleanedSupabaseUrlRef = useRef(false);

  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    const loadProject = async () => {
      setLoading(true);
      try {
        const response = await Api.getProjectBySlug(slug);
        setProject(response.project);
        setTracks(response.tracks || []);
        StorageService.logEvent(response.project.projectId, EventType.VIEW, 'Page Load');
        if (IS_DEV) {
          console.log('[DEBUG] project load (api)', {
            projectId: response.project.projectId,
            slug: response.project.slug,
            tracks: response.tracks?.length || 0,
            project: response.project
          });
        }
      } catch (err) {
        const p = StorageService.getProjectBySlug(slug);
        if (p && p.published) {
          setProject(p);
          setTracks(StorageService.getTracks(p.projectId));
          StorageService.logEvent(p.projectId, EventType.VIEW, 'Page Load');
          if (IS_DEV) {
            console.log('[DEBUG] project load (local)', {
              projectId: p.projectId,
              slug: p.slug,
              tracks: StorageService.getTracks(p.projectId).length,
              project: p
            });
          }
        }
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [slug]);

  useEffect(() => {
    if (!project?.slug || typeof window === 'undefined') return;

    const isTapRoute = window.location.pathname.startsWith('/t/');
    const albumPath = isTapRoute ? `/t/${project.slug}` : `/${project.slug}`;
    const manifestUrl = new URL('/api/pwa/manifest', window.location.origin);
    manifestUrl.searchParams.set('slug', project.slug);
    manifestUrl.searchParams.set('path', albumPath);

    let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    const createdManifestLink = !manifestLink;
    const previousManifestHref = manifestLink?.getAttribute('href') || '/manifest.webmanifest';
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.setAttribute('rel', 'manifest');
      document.head.appendChild(manifestLink);
    }
    manifestLink.setAttribute('href', `${manifestUrl.pathname}${manifestUrl.search}`);

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
      if (createdManifestLink) {
        manifestLink?.remove();
      } else if (manifestLink) {
        manifestLink.setAttribute('href', previousManifestHref);
      }
      if (themeMeta && previousTheme) {
        themeMeta.setAttribute('content', previousTheme);
      }
      if (appleTitleMeta && previousAppleTitle) {
        appleTitleMeta.setAttribute('content', previousAppleTitle);
      }
    };
  }, [project?.slug, project?.title]);

  useEffect(() => {
    const search = window.location.search || '';
    let params = new URLSearchParams(search);
    if ([...params.keys()].length === 0) {
      const hash = window.location.hash || '';
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
  }, []);

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
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_EMAIL_KEY);
        lastSupabaseAccessTokenRef.current = null;
        setIsUnlocked(false);
      }
    };

    checkAccess();
    return () => {
      canceled = true;
    };
  }, [project]);

  const resolveAsset = (value: string) => resolveAssetUrl(value, assetUrls);

  const ensureSignedAssets = async (refs: string[]) => {
    if (!project) return;
    const missing = refs.filter((ref) => isAssetRef(ref) && !assetUrls[ref]);
    if (missing.length === 0) return;
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token && (project.emailGateEnabled ?? true)) return;
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
      if (IS_DEV) {
        console.warn('[DEV] asset signing failed', err);
      }
    }
  };

  const ensureBankAssets = async (refs: string[]) => {
    const missing = refs.filter((ref) => !assetUrls[ref]);
    if (missing.length === 0) return;
    try {
      const resolved = await resolveBankUrls(missing);
      if (Object.keys(resolved).length > 0) {
        setAssetUrls((prev) => ({ ...prev, ...resolved }));
      }
    } catch (err) {
      if (IS_DEV) {
        console.warn('[DEV] bank asset hydration failed', err);
      }
    }
  };

  useEffect(() => {
    if (!project || !isUnlocked) return;
    const values = [
      project.coverImageUrl,
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

  const resetAuth = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_EMAIL_KEY);
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
    localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
    localStorage.setItem(AUTH_EMAIL_KEY, payload.email);
    setRemaining(payload.remaining ?? null);
  };

  const exchangeSupabaseSession = async (projectId: string, accessToken: string): Promise<string | null> => {
    if (!projectId || !accessToken) return null;
    const existingToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (lastSupabaseAccessTokenRef.current === accessToken && existingToken) {
      return existingToken;
    }
    const response = await Api.exchangeSupabaseSession(projectId, accessToken);
    persistAuthPayload(response);
    lastSupabaseAccessTokenRef.current = accessToken;
    return response.token || null;
  };

  const ensureAppToken = async (projectId: string): Promise<string | null> => {
    const existingToken = localStorage.getItem(AUTH_TOKEN_KEY);
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

  const openModal = async () => {
    resetModal();
    setShowModal(true);
    const effectiveProjectId = project?.projectId || routeProjectId;
    if (!effectiveProjectId) {
      setStep('email');
      return;
    }

    let token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      token = await ensureAppToken(effectiveProjectId);
    }
    if (!token) {
      setStep('email');
      return;
    }

    setIsIssuing(true);
    try {
      const status = await Api.getAccessStatus(effectiveProjectId, token);
      if (status?.verified) {
        setStep('pin');
        await handleIssuePin(token, effectiveProjectId);
      } else {
        resetAuth();
        setStep('email');
      }
    } catch {
      resetAuth();
      setStep('email');
    } finally {
      setIsIssuing(false);
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
    setIsSending(true);
    setError(null);

    try {
      setEmail(normalizedEmail);
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
      setVerificationId(response.verificationId);
      setDevCode(response.devCode || null);
      setStep('code');
    } catch (err: any) {
      setError(err.message || 'Could not send magic link.');
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
    if (!autoVerifyPayload || !project || autoVerifyRef.current) return;
    autoVerifyRef.current = true;
    performVerifyMagic(autoVerifyPayload.verificationId, autoVerifyPayload.code).finally(() => {
      const cleanUrl = window.location.href.split('?')[0];
      window.history.replaceState({}, document.title, cleanUrl);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center tap-full-height bg-slate-950">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center tap-full-height bg-slate-950 px-6 text-center tap-safe-top tap-safe-bottom">
        <h1 className="text-2xl font-bold mb-2">TAP Not Found</h1>
        <p className="text-slate-400 italic">This album experience is currently private or does not exist.</p>
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="w-full tap-full-height bg-slate-950 flex flex-col items-center justify-center px-5 sm:px-8 text-center animate-in fade-in duration-700 tap-safe-top tap-safe-bottom">
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
            Continue with Email
            <ArrowRight size={18} />
          </button>

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
                      resetAuth();
                      setShowModal(false);
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
      <div className="w-full max-w-[520px] tap-full-height overflow-hidden flex flex-col md:my-3 md:h-[calc(100dvh-1.5rem)] md:rounded-[2rem] md:border md:border-slate-800/70 md:shadow-2xl">
        <TAPRenderer project={project} tracks={tracks} isPreview={false} showCover={true} showMeta={true} showAllTracks={true} resolveAssetUrl={resolveAsset} />
      </div>
    </div>
  );
};

export default PublicTAPPage;
