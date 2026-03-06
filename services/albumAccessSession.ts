const AUTH_TOKEN_KEY = 'tap_auth_token';
const AUTH_EMAIL_KEY = 'tap_auth_email';
const AUTH_TOKEN_PREFIX = `${AUTH_TOKEN_KEY}_`;
const AUTH_EMAIL_PREFIX = `${AUTH_EMAIL_KEY}_`;
const PROJECT_SESSION_PREFIX = 'tap_access_sessions_';
const PROJECT_ACTIVE_EMAIL_PREFIX = 'tap_access_active_email_';
const UNLOCKED_KEY_PREFIX = 'tap_unlocked_';

export type AlbumAccessSession = {
  email: string;
  token: string;
  updatedAt: string;
};

const hasStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const normalizeProjectId = (value?: string | null) => String(value || '').trim();
export const normalizeEmailIdentity = (value?: string | null) => String(value || '').trim().toLowerCase();

const getSessionKey = (projectId: string) => `${PROJECT_SESSION_PREFIX}${projectId}`;
const getActiveEmailKey = (projectId: string) => `${PROJECT_ACTIVE_EMAIL_PREFIX}${projectId}`;
const getScopedLegacyTokenKey = (projectId: string) => `${AUTH_TOKEN_KEY}_${projectId}`;
const getScopedLegacyEmailKey = (projectId: string) => `${AUTH_EMAIL_KEY}_${projectId}`;

const sortByMostRecent = (entries: [string, AlbumAccessSession][]) =>
  [...entries].sort((a, b) => {
    const aTime = new Date(a[1]?.updatedAt || '').getTime();
    const bTime = new Date(b[1]?.updatedAt || '').getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });

const parseSessions = (raw: string | null): Record<string, AlbumAccessSession> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const normalizedEntries = Object.entries(parsed).flatMap(([email, value]) => {
      const normalizedEmail = normalizeEmailIdentity(email);
      const token = String((value as any)?.token || '').trim();
      if (!normalizedEmail || !token) return [];
      return [
        [
          normalizedEmail,
          {
            email: normalizedEmail,
            token,
            updatedAt: String((value as any)?.updatedAt || new Date().toISOString())
          }
        ] as [string, AlbumAccessSession]
      ];
    });
    return Object.fromEntries(normalizedEntries);
  } catch {
    return {};
  }
};

const writeSessions = (projectId: string, sessions: Record<string, AlbumAccessSession>) => {
  if (!hasStorage()) return;
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return;
  const entries = Object.entries(sessions);
  const key = getSessionKey(normalizedProjectId);
  if (entries.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
};

const readSessions = (projectId: string): Record<string, AlbumAccessSession> => {
  if (!hasStorage()) return {};
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return {};
  return parseSessions(localStorage.getItem(getSessionKey(normalizedProjectId)));
};

const setLegacyCompatValues = (projectId: string, token: string, email: string) => {
  if (!hasStorage()) return;
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedEmail = normalizeEmailIdentity(email);
  if (!normalizedProjectId || !normalizedEmail || !token) return;
  localStorage.setItem(getScopedLegacyTokenKey(normalizedProjectId), token);
  localStorage.setItem(getScopedLegacyEmailKey(normalizedProjectId), normalizedEmail);
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_EMAIL_KEY, normalizedEmail);
};

const removeLegacyCompatValues = (projectId: string) => {
  if (!hasStorage()) return;
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return;
  localStorage.removeItem(getScopedLegacyTokenKey(normalizedProjectId));
  localStorage.removeItem(getScopedLegacyEmailKey(normalizedProjectId));
  localStorage.removeItem(`${UNLOCKED_KEY_PREFIX}${normalizedProjectId}`);
};

