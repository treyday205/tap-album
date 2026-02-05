
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { StorageService } from '../services/storage';
import { Project, EventType } from '../types';
import { Api } from '../services/api';
import { 
  ChevronLeft, ShieldCheck, Play, Download, 
  Smartphone, CheckCircle2, Loader2, ShieldAlert, 
  ArrowRight, XCircle, PlusCircle, Share2
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { isAssetRef, resolveAssetUrl } from '../services/assets';
import { collectBankRefs, resolveBankUrls } from '../services/assetBank';

const WalletPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [isActivated, setIsActivated] = useState(false);
  const [verification, setVerification] = useState<string>('Authenticating signature...');
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  
  // Activation State
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  
  // PWA State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);

  useEffect(() => {
    if (slug) {
      const p = StorageService.getProjectBySlug(slug);
      if (p) {
        setProject(p);
        const unlocked = localStorage.getItem(`tap_unlocked_${p.projectId}`) === 'true';
        setIsActivated(unlocked);
        if (unlocked) {
          generateVerification(p);
        }
      } else {
        navigate('/');
      }
      setLoading(false);
    }

    // PWA Install Prompt Listener
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, [slug, navigate]);

  useEffect(() => {
    const signCover = async () => {
      if (!project || !isAssetRef(project.coverImageUrl)) return;
      if (assetUrls[project.coverImageUrl]) return;
      const token = localStorage.getItem('tap_auth_token') || undefined;
      try {
        const response = await Api.signAssets(project.projectId, [project.coverImageUrl], token || undefined);
        const next = { ...assetUrls };
        (response.assets || []).forEach((asset: any) => {
          if (asset?.ref && asset?.url) {
            next[asset.ref] = asset.url;
          }
        });
        setAssetUrls(next);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[DEV] cover signing failed', err);
        }
      }
    };

    signCover();
  }, [project]);

  useEffect(() => {
    const hydrateBankCover = async () => {
      if (!project) return;
      const refs = collectBankRefs([project.coverImageUrl]);
      const missing = refs.filter((ref) => !assetUrls[ref]);
      if (missing.length === 0) return;
      try {
        const resolved = await resolveBankUrls(missing);
        if (Object.keys(resolved).length > 0) {
          setAssetUrls((prev) => ({ ...prev, ...resolved }));
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[DEV] bank cover hydration failed', err);
        }
      }
    };

    hydrateBankCover();
  }, [project, assetUrls]);

  const resolveAsset = (value: string) => resolveAssetUrl(value, assetUrls);

  const generateVerification = async (p: Project) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate a short, formal "Certificate of Authenticity" message for an album ownership pass. 
        Album: ${p.title}
        Artist: ${p.artistName}
        ID: ${p.slug}
        Make it sound like a premium blockchain or high-end physical verification. Max 20 words. Include a fake hex signature.`,
      });
      setVerification(response.text || 'AUTHENTICATED BY TAP SECURE NETWORK');
    } catch (e) {
      setVerification('OFFICIAL RELEASE - SIGNATURE VERIFIED: 0x' + Math.random().toString(16).slice(2, 10).toUpperCase());
    }
  };

  const handleActivate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    
    setIsActivating(true);
    setPinError(null);

    // Simulated verification delay
    setTimeout(() => {
      const pins = project.activationPins || [];
      const used = project.usedPins || [];

      if (pins.includes(pin)) {
        if (used.includes(pin)) {
          setPinError('This code has already been claimed.');
          StorageService.logEvent(project.projectId, EventType.ACTIVATION_FAILED, 'Used PIN');
        } else {
          const updatedUsed = [...used, pin];
          const updatedProject = { ...project, usedPins: updatedUsed };
          StorageService.saveProject(updatedProject);
          setProject(updatedProject);
          
          localStorage.setItem(`tap_unlocked_${project.projectId}`, 'true');
          setIsActivated(true);
          generateVerification(project);
          StorageService.logEvent(project.projectId, EventType.ACTIVATION_SUCCESS, pin);
        }
      } else {
        setPinError('Invalid activation code.');
        StorageService.logEvent(project.projectId, EventType.ACTIVATION_FAILED, 'Invalid PIN');
      }
      setIsActivating(false);
    }, 800);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBtn(false);
    }
    setDeferredPrompt(null);
  };

  if (loading || !project) return null;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(window.location.origin + '/' + project.slug)}`;

  return (
    <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center justify-center animate-in fade-in duration-700">
      {/* Navigation Header */}
      <div className="fixed top-0 left-0 w-full p-6 flex items-center justify-between z-50 pt-safe">
        <button onClick={() => navigate(-1)} className="p-3 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-all">
          <ChevronLeft size={20} />
        </button>
        <div className="flex flex-col items-center">
            <span className="text-[10px] font-black uppercase tracking-[0.4em] opacity-50">TAP WALLET</span>
            <div className="w-1 h-1 bg-green-500 rounded-full mt-1"></div>
        </div>
        <button className="p-3 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-all opacity-0">
          <Download size={20} />
        </button>
      </div>

      {!isActivated ? (
        /* Activation Form */
        <div className="w-full max-w-sm animate-in zoom-in-95 duration-500">
          <div className="mb-12 flex flex-col items-center text-center">
             <div className="w-20 h-20 bg-green-500/10 rounded-[2.5rem] border border-green-500/20 flex items-center justify-center text-green-500 mb-8 shadow-2xl shadow-green-500/20">
                <ShieldAlert size={40} />
             </div>
             <h1 className="text-4xl font-black tracking-tight mb-4">Claim Ownership</h1>
             <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] max-w-[280px] leading-relaxed">
               Enter the unique PIN from your physical hardware to unlock your digital pass.
             </p>
          </div>

          <form onSubmit={handleActivate} className="space-y-6">
            <div className="relative group">
              <input
                type="text"
                value={pin}
                onChange={(e) => setPin(e.target.value.toUpperCase().replace(/[^0-9]/g, ''))}
                placeholder="000000"
                maxLength={6}
                className={`w-full bg-zinc-900 border ${pinError ? 'border-red-500/50' : 'border-zinc-800'} focus:border-green-500 rounded-[2rem] px-8 py-6 text-center text-3xl font-mono font-black tracking-[0.6em] text-white outline-none transition-all placeholder:text-zinc-800`}
                disabled={isActivating}
              />
              {pinError && (
                <div className="flex items-center justify-center gap-2 mt-4 text-red-500 text-[10px] font-black uppercase tracking-widest animate-in slide-in-from-top-1">
                  <XCircle size={14} />
                  {pinError}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={pin.length < 6 || isActivating}
              className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] flex items-center justify-center gap-3 transition-all ${
                pin.length === 6 && !isActivating 
                ? 'bg-green-500 text-black shadow-[0_20px_40px_-10px_rgba(34,197,94,0.4)] active:scale-95' 
                : 'bg-zinc-900 text-zinc-700 cursor-not-allowed'
              }`}
            >
              {isActivating ? <Loader2 size={18} className="animate-spin" /> : <>Verify & Claim <ArrowRight size={18} /></>}
            </button>
          </form>
        </div>
      ) : (
        /* The Pass UI */
        <>
          <div className="w-full max-w-sm relative group mb-12 animate-in zoom-in-95 duration-700">
            {/* Holographic Shimmer Effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-green-600 via-emerald-400 to-green-600 rounded-[3.5rem] blur opacity-20 group-hover:opacity-40 transition-opacity duration-1000 animate-pulse"></div>
            
            <div className="relative bg-zinc-950 rounded-[3rem] overflow-hidden border border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.8)] flex flex-col min-h-[580px]">
              {/* Pass Header */}
              <div className="h-28 bg-gradient-to-b from-green-500/20 to-transparent p-8 flex justify-between items-start">
                 <div className="flex items-center gap-4">
                   <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center shadow-lg shadow-green-500/20">
                     <ShieldCheck className="text-black" size={28} />
                   </div>
                   <div>
                      <h3 className="text-[11px] font-black uppercase tracking-widest text-green-500 leading-none mb-1.5">
                        Activated Ownership
                      </h3>
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">TAP SECURE NETWORK</p>
                   </div>
                 </div>
                 <div className="flex items-center gap-1.5 bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
                    <CheckCircle2 size={10} className="text-green-500" />
                    <span className="text-[8px] font-black uppercase text-green-500">Verified</span>
                 </div>
              </div>

              {/* Album Content */}
              <div className="px-8 flex-grow">
                <div className="aspect-square w-full rounded-3xl overflow-hidden mb-8 border border-white/5 shadow-2xl">
                  <img src={resolveAsset(project.coverImageUrl)} className="w-full h-full object-cover" alt="Album Art" />
                </div>

                <div className="space-y-1 text-center mb-8">
                  <h1 className="text-3xl font-black tracking-tight">{project.title}</h1>
                  <p className="text-green-500 font-bold uppercase tracking-[0.2em] text-xs">{project.artistName}</p>
                </div>

                <div className="p-5 bg-white/[0.03] rounded-2xl border border-white/5 mb-8">
                   <p className="text-[10px] font-mono text-slate-500 leading-relaxed text-center italic">
                     {verification}
                   </p>
                </div>
              </div>

              {/* Authenticated QR Footer */}
              <div className="bg-white p-8 flex flex-col items-center justify-center gap-6 mt-auto">
                <div className="bg-white p-2 border border-slate-100 rounded-2xl shadow-sm">
                   <img src={qrUrl} className="w-24 h-24" alt="Verification QR" />
                </div>
                <div className="text-center">
                  <p className="text-black font-black text-[10px] uppercase tracking-[0.3em] leading-none mb-2">Authenticated Entry</p>
                  <p className="text-slate-400 text-[9px] font-bold uppercase tracking-widest">Global ID: {project.slug.toUpperCase()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Store on Device Actions */}
          <div className="w-full max-w-sm space-y-4 animate-in slide-in-from-bottom-6 duration-1000 delay-200">
            {showInstallBtn ? (
              <button 
                onClick={handleInstallClick}
                className="w-full bg-green-500 text-black font-black py-5 rounded-[2rem] flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-green-500/20 text-xs uppercase tracking-widest"
              >
                <Smartphone size={18} />
                Add to Home Screen
              </button>
            ) : (
                <div className="flex flex-col items-center gap-4 py-4">
                    <div className="flex items-center gap-2 text-green-500/50 text-[10px] font-black uppercase tracking-[0.3em]">
                        <CheckCircle2 size={14} />
                        Stored on Device
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3">
                <button 
                    onClick={() => navigate(`/${project.slug}`)}
                    className="bg-white text-black font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 text-[10px] uppercase tracking-widest"
                >
                    <Play size={14} fill="currentColor" />
                    Open Album
                </button>
                <button 
                    onClick={() => {
                        if (navigator.share) {
                            navigator.share({ title: project.title, url: window.location.href });
                        }
                    }}
                    className="bg-zinc-900 border border-zinc-800 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 text-[10px] uppercase tracking-widest"
                >
                    <Share2 size={14} />
                    Share Pass
                </button>
            </div>

            <p className="text-center text-slate-500 text-[10px] font-bold uppercase tracking-widest leading-relaxed px-6 py-4">
               Save this pass to your home screen for persistent high-fidelity access.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default WalletPage;
