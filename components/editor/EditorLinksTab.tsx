import React, { memo } from 'react';
import { Instagram, Twitter, Video, Facebook, Music2, Music, Plus, Trash2, Link as LinkIcon } from 'lucide-react';
import { LinkCategory, Project, ProjectLink } from '../../types';

type EditorLinksTabProps = {
  project: Project;
  links: ProjectLink[];
  handleAddLink: (category: LinkCategory) => void;
  handleUpdateLink: (id: string, updates: Partial<ProjectLink>) => void;
  handleDeleteLink: (id: string) => void;
  handleSaveProject: (updates: Partial<Project>) => void;
};

const EditorLinksTab: React.FC<EditorLinksTabProps> = ({
  project,
  links,
  handleAddLink,
  handleUpdateLink,
  handleDeleteLink,
  handleSaveProject
}) => {
  return (
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
          ].map((social) => (
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
          {links.map((link) => (
            <div key={link.linkId} className="flex items-center gap-3 bg-slate-800/30 p-3 rounded-2xl border border-slate-800/50">
              <input type="text" value={link.label} onChange={(e) => handleUpdateLink(link.linkId, { label: e.target.value })} className="w-1/3 bg-transparent text-sm font-bold focus:outline-none" />
              <input type="text" value={link.url} onChange={(e) => handleUpdateLink(link.linkId, { url: e.target.value })} className="flex-1 bg-transparent text-sm text-slate-400 focus:outline-none" />
              <button onClick={() => handleDeleteLink(link.linkId)} className="p-1.5 text-slate-700 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
            </div>
          ))}
          {links.length === 0 && (
            <div className="flex items-center gap-3 bg-slate-800/20 p-4 rounded-2xl border border-dashed border-slate-800 text-slate-500 text-xs">
              <LinkIcon size={16} />
              No deep links yet. Add a streaming or merch link.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default memo(EditorLinksTab);
