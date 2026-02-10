
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ChevronLeft, Globe, Music, Link as LinkIcon, 
  Plus, Trash2, Download, Upload, Camera,
  Image as ImageIcon, MonitorSmartphone, Sparkles, Loader2,
  Instagram, Twitter, Video, Facebook, Music2, Play, Pause, AlertTriangle,
  CheckCircle2, ShieldAlert
} from 'lucide-react';
import { StorageService } from '../services/storage';
import { Api } from '../services/api';
import { Project, Track, ProjectLink, LinkCategory } from '../types';
import TAPRenderer from '../components/TAPRenderer';
import { GoogleGenAI, Type } from "@google/genai";
import { collectAssetRefs, isAssetRef, resolveAssetUrl } from '../services/assets';
import { collectBankRefs, resolveBankUrls, saveBankAsset } from '../services/assetBank';

const EditorPage: React.FC = () => {
  const MAX_TRACKS = 24;
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
  
  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [links, setLinks] = useState<ProjectLink[]>([]);
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
  const [syncTick, setSyncTick] = useState(0);
  const syncTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (projectId) {
      const p = StorageService.getProjectById(projectId);
      if (p) {
        setProject(p);
        setTracks(StorageService.getTracks(projectId));
        setLinks(StorageService.getLinks(projectId));
      } else {
        navigate('/dashboard');
      }
    }
  }, [projectId, navigate]);

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
  }, [activeTab, project]);

  const resolveAsset = (value: string) => resolveAssetUrl(value, assetUrls);

  const ensureSignedAssets = async (refs: string[]) => {
    if (!project) return;
    const missing = refs.filter((ref) => isAssetRef(ref) && !assetUrls[ref]);
    if (missing.length === 0) return;
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
      if (import.meta.env.DEV) {
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'PROJECT_IMAGE' | 'TRACK_IMAGE' | 'TRACK_AUDIO') => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) {
      if (import.meta.env.DEV) {
        console.warn('[DEV] upload canceled', { type });
      }
      return;
    }
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
      const targetIndex = tracks.findIndex((track) => track.trackId === targetTrackId);
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

      const orderedUploads = [
        { trackId: targetTrackId, file: selectedFiles[0] },
        ...newTracks.map((track, index) => ({ trackId: track.trackId, file: selectedFiles[index + 1] }))
      ].filter((item) => item.file);

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
                      <img src={resolveAsset(project.coverImageUrl || '')} alt="Album Art" className="w-full h-full object-cover group-hover:opacity-40 transition-opacity" />
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
              <div className="space-y-6 pb-24 animate-in fade-in duration-300">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-black">Tracklist</h2>
                  <button onClick={handleAddTrack} className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black font-black py-2.5 px-6 rounded-full transition-all text-xs uppercase tracking-widest">
                    <Plus size={16} strokeWidth={3} />
                    Add New Song
                  </button>
                </div>
                {tracks.map((track) => {
                  const isUploading = uploadingTrackId === track.trackId;
                  const uploadPercent = uploadProgress[track.trackId] ?? 0;
                  const isSecureAudio = isAssetRef(track.mp3Url);
                  const isBankAudio = track.mp3Url.startsWith('bank:');
                  const displayMp3Value = track.mp3Url.startsWith('data:')
                    ? 'Local Audio File'
                    : isBankAudio
                      ? 'Local Audio File'
                    : isSecureAudio
                      ? 'Secure Audio File'
                      : track.mp3Url;
                  return (
                  <div key={track.trackId} className="bg-slate-900/40 p-5 rounded-3xl border border-slate-800/50 flex gap-6 group hover:border-slate-700 transition-all">
                    <div onClick={() => triggerFileUpload('TRACK_IMAGE', track.trackId)} className="w-20 h-20 bg-slate-800 rounded-2xl flex-shrink-0 cursor-pointer overflow-hidden border border-slate-700 relative group">
                      <img
                        src={resolveAsset(track.artworkUrl || '') || resolveAsset(project.coverImageUrl || '')}
                        className="w-full h-full object-cover group-hover:opacity-40 transition-opacity"
                        alt="Song Art"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <ImageIcon size={20} className="text-white" />
                      </div>
                    </div>
                    <div className="flex-grow space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input type="text" value={track.title} onChange={(e) => handleUpdateTrack(track.trackId, { title: e.target.value })} placeholder="Song Title" className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500" />
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={displayMp3Value}
                            onChange={(e) => handleUpdateTrack(track.trackId, { mp3Url: e.target.value })}
                            disabled={track.mp3Url.startsWith('data:') || isBankAudio || isSecureAudio || isUploading}
                            placeholder="Audio URL or Spotify Link"
                            className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none"
                          />
                          <button onClick={() => triggerFileUpload('TRACK_AUDIO', track.trackId)} disabled={isUploading} className={`p-2 rounded-xl transition-colors ${isUploading ? 'bg-slate-900 text-slate-600' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}>
                            {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                          </button>
                        </div>
                      </div>
                      {isUploading && (
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                          Uploading {uploadPercent}%
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          {track.mp3Url && (
                            <>
                              <button onClick={() => togglePreview(track)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${previewingTrackId === track.trackId && isPlayingPreview ? 'bg-red-500 text-white' : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'}`}>
                                {previewingTrackId === track.trackId && isPlayingPreview ? <Pause size={12} /> : <Play size={12} />}
                                {previewingTrackId === track.trackId && isPlayingPreview ? 'Stop' : 'Preview'}
                              </button>
                              <button 
                                onClick={() => handleDownloadTrack(track)} 
                                disabled={downloadingTrackId === track.trackId}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${downloadSuccessId === track.trackId ? 'bg-green-500/20 text-green-500' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                              >
                                {downloadingTrackId === track.trackId ? <Loader2 size={12} className="animate-spin" /> : downloadSuccessId === track.trackId ? <CheckCircle2 size={12} /> : <Download size={12} />}
                                {downloadSuccessId === track.trackId ? 'Saved' : 'Save MP3'}
                              </button>
                            </>
                          )}
                          {!track.mp3Url.startsWith('data:') && !isSecureAudio && track.mp3Url && (
                            <button onClick={() => handleMagicResolve(track)} className="p-1.5 bg-slate-800 text-green-400 rounded-lg hover:bg-slate-700 transition-colors" title="Magic Resolve">
                              {resolvingTrackId === track.trackId ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                            </button>
                          )}
                        </div>
                        <button onClick={() => handleDeleteTrack(track.trackId)} className="p-2 text-slate-700 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                      </div>
                    </div>
                  </div>
                )})}
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-8 animate-in fade-in duration-300 pb-10">
                <section className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/50">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-xl font-black flex items-center gap-2">
                        <ShieldAlert size={20} className="text-green-500" />
                        Email Gate
                      </h2>
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Email verification + single PIN unlock</p>
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                      Active
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">PIN Allowance</p>
                      <p className="text-sm font-bold text-slate-100">1,000,000 uses per email</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
                        Count decreases only after a successful PIN unlock.
                      </p>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Album Unlock Capacity</p>
                      <p className="text-sm font-bold text-slate-100">1,000,000 active unlocks per album</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
                        Each verified email unlock is counted per project and does not reduce other emails.
                      </p>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Album Active PIN Capacity</p>
                      <p className="text-sm font-bold text-slate-100">1,000,000 active PINs per album</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
                        Concurrent active PIN issuance is isolated per project and does not impact other albums.
                      </p>
                    </div>
                  </div>
                </section>

                <section className="p-6 bg-slate-900/40 rounded-3xl border border-slate-800/50">
                  <h4 className="text-xs font-black uppercase tracking-widest text-green-500 mb-4">Current Email Status</h4>
                  {!localStorage.getItem('tap_auth_token') && (
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                      No verified email on this device yet.
                    </p>
                  )}

                  {localStorage.getItem('tap_auth_token') && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                        <div>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Email</p>
                          <p className="text-sm font-bold text-white">{localStorage.getItem('tap_auth_email') || 'Unknown'}</p>
                        </div>
                        {accessLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
                      </div>

                      {accessError && (
                        <div className="flex items-center gap-2 text-red-400 text-[10px] font-black uppercase tracking-widest">
                          <AlertTriangle size={14} />
                          {accessError}
                        </div>
                      )}

                      {accessStatus && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Verified</p>
                            <p className={`text-sm font-bold ${accessStatus.verified ? 'text-green-400' : 'text-slate-400'}`}>
                              {accessStatus.verified ? 'Yes' : 'No'}
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Unlocked</p>
                            <p className={`text-sm font-bold ${accessStatus.unlocked ? 'text-green-400' : 'text-slate-400'}`}>
                              {accessStatus.unlocked ? 'Yes' : 'No'}
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Remaining Uses</p>
                            <p className="text-sm font-bold text-white">{accessStatus.remaining}</p>
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Active PIN</p>
                            <p className={`text-sm font-bold ${accessStatus.hasActivePin ? 'text-green-400' : 'text-slate-400'}`}>
                              {accessStatus.hasActivePin ? 'Issued' : 'None'}
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Album Unlocks Used</p>
                            <p className="text-sm font-bold text-white">
                              {typeof accessStatus.projectUnlocksUsed === 'number'
                                ? accessStatus.projectUnlocksUsed.toLocaleString()
                                : 'N/A'}
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Album Unlocks Remaining</p>
                            <p className="text-sm font-bold text-white">
                              {typeof accessStatus.projectUnlocksRemaining === 'number'
                                ? accessStatus.projectUnlocksRemaining.toLocaleString()
                                : 'N/A'}
                            </p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
                              Limit:{' '}
                              {typeof accessStatus.projectUnlocksLimit === 'number'
                                ? accessStatus.projectUnlocksLimit.toLocaleString()
                                : '1,000,000'}
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Album Active PINs Used</p>
                            <p className="text-sm font-bold text-white">
                              {typeof accessStatus.projectActivePinsUsed === 'number'
                                ? accessStatus.projectActivePinsUsed.toLocaleString()
                                : 'N/A'}
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Album Active PINs Remaining</p>
                            <p className="text-sm font-bold text-white">
                              {typeof accessStatus.projectActivePinsRemaining === 'number'
                                ? accessStatus.projectActivePinsRemaining.toLocaleString()
                                : 'N/A'}
                            </p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
                              Limit:{' '}
                              {typeof accessStatus.projectActivePinsLimit === 'number'
                                ? accessStatus.projectActivePinsLimit.toLocaleString()
                                : '1,000,000'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeTab === 'links' && (
              <div className="space-y-10 pb-10 animate-in fade-in duration-300">
                <section className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/50">
                  <h2 className="text-xl font-black mb-6">Commerce Badges</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Tickets URL</label>
                      <input type="text" placeholder="https://..." value={project.ticketsUrl || ''} onChange={(e) => handleSaveProject({ ticketsUrl: e.target.value })} className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 text-white" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Merch Store URL</label>
                      <input type="text" placeholder="https://..." value={project.merchUrl || ''} onChange={(e) => handleSaveProject({ merchUrl: e.target.value })} className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 text-white" />
                    </div>
                  </div>
                </section>

                <section className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/50">
                  <h2 className="text-xl font-black mb-6">Social Badge Profiles</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                      { key: 'instagramUrl', label: 'Instagram', icon: <Instagram size={18} />, color: 'text-pink-500' },
                      { key: 'twitterUrl', label: 'Twitter', icon: <Twitter size={18} />, color: 'text-blue-400' },
                      { key: 'tiktokUrl', label: 'TikTok', icon: <Music2 size={18} />, color: 'text-white' },
                      { key: 'youtubeUrl', label: 'YouTube', icon: <Video size={18} />, color: 'text-red-500' },
                      { key: 'facebookUrl', label: 'Facebook', icon: <Facebook size={18} />, color: 'text-blue-600' }
                    ].map(social => (
                      <div key={social.key} className="flex items-center gap-3">
                        <div className={`p-2 bg-slate-800 rounded-lg ${social.color}`}>{social.icon}</div>
                        <input type="text" placeholder={`${social.label} handle or URL`} value={(project as any)[social.key] || ''} onChange={(e) => handleSaveProject({ [social.key]: e.target.value })} className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 text-white" />
                      </div>
                    ))}
                  </div>
                </section>

                <section className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/50">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-black">Streaming & Deep Links</h2>
                    <div className="flex gap-2">
                      <button onClick={() => handleAddLink(LinkCategory.STREAMING)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-green-400 transition-colors"><Music size={16} /></button>
                      <button onClick={() => handleAddLink(LinkCategory.OTHER)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 transition-colors"><Plus size={16} /></button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {links.map(link => (
                      <div key={link.linkId} className="flex items-center gap-3 bg-slate-800/30 p-3 rounded-2xl border border-slate-800/50">
                        <input type="text" value={link.label} onChange={(e) => handleUpdateLink(link.linkId, { label: e.target.value })} className="w-1/3 bg-transparent text-sm font-bold focus:outline-none" />
                        <input type="text" value={link.url} onChange={(e) => handleUpdateLink(link.linkId, { url: e.target.value })} className="flex-1 bg-transparent text-sm text-slate-400 focus:outline-none" />
                        <button onClick={() => handleDeleteLink(link.linkId)} className="p-1.5 text-slate-700 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>

        {showMobilePreview && (
          <div className="relative hidden lg:flex flex-col w-[440px] p-10 items-center justify-center sticky top-0 h-[calc(100vh-73px)] bg-[radial-gradient(ellipse_at_top,_rgba(34,197,94,0.12),_transparent_55%)] overflow-hidden">
            <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-72 h-72 bg-green-500/10 blur-3xl rounded-full"></div>
            <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 w-72 h-20 bg-white/5 blur-2xl rounded-full"></div>
            <div className="mb-6 text-[10px] uppercase tracking-[0.4em] font-black text-slate-600">Device Preview</div>
            <div className="relative w-[300px] h-[600px] bg-slate-950/95 rounded-[50px] border-[8px] border-slate-800/80 shadow-[0_40px_90px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col scale-105 ring-1 ring-slate-800/60">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-5 bg-slate-800/90 rounded-b-2xl z-40"></div>
              <div className="absolute top-6 left-1/2 -translate-x-1/2 w-16 h-1 bg-slate-800/70 rounded-full"></div>
              <div className="flex-1 overflow-hidden">
                <TAPRenderer project={project} tracks={tracks} isPreview={true} showCover={true} resolveAssetUrl={resolveAsset} />
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default EditorPage;
