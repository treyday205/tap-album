import React, { memo, useMemo, useState } from 'react';
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
  accessSessions: Array<{
    projectId: string;
    email: string;
    verified: boolean;
    unlocked: boolean;
    sessionId: string;
    accessId?: string | null;
    createdAt: string | null;
    lastUsedAt: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }>;
  accessSessionsLoading: boolean;
  accessSessionsError: string | null;
  onRetrySecurityStats?: () => void;
  onRetryAccessStatus?: () => void;
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
};

const toTimestamp = (value?: string | null) => {
  const ms = new Date(String(value || '')).getTime();
  return Number.isFinite(ms) ? ms : 0;
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
  accessSessions,
  accessSessionsLoading,
  accessSessionsError,
  onRetrySecurityStats,
  onRetryAccessStatus
}) => {
  const [sessionEmailQuery, setSessionEmailQuery] = useState('');
  const [sessionLast24Only, setSessionLast24Only] = useState(false);
  const [sessionSort, setSessionSort] = useState<'lastUsed' | 'created'>('lastUsed');
  const hasActiveSessionFilters =
    String(sessionEmailQuery || '').trim().length > 0 ||
    sessionLast24Only ||
    sessionSort !== 'lastUsed';

  const resetSessionFilters = () => {
    setSessionEmailQuery('');
    setSessionLast24Only(false);
    setSessionSort('lastUsed');
  };

  const filteredAccessSessions = useMemo(() => {
    const query = String(sessionEmailQuery || '').trim().toLowerCase();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return [...accessSessions]
      .filter((entry) => {
        const email = String(entry.email || '').toLowerCase();
        if (query && !email.includes(query)) {
          return false;
        }
        if (sessionLast24Only) {
          const lastUsedMs = toTimestamp(entry.lastUsedAt);
          if (lastUsedMs <= 0 || lastUsedMs < cutoff) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (sessionSort === 'created') {
          return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
        }
        const aLastUsed = toTimestamp(a.lastUsedAt) || toTimestamp(a.createdAt);
        const bLastUsed = toTimestamp(b.lastUsedAt) || toTimestamp(b.createdAt);
        if (bLastUsed !== aLastUsed) {
          return bLastUsed - aLastUsed;
        }
        return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
      });
  }, [accessSessions, sessionEmailQuery, sessionLast24Only, sessionSort]);

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

      <section className="p-6 bg-slate-900/40 rounded-3xl border border-slate-800/50">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-green-500">Access Session Audit</h4>
          {accessSessionsLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <input
            type="text"
            value={sessionEmailQuery}
            onChange={(e) => setSessionEmailQuery(e.target.value)}
            placeholder="Filter by email..."
            className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
          <select
            value={sessionSort}
            onChange={(e) => setSessionSort(e.target.value === 'created' ? 'created' : 'lastUsed')}
            className="w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="lastUsed">Sort: Most Recently Used</option>
            <option value="created">Sort: Newest Created</option>
          </select>
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/70 text-[10px] font-black uppercase tracking-widest text-slate-300">
            <input
              type="checkbox"
              checked={sessionLast24Only}
              onChange={(e) => setSessionLast24Only(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-green-500 focus:ring-green-500"
            />
            Last Used 24h
          </label>
          <button
            type="button"
            onClick={resetSessionFilters}
            disabled={!hasActiveSessionFilters}
            className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-colors ${
              hasActiveSessionFilters
                ? 'border-slate-600 bg-slate-800/80 text-slate-100 hover:bg-slate-800'
                : 'border-slate-700 bg-slate-900/60 text-slate-500 cursor-not-allowed'
            }`}
          >
            Clear Filters
          </button>
        </div>

        {!accessSessionsLoading && (
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-4">
            Showing {filteredAccessSessions.length} of {accessSessions.length} sessions.
          </p>
        )}

        {accessSessionsError && (
          <div className="flex items-center gap-2 text-red-400 text-[10px] font-black uppercase tracking-widest mb-3">
            <AlertTriangle size={14} />
            {accessSessionsError}
          </div>
        )}

        {filteredAccessSessions.length === 0 && !accessSessionsLoading && (
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            No access sessions match the current filters.
          </p>
        )}

        {filteredAccessSessions.length > 0 && (
          <div className="space-y-3">
            {filteredAccessSessions.map((entry) => (
              <div key={entry.sessionId} className="p-3 rounded-2xl bg-slate-800/50 border border-slate-700">
                <p className="text-xs font-bold text-white break-all">{entry.email}</p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                  Project: <span className="font-mono text-slate-300">{entry.projectId}</span>
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                  Session: <span className="font-mono text-slate-300">{entry.sessionId}</span>
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                  Created: {formatTimestamp(entry.createdAt)}
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                  Last Used: {formatTimestamp(entry.lastUsedAt)}
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                  IP: {entry.ip || 'Unknown'}
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1 break-all">
                  UA: {entry.userAgent || 'Unknown'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default memo(EditorSecurityTab);
