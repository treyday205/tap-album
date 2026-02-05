
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Settings, Eye, Layout, Share2, Trash2, LogOut, ShieldCheck } from 'lucide-react';
import { StorageService } from '../services/storage';
import { Api } from '../services/api';
import { Project, User } from '../types';
import { isAssetRef, resolveAssetUrl } from '../services/assets';
import { collectBankRefs, resolveBankUrls } from '../services/assetBank';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const currentUser = StorageService.getCurrentUser();
    setUser(currentUser);
    setProjects(StorageService.getProjects());
  }, []);

  useEffect(() => {
    const signCovers = async () => {
      const updates: Record<string, string> = {};
      for (const project of projects) {
        if (!isAssetRef(project.coverImageUrl)) continue;
        if (assetUrls[project.coverImageUrl]) continue;
        try {
          const token = localStorage.getItem('tap_admin_token') || localStorage.getItem('tap_auth_token') || undefined;
          const response = await Api.signAssets(project.projectId, [project.coverImageUrl], token);
          (response.assets || []).forEach((asset: any) => {
            if (asset?.ref && asset?.url) {
              updates[asset.ref] = asset.url;
            }
          });
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn('[DEV] cover signing failed', err);
          }
        }
      }
      if (Object.keys(updates).length > 0) {
        setAssetUrls(prev => ({ ...prev, ...updates }));
      }
    };

    if (projects.length) {
      signCovers();
    }
  }, [projects]);

  useEffect(() => {
    const hydrateBankCovers = async () => {
      const refs = collectBankRefs(projects.map((project) => project.coverImageUrl));
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

    if (projects.length) {
      hydrateBankCovers();
    }
  }, [projects, assetUrls]);

  const resolveAsset = (value: string) => resolveAssetUrl(value, assetUrls);

  const handleLogout = () => {
    localStorage.removeItem('tap_is_admin');
    localStorage.removeItem('tap_admin_token');
    navigate('/admin');
  };

  const generateSecureSlug = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let slug = 'tap-';
    for (let i = 0; i < 10; i++) {
      slug += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return slug;
  };

  const handleCreateNew = () => {
    const newProject: Project = {
      projectId: Math.random().toString(36).substr(2, 9),
      ownerUserId: user?.userId || 'u1',
      slug: generateSecureSlug(),
      title: 'New Album',
      artistName: user?.displayName || 'Artist Name',
      coverImageUrl: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=800',
      published: false,
      emailGateEnabled: true,
      instagramUrl: '',
      twitterUrl: '',
      tiktokUrl: '',
      youtubeUrl: '',
      facebookUrl: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPrivate: true
    };
    StorageService.saveProject(newProject);
    navigate(`/dashboard/edit/${newProject.projectId}`);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm('Are you sure you want to delete this project?')) {
      StorageService.deleteProject(id);
      setProjects(StorageService.getProjects());
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div className="flex items-center gap-6">
          <div onClick={handleLogout} className="p-3 bg-slate-900 border border-slate-800 rounded-2xl text-slate-500 hover:text-red-400 cursor-pointer transition-colors" title="Logout Admin">
            <LogOut size={20} />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white">Artist Dashboard</h1>
            <p className="text-slate-400">Secure distribution for your music.</p>
          </div>
        </div>
        <button
          onClick={handleCreateNew}
          className="flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 text-black font-bold py-3 px-6 rounded-full transition-all shadow-lg shadow-green-500/20"
        >
          <Plus size={20} />
          Create Private TAP
        </button>
      </header>

      {projects.length === 0 ? (
        <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-3xl p-16 text-center">
          <div className="bg-slate-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="text-slate-500" />
          </div>
          <h2 className="text-xl font-bold mb-2">No Private Albums</h2>
          <p className="text-slate-400 mb-8 max-w-xs mx-auto">Generate secure, private links for your physical NFC and QR distribution.</p>
          <button 
            onClick={handleCreateNew}
            className="text-green-500 font-bold hover:underline"
          >
            Create your first &rarr;
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div key={project.projectId} className="group relative bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 hover:border-slate-700 transition-all">
              <div className="aspect-square w-full relative overflow-hidden">
                <img 
                  src={resolveAsset(project.coverImageUrl)} 
                  alt={project.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-4 right-4 flex gap-2">
                  <span className="text-[10px] font-black bg-black/80 text-green-500 px-2 py-1 rounded border border-green-500/20 backdrop-blur-sm uppercase">Secure Link</span>
                  <span className={`text-[10px] font-black px-2 py-1 rounded border uppercase ${
                    project.published ? 'bg-green-500 text-black border-green-500' : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}>
                    {project.published ? 'Live' : 'Draft'}
                  </span>
                </div>
              </div>
              
              <div className="p-6">
                <h3 className="text-xl font-bold mb-1 truncate text-white">{project.title}</h3>
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-6 flex items-center gap-1 opacity-50">
                  <ShieldCheck size={10} />
                  ID: {project.slug}
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <Link 
                    to={`/dashboard/edit/${project.projectId}`}
                    className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 rounded-xl transition-colors"
                  >
                    <Settings size={14} />
                    Manage
                  </Link>
                  <Link 
                    to={`/${project.slug}`}
                    target="_blank"
                    className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 rounded-xl transition-colors"
                  >
                    <Eye size={14} />
                    Preview
                  </Link>
                  <button 
                    onClick={(e) => handleDelete(project.projectId, e)}
                    className="col-span-2 flex items-center justify-center gap-2 bg-slate-900/60 hover:bg-red-500/10 text-red-400 text-xs font-bold py-2.5 rounded-xl transition-colors border border-red-500/20"
                  >
                    <Trash2 size={14} />
                    Delete Album
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
