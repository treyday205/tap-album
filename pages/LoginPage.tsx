
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowRight, ShieldCheck, Radio } from 'lucide-react';

const LoginPage: React.FC = () => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Default Access Key: 200038
    if (password === '200038') {
      localStorage.setItem('tap_is_admin', 'true');
      navigate('/dashboard');
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center shadow-lg shadow-green-500/20">
              <Radio className="text-black" size={28} />
            </div>
            <span className="text-2xl font-black tracking-tighter text-white">TAP ALBUM</span>
          </div>
          
          <div className="w-16 h-16 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock className="text-slate-500" size={24} />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-2">Admin Portal</h1>
          <p className="text-slate-500 text-sm">Enter your secure access key to manage deployments.</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative group">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Access Key"
              className={`w-full bg-slate-900 border ${error ? 'border-red-500/50' : 'border-slate-800'} group-hover:border-slate-700 focus:border-green-500 rounded-2xl px-5 py-4 outline-none transition-all text-white font-medium text-center tracking-[0.2em]`}
              autoFocus
            />
            {error && <p className="text-red-400 text-[10px] font-black uppercase tracking-widest mt-3 text-center animate-pulse">Invalid Authorization Key</p>}
          </div>

          <button
            type="submit"
            className="w-full bg-green-500 hover:bg-green-400 text-black font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-95 shadow-lg shadow-green-500/20 uppercase tracking-widest text-xs"
          >
            Authenticate
            <ArrowRight size={18} />
          </button>
        </form>

        <div className="mt-12 pt-8 border-t border-white/5 flex flex-col items-center gap-4 text-slate-600">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} />
            <span className="text-[10px] uppercase font-bold tracking-[0.3em]">Hardware Distribution Mode</span>
          </div>
          <p className="text-[9px] text-slate-700 max-w-[200px] text-center leading-relaxed font-bold uppercase tracking-widest">
            This instance is configured for direct NFC/QR hardware deployment.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
