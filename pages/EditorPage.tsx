
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
import { collectAssetRefs, isAssetRef, resolveAssetUrl } from '../services/assets';
import { collectBankRefs, resolveBankUrls, saveBankAsset } from '../services/assetBank';
import ResponsiveImage from '../components/ResponsiveImage';

const TracklistTab = lazy(() => import('../components/editor/EditorTracklistTab'));
const LinksTab = lazy(() => import('../components/editor/EditorLinksTab'));
const SecurityTab = lazy(() => import('../components/editor/EditorSecurityTab'));
const DistributionV2 = lazy(() => import('../components/editor/EditorDistributionV2'));
const DevicePreview = lazy(() => import('../components/editor/EditorDevicePreview'));

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
  const [uploadingTrackId, setUploadingTrackId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const signedAssetRequestsRef = useRef(new Set<string>());
  const bankAssetRequestsRef = useRef(new Set<string>());
  
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

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[DEV] Security tab mode:', SECURITY_V2_ENABLED ? 'V2' : 'V1');
    }
  }, [SECURITY_V2_ENABLED]);

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
        navigate('/dashboard');
      }
      setIsLoadingProject(false);
    }
  }, [projectId, navigate]);

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

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });

  const storeLocalImageAsset = async (
    file: File,
    meta: { projectId: string; kind: string; trackId?: string }
  ): Promise<string> => {
    try {
      const stored = await saveBankAsset(file, meta);
      if (stored?.ref) {
        setAssetUrls((prev) => ({ ...prev, [stored.ref]: stored.url }));
        return stored.ref;
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[DEV] asset bank save failed, falling back to data URL', err);
      }
    }

    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl) {
      throw new Error('Unable to store image locally.');
    }
    return dataUrl;
  };

  const storeLocalAudioAsset = async (
    file: File,
    meta: { projectId: string; trackId?: string }
  ): Promise<string> => {
    const stored = await saveBankAsset(file, {
      projectId: meta.projectId,
      trackId: meta.trackId,
      kind: 'track-audio'
    });
    if (stored?.ref) {
      setAssetUrls((prev) => ({ ...prev, [stored.ref]: stored.url }));
      return stored.ref;
    }
    throw new Error('Unable to store audio locally.');
  };

  useEffect(() => {
    if (!project) return;
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
            navigate('/dashboard');
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
      let selectedFiles = files;
      const maxNewTracks = Math.max(0, MAX_TRACKS - tracks.length);
      const maxFiles = 1 + maxNewTracks;
      if (selectedFiles.length > maxFiles) {
        selectedFiles = selectedFiles.slice(0, maxFiles);
        alert(`You can upload up to ${maxFiles} files right now (limit ${MAX_TRACKS} tracks).`);
      }

      const newTracks: Track[] = [];
      if (selectedFiles.length > 1) {
        for (let i = 1; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          if (!file) continue;
          const newTrack: Track = {
            trackId: Math.random().toString(36).substr(2, 9),
            projectId: projectId!,
            title: autoTitle(file.name),
            mp3Url: '',
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
          const result = await Api.uploadTrackAudio(file, projectId, trackId, (percent) => {
            setUploadProgress(prev => ({ ...prev, [trackId]: percent }));
          });
          const assetRef = result?.assetRef || '';
          if (!assetRef) {
            throw new Error('Upload did not return a file URL.');
          }
          handleUpdateTrack(trackId, {
            mp3Url: assetRef,
            title: autoTitle(file.name)
          });
          ensureSignedAssets([assetRef]);
        } catch (err) {
          try {
            const localRef = await storeLocalAudioAsset(file, { projectId, trackId });
            handleUpdateTrack(trackId, {
              mp3Url: localRef,
              title: autoTitle(file.name)
            });
            setUploadError(null);
          } catch (fallbackErr: any) {
            throw fallbackErr || err;
          }
        }
      };

      try {
        for (const item of orderedUploads) {
          await uploadAudioToTrack(item.file, item.trackId);
        }
      } catch (err: any) {
        const message = err?.message || 'Upload failed.';
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
        if (!assetRef) {
          throw new Error('Upload did not return a file URL.');
        }
        const adminToken = localStorage.getItem('tap_admin_token') || undefined;
        try {
          const persisted = await Api.updateProjectCover(projectId, assetRef, adminToken);
          const persistedCover = String(
            persisted?.project?.coverImageUrl ||
            persisted?.coverPath ||
            assetRef
          ).trim();
          handleSaveProject({
            coverImageUrl: persistedCover,
            updatedAt: persisted?.project?.updatedAt || new Date().toISOString()
          });
        } catch {
          handleSaveProject({ coverImageUrl: assetRef });
        }
        ensureSignedAssets([assetRef]);
      } catch (err: any) {
        try {
          const localRef = await storeLocalImageAsset(file, {
            projectId,
            kind: 'project-cover'
          });
          handleSaveProject({ coverImageUrl: localRef });
          setUploadError(null);
        } catch (fallbackErr: any) {
          const message = fallbackErr?.message || err?.message || 'Upload failed.';
          setUploadError(message);
          alert(message);
        }
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
    } catch (err: any) {
      try {
        const localRef = await storeLocalImageAsset(file, {
          projectId,
          trackId: uploadTargetTrackId,
          kind: 'track-artwork'
        });
        handleUpdateTrack(uploadTargetTrackId, { artworkUrl: localRef });
        setUploadError(null);
      } catch (fallbackErr: any) {
        const message = fallbackErr?.message || err?.message || 'Upload failed.';
        setUploadError(message);
        alert(message);
      }
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

  const handleUpdateTrack = (id: string, updates: Partial<Track>) => {
    const updatedTracks = tracks.map(t => t.trackId === id ? { ...t, ...updates } : t);
    setTracks(updatedTracks);
    const track = updatedTracks.find(t => t.trackId === id);
    if (track) StorageService.saveTrack(track);

    if (updates.mp3Url && updates.mp3Url.includes('spotify.com') && !updates.mp3Url.includes('p.scdn.co')) {
      const targetTrack = updatedTracks.find(t => t.trackId === id);
      if (targetTrack) handleMagicResolve(targetTrack);
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

  const togglePreview = (track: Track) => {
    if (!audioPreviewRef.current) return;
    if (previewingTrackId === track.trackId && isPlayingPreview) {
      stopPreview();
    } else {
      const resolvedUrl = resolveAsset(track.mp3Url || '');
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
    const url = resolveAsset(track.mp3Url || '').trim();
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
    <div className="relative hidden lg:flex flex-col w-[440px] p-10 items-center justify-center sticky top-0 h-[calc(100vh-73px)]">
      <div className="mb-6 h-3 w-40 bg-slate-800/60 rounded-full animate-pulse" />
      <div className="w-[300px] h-[600px] bg-slate-900/70 rounded-[50px] border border-slate-800/60 animate-pulse" />
    </div>
  );

  if (isLoadingProject) return <EditorSkeleton />;
  if (!project) return null;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100">
      <audio ref={audioPreviewRef} onEnded={stopPreview} className="hidden" />
      <input type="file" ref={projectImageInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'PROJECT_IMAGE')} />
      <input type="file" ref={trackImageInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'TRACK_IMAGE')} />
      <input type="file" ref={trackAudioInputRef} className="hidden" accept="audio/*" multiple onChange={(e) => handleFileUpload(e, 'TRACK_AUDIO')} />

      <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400">
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
          <button onClick={() => setShowMobilePreview(!showMobilePreview)} className={`hidden lg:flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all ${showMobilePreview ? 'bg-slate-800 text-green-400' : 'bg-slate-900 text-slate-500'}`}>
            <MonitorSmartphone size={16} />
            Device View
          </button>
          <Link to={`/${project.slug}`} target="_blank" className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-full transition-colors shadow-lg shadow-green-500/10">
            <Globe size={16} />
            <span className="hidden sm:inline">Go Live</span>
          </Link>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
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
                        assetRef={project.coverImageUrl}
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
                  uploadingTrackId={uploadingTrackId}
                  uploadProgress={uploadProgress}
                  previewingTrackId={previewingTrackId}
                  isPlayingPreview={isPlayingPreview}
                  downloadingTrackId={downloadingTrackId}
                  downloadSuccessId={downloadSuccessId}
                  resolvingTrackId={resolvingTrackId}
                  handleAddTrack={handleAddTrack}
                  handleUpdateTrack={handleUpdateTrack}
                  triggerFileUpload={triggerFileUpload}
                  togglePreview={togglePreview}
                  handleDownloadTrack={handleDownloadTrack}
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
            <DevicePreview project={project} tracks={tracks} resolveAssetUrl={resolveAsset} />
          </Suspense>
        )}
      </div>

    </div>
  );
};

export default EditorPage;
