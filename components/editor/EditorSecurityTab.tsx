import React, { memo } from 'react';
import { AlertTriangle, ShieldAlert, Loader2 } from 'lucide-react';

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

type EditorSecurityTabProps = {
  projectSecurityLoading: boolean;
  projectSecurityError: string | null;
  effectiveProjectSecurityStats: SecurityStats;
  accessStatus: AccessStatus;
  accessLoading: boolean;
  accessError: string | null;
  authEmail: string | null;
  hasAuthToken: boolean;
  onRetrySecurityStats?: () => void;
  onRetryAccessStatus?: () => void;
};

const EditorSecurityTab: React.FC<EditorSecurityTabProps> = ({
  projectSecurityLoading,
  projectSecurityError,
  effectiveProjectSecurityStats,
  accessStatus,
  accessLoading,
  accessError,
  authEmail,
  hasAuthToken,
  onRetrySecurityStats,
  onRetryAccessStatus
}) => {
  return (
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
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-green-500">Album Security Stats</h4>
          {projectSecurityLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>

        {projectSecurityError && (
          <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest mb-3 rounded-2xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-red-400">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} />
              Stats unavailable.
            </div>
            {onRetrySecurityStats && (
              <button
                type="button"
                onClick={onRetrySecurityStats}
                className="text-[10px] font-black uppercase tracking-widest text-green-400 hover:text-green-300"
              >
                Retry
              </button>
            )}
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
              <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest rounded-2xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-red-400">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} />
                  Status unavailable.
                </div>
                {onRetryAccessStatus && (
                  <button
                    type="button"
                    onClick={onRetryAccessStatus}
                    className="text-[10px] font-black uppercase tracking-widest text-green-400 hover:text-green-300"
                  >
                    Retry
                  </button>
                )}
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

export default memo(EditorSecurityTab);
