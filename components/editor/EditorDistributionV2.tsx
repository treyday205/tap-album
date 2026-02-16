import React, { memo } from 'react';
import { AlertTriangle, ShieldAlert, Loader2, RotateCw, RefreshCcw, Activity, Pause, Play } from 'lucide-react';
import { Project } from '../../types';

type SecurityStats = {
  pinUnlockUsed: number;
  pinUnlockRemaining: number;
  pinUnlockLimit: number;
  pinActiveUsed: number;
  pinActiveRemaining: number;
  pinActiveLimit: number;
} | null;

type UnlockActivity = {
  email: string;
  unlockedAt: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

type EditorDistributionV2Props = {
  project: Project;
  effectiveProjectSecurityStats: SecurityStats;
  projectSecurityLoading: boolean;
  projectSecurityError: string | null;
  unlockActivity: UnlockActivity[];
  unlockActivityLoading: boolean;
  unlockActivityError: string | null;
  onSaveProject: (updates: Partial<Project>) => void;
  onRotatePins: () => void;
  onResetCounters: () => void;
};

const DEFAULT_LIMIT = 1_000_000;

const toNumberOrNull = (value: unknown) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

const formatCount = (value: unknown) => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return '--';
  return Math.max(0, Math.floor(normalized)).toLocaleString();
};

const maskEmail = (email: string) => {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return 'Guest';
  const visible = user.slice(0, 2);
  return `${visible}${user.length > 2 ? '***' : ''}@${domain}`;
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
};

