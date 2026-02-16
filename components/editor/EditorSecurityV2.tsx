import React, { memo } from 'react';
import { AlertTriangle, ShieldAlert, Loader2, RefreshCcw, Shield, RotateCw, Link as LinkIcon, Activity } from 'lucide-react';
import { Project } from '../../types';

type SecurityStats = {
  pinUnlockUsed: number;
  pinUnlockRemaining: number;
  pinUnlockLimit: number;
  pinActiveUsed: number;
  pinActiveRemaining: number;
  pinActiveLimit: number;
} | null;

type AccessStatus = {
  verified: boolean;
  unlocked: boolean;
  remaining: number;
  hasActivePin: boolean;
} | null;

type UnlockActivity = {
  email: string;
  unlockedAt: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

type EditorSecurityV2Props = {
  project: Project;
  effectiveProjectSecurityStats: SecurityStats;
  projectSecurityLoading: boolean;
  projectSecurityError: string | null;
  accessStatus: AccessStatus;
  accessLoading: boolean;
  accessError: string | null;
  authEmail: string | null;
  hasAuthToken: boolean;
  unlockActivity: UnlockActivity[];
  unlockActivityLoading: boolean;
  unlockActivityError: string | null;
  onSaveProject: (updates: Partial<Project>) => void;
  onInvalidateSessions: () => void;
  onResetCounters: () => void;
  onRotatePins: () => void;
  onRegenerateLink: () => void;
};

const maskEmail = (email: string) => {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${user.length > 2 ? '***' : ''}@${domain}`;
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
};

const deviceFromUserAgent = (ua?: string | null) => {
  if (!ua) return 'Unknown Device';
  const lowered = ua.toLowerCase();
  if (lowered.includes('iphone')) return 'iPhone';
  if (lowered.includes('ipad')) return 'iPad';
  if (lowered.includes('android')) return 'Android';
  if (lowered.includes('mac')) return 'Mac';
  if (lowered.includes('windows')) return 'Windows';
  if (lowered.includes('linux')) return 'Linux';
  return 'Unknown Device';
};

const EditorSecurityV2: React.FC<EditorSecurityV2Props> = ({
  project,
  effectiveProjectSecurityStats,
  projectSecurityLoading,
  projectSecurityError,
  accessStatus,
  accessLoading,
  accessError,
  authEmail,
  hasAuthToken,
  unlockActivity,
  unlockActivityLoading,
  unlockActivityError,
  onSaveProject,
  onInvalidateSessions,
  onResetCounters,
  onRotatePins,
  onRegenerateLink
}) => {
  const securityMode =
    project.securityMode ||
    (project.isPrivate ? 'private' : project.emailGateEnabled === false ? 'open' : 'email');
  const unlockLimit = Number.isFinite(Number(project.securityUnlockLimit))
    ? Number(project.securityUnlockLimit)
    : effectiveProjectSecurityStats?.pinUnlockLimit || 1_000_000;
  const unlocksPerEmail = Number.isFinite(Number(project.securityUnlocksPerEmail))
    ? Number(project.securityUnlocksPerEmail)
    : 1_000_000;
  const activePinLimit = Number.isFinite(Number(project.securityActivePinLimit))
    ? Number(project.securityActivePinLimit)
    : effectiveProjectSecurityStats?.pinActiveLimit || 1_000_000;
  const pinRequired = project.securityPinRequired !== false;

  const modeOptions = [
    { id: 'open', label: 'Open Access', desc: 'No email gate, instant entry.' },
    { id: 'email', label: 'Email Gate', desc: 'Email verification required.' },
    { id: 'pin', label: 'PIN Gate', desc: 'Email + PIN unlock flow.' },
    { id: 'nfc', label: 'NFC Only', desc: 'Requires TAP/NFC hardware.' },
    { id: 'private', label: 'Private', desc: 'No public access.' }
  ] as const;

  const handleModeChange = (mode: typeof modeOptions[number]['id']) => {
    const updates: Partial<Project> = { securityMode: mode };
    if (mode === 'open') {
      updates.emailGateEnabled = false;
      updates.isPrivate = false;
    }
    if (mode === 'email' || mode === 'pin' || mode === 'nfc') {
      updates.emailGateEnabled = true;
      updates.isPrivate = false;
    }
    if (mode === 'private') {
      updates.isPrivate = true;
    }
    onSaveProject(updates);
  };

  const ipCounts = unlockActivity.reduce<Record<string, number>>((acc, entry) => {
    const ip = entry.ip || '';
    if (!ip) return acc;
    acc[ip] = (acc[ip] || 0) + 1;
    return acc;
  }, {});
  const deviceCounts = unlockActivity.reduce<Record<string, number>>((acc, entry) => {
    const device = deviceFromUserAgent(entry.userAgent);
    if (!device) return acc;
    acc[device] = (acc[device] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-10">
      <section className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/50">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-black flex items-center gap-2">
              <ShieldAlert size={20} className="text-green-500" />
              Security Control Center
            </h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Configure gates, limits, and recovery tools.</p>
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
            Live
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {modeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleModeChange(option.id)}
                className={`text-left p-3 rounded-2xl border transition-colors ${
                  securityMode === option.id
                    ? 'border-green-500 bg-green-500/10 text-green-300'
                    : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:text-slate-200'
                }`}
              >
                <p className="text-xs font-black uppercase tracking-widest">{option.label}</p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">{option.desc}</p>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Publication status remains in the Identity tab.
          </p>
        </div>
      </section>

      <section className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800/50">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-200 mb-4">Limits & PIN Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Unlock Limit (Album)</p>
            <input
              type="number"
              min={0}
              value={unlockLimit}
              onChange={(e) => onSaveProject({ securityUnlockLimit: Math.max(0, Number(e.target.value || 0)) })}
              className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
              Current usage: {effectiveProjectSecurityStats?.pinUnlockUsed?.toLocaleString() || '0'}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Unlocks Per Email</p>
            <input
              type="number"
              min={0}
              value={unlocksPerEmail}
              onChange={(e) => onSaveProject({ securityUnlocksPerEmail: Math.max(0, Number(e.target.value || 0)) })}
              className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
              Applies to new email sessions.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Active PIN Capacity</p>
            <input
              type="number"
              min={0}
              value={activePinLimit}
              onChange={(e) => onSaveProject({ securityActivePinLimit: Math.max(0, Number(e.target.value || 0)) })}
              className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
              Active now: {effectiveProjectSecurityStats?.pinActiveUsed?.toLocaleString() || '0'}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between bg-slate-800/40 border border-slate-700/50 rounded-2xl px-4 py-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Require PIN After Email</p>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Keeps current secure flow active.</p>
          </div>
          <button
            type="button"
            onClick={() => onSaveProject({ securityPinRequired: !pinRequired })}
            className={`w-14 h-8 rounded-full relative transition-colors ${pinRequired ? 'bg-green-500' : 'bg-slate-600'}`}
          >
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${pinRequired ? 'right-1' : 'left-1'}`} />
          </button>
        </div>
      </section>

      <section className="p-6 bg-slate-900/40 rounded-3xl border border-slate-800/50">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-green-500">Album Security Stats</h4>
          {projectSecurityLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>

        {projectSecurityError && (
          <div className="flex items-center gap-2 text-red-400 text-[10px] font-black uppercase tracking-widest mb-3">
            <AlertTriangle size={14} />
            {projectSecurityError}
          </div>
        )}

        {effectiveProjectSecurityStats ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Album Unlocks Used</p>
              <p className="text-sm font-bold text-white">
                {effectiveProjectSecurityStats.pinUnlockUsed.toLocaleString()}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Album Unlocks Remaining</p>
              <p className="text-sm font-bold text-white">
                {effectiveProjectSecurityStats.pinUnlockRemaining.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
                Limit: {effectiveProjectSecurityStats.pinUnlockLimit.toLocaleString()}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Album Active PINs Used</p>
              <p className="text-sm font-bold text-white">
                {effectiveProjectSecurityStats.pinActiveUsed.toLocaleString()}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Album Active PINs Remaining</p>
              <p className="text-sm font-bold text-white">
                {effectiveProjectSecurityStats.pinActiveRemaining.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
                Limit: {effectiveProjectSecurityStats.pinActiveLimit.toLocaleString()}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Album security stats are unavailable for this project.
          </p>
        )}
      </section>

      <section className="p-6 bg-slate-900/40 rounded-3xl border border-slate-800/50">
        <h4 className="text-xs font-black uppercase tracking-widest text-green-500 mb-4">Admin Actions</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button onClick={onRotatePins} className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors">
            <RotateCw size={14} />
            Rotate PINs
          </button>
          <button onClick={onInvalidateSessions} className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors">
            <Shield size={14} />
            Invalidate Sessions
          </button>
          <button onClick={onResetCounters} className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors">
            <RefreshCcw size={14} />
            Reset Counters
          </button>
          <button onClick={onRegenerateLink} className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors">
            <LinkIcon size={14} />
            Regenerate Secure Link
          </button>
        </div>
      </section>

      <section className="p-6 bg-slate-900/40 rounded-3xl border border-slate-800/50">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-green-500 flex items-center gap-2">
            <Activity size={14} />
            Recent Unlock Activity
          </h4>
          {unlockActivityLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>

        {unlockActivityError && (
          <div className="flex items-center gap-2 text-red-400 text-[10px] font-black uppercase tracking-widest mb-3">
            <AlertTriangle size={14} />
            {unlockActivityError}
          </div>
        )}

        {unlockActivity.length === 0 && !unlockActivityLoading && (
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            No unlock activity yet.
          </p>
        )}

        {unlockActivity.length > 0 && (
          <div className="space-y-3">
            {unlockActivity.map((entry, index) => {
              const previous = unlockActivity[index + 1];
              const currentTime = entry.unlockedAt ? new Date(entry.unlockedAt).getTime() : null;
              const previousTime = previous && previous.unlockedAt ? new Date(previous.unlockedAt).getTime() : null;
              const rapid = Boolean(previousTime && currentTime && Math.abs(currentTime - previousTime) < 2 * 60 * 1000);
              const ip = entry.ip || 'Unknown';
              const device = deviceFromUserAgent(entry.userAgent);
              const repeatedIp = ip !== 'Unknown' && (ipCounts[ip] || 0) > 1;
              const repeatedDevice = device && (deviceCounts[device] || 0) > 1;
              return (
                <div key={`${entry.email}-${entry.unlockedAt}-${index}`} className="p-3 rounded-2xl bg-slate-800/50 border border-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-white">{maskEmail(entry.email)}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">
                        {formatTimestamp(entry.unlockedAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{device}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{ip}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {rapid && <span className="text-[9px] font-black uppercase tracking-widest bg-red-500/15 text-red-300 px-2 py-1 rounded-full">Rapid Attempts</span>}
                    {repeatedIp && <span className="text-[9px] font-black uppercase tracking-widest bg-yellow-500/15 text-yellow-300 px-2 py-1 rounded-full">Repeated IP</span>}
                    {repeatedDevice && <span className="text-[9px] font-black uppercase tracking-widest bg-orange-500/15 text-orange-300 px-2 py-1 rounded-full">Repeated Device</span>}
                    {!rapid && !repeatedIp && !repeatedDevice && (
                      <span className="text-[9px] font-black uppercase tracking-widest bg-green-500/10 text-green-300 px-2 py-1 rounded-full">Normal</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="p-6 bg-slate-900/40 rounded-3xl border border-slate-800/50">
        <h4 className="text-xs font-black uppercase tracking-widest text-green-500 mb-4">Current Email Status</h4>
        {!hasAuthToken && (
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            No verified email on this device yet.
          </p>
        )}

        {hasAuthToken && (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Email</p>
                <p className="text-sm font-bold text-white">{authEmail || 'Unknown'}</p>
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
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default memo(EditorSecurityV2);
