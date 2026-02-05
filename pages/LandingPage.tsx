
import React from 'react';
import { Link } from 'react-router-dom';
import { Radio, Zap, Smartphone, Globe, ArrowRight, ShieldCheck, Music4, Share2 } from 'lucide-react';

const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-slate-950/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/20">
              <Radio className="text-black" size={24} />
            </div>
            <span className="text-xl font-black tracking-tighter">TAP ALBUM</span>
          </div>
          <Link to="/admin" className="text-sm font-bold bg-white text-black px-6 py-2.5 rounded-full hover:bg-slate-200 transition-all">
            Artist Login
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-full text-green-400 text-xs font-black uppercase tracking-widest mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Zap size={14} />
            The Future of Music Distribution
          </div>
          <h1 className="text-5xl md:text-8xl font-black tracking-tight leading-[0.9] mb-8 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
            MAKE YOUR <br />
            <span className="text-green-500">MUSIC PHYSICAL.</span>
          </h1>
          <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto mb-12 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200">
            Turn your digital albums into premium NFC-powered experiences. Fans simply TAP their phone to your merch to instantly stream, buy tickets, and connect.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-16 duration-700 delay-300">
            <Link to="/admin" className="w-full sm:w-auto bg-green-500 hover:bg-green-400 text-black font-black py-5 px-10 rounded-2xl flex items-center justify-center gap-3 transition-all transform hover:scale-105 active:scale-95 shadow-2xl shadow-green-500/20 text-lg uppercase tracking-widest">
              Start Building
              <ArrowRight size={20} />
            </Link>
            <a href="#demo" className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-bold py-5 px-10 rounded-2xl transition-all border border-slate-800 text-lg">
              Watch Demo
            </a>
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="py-32 px-6 bg-slate-900/20">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-slate-900/40 p-10 rounded-[40px] border border-white/5 hover:border-green-500/30 transition-all group">
              <div className="w-14 h-14 bg-green-500/10 rounded-2xl flex items-center justify-center text-green-500 mb-6 group-hover:scale-110 transition-transform">
                <Smartphone size={28} />
              </div>
              <h3 className="text-2xl font-black mb-4">NFC Enabled</h3>
              <p className="text-slate-400 leading-relaxed">Embed your unique TAP URL into vinyl, posters, or clothing. Fans just tap to play.</p>
            </div>
            <div className="bg-slate-900/40 p-10 rounded-[40px] border border-white/5 hover:border-green-500/30 transition-all group">
              <div className="w-14 h-14 bg-green-500/10 rounded-2xl flex items-center justify-center text-green-500 mb-6 group-hover:scale-110 transition-transform">
                <Music4 size={28} />
              </div>
              <h3 className="text-2xl font-black mb-4">Smart Audio</h3>
              <p className="text-slate-400 leading-relaxed">Direct MP3 uploads or Spotify preview integration. Give fans a taste of the music instantly.</p>
            </div>
            <div className="bg-slate-900/40 p-10 rounded-[40px] border border-white/5 hover:border-green-500/30 transition-all group">
              <div className="w-14 h-14 bg-green-500/10 rounded-2xl flex items-center justify-center text-green-500 mb-6 group-hover:scale-110 transition-transform">
                <Share2 size={28} />
              </div>
              <h3 className="text-2xl font-black mb-4">Viral Viral</h3>
              <p className="text-slate-400 leading-relaxed">Integrated Web Share API. Fans can text your album landing page with one click.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Footer */}
      <footer className="py-20 border-t border-white/5 text-center px-6">
        <div className="flex items-center justify-center gap-2 text-slate-600 mb-8">
          <ShieldCheck size={16} />
          <span className="text-[10px] uppercase font-black tracking-[0.3em]">The Artist First Platform</span>
        </div>
        <p className="text-slate-500 text-sm">© 2024 TAP Album Platform. All Rights Reserved.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