const migrateLegacySession = (projectId: string) => {
  if (!hasStorage()) return;
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return;
  const existing = readSessions(normalizedProjectId);
  if (Object.keys(existing).length > 0) return;

  const scopedToken = String(localStorage.getItem(getScopedLegacyTokenKey(normalizedProjectId)) || '').trim();
  const scopedEmail = normalizeEmailIdentity(localStorage.getItem(getScopedLegacyEmailKey(normalizedProjectId)));
  const globalToken = String(localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
  const globalEmail = normalizeEmailIdentity(localStorage.getItem(AUTH_EMAIL_KEY));

  const token = scopedToken || globalToken;
  const email = scopedEmail || globalEmail;
  if (!token || !email) return;

  const migrated = {
    [email]: {
      email,
      token,
      updatedAt: new Date().toISOString()
    }
  };
  writeSessions(normalizedProjectId, migrated);
  localStorage.setItem(getActiveEmailKey(normalizedProjectId), email);
  setLegacyCompatValues(normalizedProjectId, token, email);
};

export const listProjectAccessEmails = (projectId?: string | null): string[] => {
  if (!hasStorage()) return [];
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return [];
  migrateLegacySession(normalizedProjectId);
  return sortByMostRecent(Object.entries(readSessions(normalizedProjectId))).map(([email]) => email);
};

export const getActiveProjectAccessEmail = (projectId?: string | null): string | null => {
  if (!hasStorage()) return null;
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return null;
  migrateLegacySession(normalizedProjectId);
  const sessions = readSessions(normalizedProjectId);
  const activeEmail = normalizeEmailIdentity(localStorage.getItem(getActiveEmailKey(normalizedProjectId)));
  if (activeEmail && sessions[activeEmail]) {
    return activeEmail;
  }
  const first = sortByMostRecent(Object.entries(sessions))[0];
  if (!first) return null;
  localStorage.setItem(getActiveEmailKey(normalizedProjectId), first[0]);
  return first[0];
};

export const setActiveProjectAccessEmail = (projectId?: string | null, email?: string | null) => {
  if (!hasStorage()) return;
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedEmail = normalizeEmailIdentity(email);
  if (!normalizedProjectId || !normalizedEmail) return;
  migrateLegacySession(normalizedProjectId);
  const sessions = readSessions(normalizedProjectId);
  const session = sessions[normalizedEmail];
  if (!session) return;
  localStorage.setItem(getActiveEmailKey(normalizedProjectId), normalizedEmail);
  setLegacyCompatValues(normalizedProjectId, session.token, normalizedEmail);
};

export const getProjectAccessToken = (
  projectId?: string | null,
  emailOverride?: string | null
): string | null => {
  if (!hasStorage()) return null;
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return null;
  migrateLegacySession(normalizedProjectId);
  const sessions = readSessions(normalizedProjectId);
  const resolvedEmail = normalizeEmailIdentity(emailOverride) || getActiveProjectAccessEmail(normalizedProjectId);
  if (!resolvedEmail) return null;
  const session = sessions[resolvedEmail];
  if (!session?.token) return null;
  return session.token;
};

export const upsertProjectAccessSession = (
  projectId?: string | null,
  email?: string | null,
  token?: string | null
) => {
  if (!hasStorage()) return;
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedEmail = normalizeEmailIdentity(email);
  const normalizedToken = String(token || '').trim();
  if (!normalizedProjectId || !normalizedEmail || !normalizedToken) return;

  migrateLegacySession(normalizedProjectId);
  const sessions = readSessions(normalizedProjectId);
  sessions[normalizedEmail] = {
    email: normalizedEmail,
    token: normalizedToken,
    updatedAt: new Date().toISOString()
  };
  writeSessions(normalizedProjectId, sessions);
  localStorage.setItem(getActiveEmailKey(normalizedProjectId), normalizedEmail);
  setLegacyCompatValues(normalizedProjectId, normalizedToken, normalizedEmail);
};

export const removeProjectAccessSession = (
  projectId?: string | null,
  emailOverride?: string | null
) => {
  if (!hasStorage()) return;
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return;
  migrateLegacySession(normalizedProjectId);
  const sessions = readSessions(normalizedProjectId);
  const targetEmail = normalizeEmailIdentity(emailOverride) || getActiveProjectAccessEmail(normalizedProjectId);
  if (!targetEmail) {
    clearProjectAccessSessions(normalizedProjectId);
    return;
  }
  if (!sessions[targetEmail]) return;

  delete sessions[targetEmail];
  writeSessions(normalizedProjectId, sessions);
  removeLegacyCompatValues(normalizedProjectId);

  const next = sortByMostRecent(Object.entries(sessions))[0];
  if (next) {
    localStorage.setItem(getActiveEmailKey(normalizedProjectId), next[0]);
    setLegacyCompatValues(normalizedProjectId, next[1].token, next[0]);
    return;
  }
  localStorage.removeItem(getActiveEmailKey(normalizedProjectId));
};

export const clearProjectAccessSessions = (projectId?: string | null) => {
  if (!hasStorage()) return;
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return;
  localStorage.removeItem(getSessionKey(normalizedProjectId));
  localStorage.removeItem(getActiveEmailKey(normalizedProjectId));
  removeLegacyCompatValues(normalizedProjectId);
};

export const clearAllProjectAccessSessions = () => {
  if (!hasStorage()) return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (
      key === AUTH_TOKEN_KEY ||
      key === AUTH_EMAIL_KEY ||
      key.startsWith(AUTH_TOKEN_PREFIX) ||
      key.startsWith(AUTH_EMAIL_PREFIX) ||
      key.startsWith(PROJECT_SESSION_PREFIX) ||
      key.startsWith(PROJECT_ACTIVE_EMAIL_PREFIX) ||
      key.startsWith(UNLOCKED_KEY_PREFIX)
    ) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
};