const EditorDistributionV2: React.FC<EditorDistributionV2Props> = ({
  project,
  effectiveProjectSecurityStats,
  projectSecurityLoading,
  projectSecurityError,
  unlockActivity,
  unlockActivityLoading,
  unlockActivityError,
  onSaveProject,
  onRotatePins,
  onResetCounters
}) => {
  const distributionMode = project.distributionMode || 'open';
  const dropStatus = project.distributionStatus || 'live';

  const totalCopies =
    toNumberOrNull(project.securityUnlockLimit) ??
    toNumberOrNull(effectiveProjectSecurityStats?.pinUnlockLimit) ??
    DEFAULT_LIMIT;
  const perPersonLimit =
    toNumberOrNull(project.securityUnlocksPerEmail) ??
    DEFAULT_LIMIT;
  const copiesUsedValue = toNumberOrNull(effectiveProjectSecurityStats?.pinUnlockUsed);
  const copiesRemainingValue = toNumberOrNull(effectiveProjectSecurityStats?.pinUnlockRemaining);
  const copiesUsedLabel = formatCount(copiesUsedValue);
  const copiesRemainingLabel = formatCount(copiesRemainingValue);

  const modeOptions = [
    { id: 'open', label: 'Open Drop', desc: 'Open access while live.' },
    { id: 'limited', label: 'Limited Drop', desc: 'Finite copy count per drop.' },
    { id: 'code', label: 'Code Drop', desc: 'Unlock with issued code.' },
    { id: 'tap', label: 'Tap Only Drop', desc: 'Requires TAP/NFC hardware.' }
  ] as const;

  const statusOptions = [
    { id: 'live', label: 'Drop Live' },
    { id: 'paused', label: 'Freeze' },
    { id: 'closed', label: 'Closed' }
  ] as const;

  const handleModeChange = (mode: typeof modeOptions[number]['id']) => {
    onSaveProject({ distributionMode: mode });
  };

  const handleStatusChange = (status: typeof statusOptions[number]['id']) => {
    onSaveProject({ distributionStatus: status });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-10">
      <section className="bg-slate-900/40 p-5 rounded-3xl border border-slate-800/50">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-black flex items-center gap-2 text-transparent bg-clip-text bg-gradient-to-r from-slate-200 via-slate-300 to-slate-500">
              <ShieldAlert size={20} className="text-green-500" />
              Distribution Control
            </h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">
              CD-style drops with simple limits and actions.
            </p>
          </div>
            <div className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/30">
              V2
            </div>
          </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {modeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleModeChange(option.id)}
                className={`text-left p-3 rounded-2xl border transition-colors ${
                  distributionMode === option.id
                    ? 'border-green-500/60 bg-green-500/10 text-green-500'
                    : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:text-slate-200'
                }`}
              >
                <p className="text-xs font-black uppercase tracking-widest">{option.label}</p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">{option.desc}</p>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Mode controls are descriptive only and do not alter existing unlock logic.
          </p>
        </div>
      </section>

      <section className="bg-slate-900/40 p-5 rounded-3xl border border-slate-800/50">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-200 mb-4">
          Drop Controls
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Copies</p>
            <input
              type="number"
              min={0}
              value={totalCopies}
              onChange={(e) => onSaveProject({ securityUnlockLimit: Math.max(0, Number(e.target.value || 0)) })}
              className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
              Unlock cap for this drop.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Remaining</p>
            <div className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-white">
              {copiesRemainingLabel}
            </div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
              Claims: {copiesUsedLabel}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Per Person</p>
            <input
              type="number"
              min={0}
              value={perPersonLimit}
              onChange={(e) => onSaveProject({ securityUnlocksPerEmail: Math.max(0, Number(e.target.value || 0)) })}
              className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
              Applied per verified email.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/50">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Drop Status</p>
            <div className="grid grid-cols-3 gap-2">
              {statusOptions.map((status) => (
                <button
                  key={status.id}
                  type="button"
                  onClick={() => handleStatusChange(status.id)}
                  className={`rounded-xl px-2 py-2 text-[10px] font-black uppercase tracking-widest border transition-colors ${
                    dropStatus === status.id
                      ? 'border-green-500/60 bg-green-500/10 text-green-500'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {status.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2">
              Status is informational only.
            </p>
          </div>
        </div>
      </section>

      <section className="p-5 bg-slate-900/40 rounded-3xl border border-slate-800/50">
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Claims</p>
              <p className="text-sm font-bold text-white">
                {formatCount(effectiveProjectSecurityStats.pinUnlockUsed)}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Remaining</p>
              <p className="text-sm font-bold text-white">
                {formatCount(effectiveProjectSecurityStats.pinUnlockRemaining)}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Active PINs</p>
              <p className="text-sm font-bold text-white">
                {formatCount(effectiveProjectSecurityStats.pinActiveUsed)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Album security stats are unavailable for this project.
          </p>
        )}
      </section>

      <section className="p-5 bg-slate-900/40 rounded-3xl border border-slate-800/50">
        <h4 className="text-xs font-black uppercase tracking-widest text-green-500 mb-4">Quick Actions</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => handleStatusChange('paused')}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors"
          >
            <Pause size={14} />
            Freeze Drop
          </button>
          <button
            onClick={() => handleStatusChange('live')}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors"
          >
            <Play size={14} className="ml-0.5" />
            Drop Live
          </button>
          <button
            onClick={onRotatePins}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors"
          >
            <RotateCw size={14} />
            Rotate Code
          </button>
          <button
            onClick={onResetCounters}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/70 border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors"
          >
            <RefreshCcw size={14} />
            Reset Counts
          </button>
        </div>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-3">
          Admin token required for rotate/reset actions in production.
        </p>
      </section>

      <section className="p-5 bg-slate-900/40 rounded-3xl border border-slate-800/50">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-green-500 flex items-center gap-2">
            <Activity size={14} />
            Recent Claims
          </h4>
          {unlockActivityLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>

        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">
          <span>Claims: {copiesUsedLabel}</span>
          <span>Remaining: {copiesRemainingLabel}</span>
        </div>

        {unlockActivityError && (
          <div className="flex items-center gap-2 text-red-400 text-[10px] font-black uppercase tracking-widest mb-3">
            <AlertTriangle size={14} />
            {unlockActivityError}
          </div>
        )}

        {unlockActivity.length === 0 && !unlockActivityLoading && (
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            No claims yet.
          </p>
        )}

        {unlockActivity.length > 0 && (
          <div className="space-y-3">
            {unlockActivity.map((entry, index) => (
              <div key={`${entry.email}-${entry.unlockedAt}-${index}`} className="p-3 rounded-2xl bg-slate-800/50 border border-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-white">{maskEmail(entry.email)}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">
                      {formatTimestamp(entry.unlockedAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                      {entry.ip || 'Unknown'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default memo(EditorDistributionV2);
