#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:4000';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '200038';

const baseUrl = String(process.argv[2] || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
const adminPassword = String(process.argv[3] || DEFAULT_ADMIN_PASSWORD).trim();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requestJson = async (method, targetPath, body, token) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${targetPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${targetPath}: ${String(payload?.message || '').trim() || 'Request failed'}`);
  }
  return payload;
};

const adminLogin = async (password) => {
  const response = await requestJson('POST', '/api/admin/login', { password });
  const token = String(response?.token || '').trim();
  assert(token, 'Admin login did not return a token.');
  return token;
};

const run = async () => {
  const firstToken = await adminLogin(adminPassword);

  const createResponse = await requestJson(
    'POST',
    '/api/projects',
    {
      title: 'Login Track URL Persistence',
      artistName: 'Tap QA Login'
    },
    firstToken
  );
  const project = createResponse?.project || {};
  const projectId = String(project.projectId || '').trim();
  const slug = String(project.slug || '').trim();
  assert(projectId, 'Missing projectId after project create.');
  assert(slug, 'Missing slug after project create.');

  const trackUrl = 'https://p.scdn.co/mp3-preview/test-login-persistence.mp3';
  const trackId = `track-login-${Date.now()}`;
  const now = new Date().toISOString();

  const initialSyncPayload = {
    project: {
      projectId,
      slug,
      title: project.title || 'Login Track URL Persistence',
      artistName: project.artistName || 'Tap QA Login',
      published: false
    },
    tracks: [
      {
        trackId,
        projectId,
        title: 'Login Flow Track',
        trackNo: 1,
        sortOrder: 1,
        mp3Url: trackUrl,
        trackUrl,
        audioUrl: trackUrl,
        spotifyUrl: 'https://open.spotify.com/track/login-persistence',
        artworkUrl: '',
        createdAt: now
      }
    ]
  };

  await requestJson('POST', '/api/projects/sync', initialSyncPayload, firstToken);

  // Simulate logout/login.
  const secondToken = await adminLogin(adminPassword);

  // Simulate post-auth bootstrap refresh.
  const listResponse = await requestJson('GET', '/api/projects', undefined, secondToken);
  const projects = Array.isArray(listResponse?.projects) ? listResponse.projects : [];
  assert(
    projects.some((item) => String(item?.projectId || '').trim() === projectId),
    'Project missing from post-auth projects refresh.'
  );

  // Simulate risky post-auth partial sync with empty tracks payload.
  await requestJson(
    'POST',
    '/api/projects/sync',
    {
      project: {
        projectId,
        slug,
        title: project.title || 'Login Track URL Persistence',
        artistName: project.artistName || 'Tap QA Login',
        published: false,
        instagramUrl: '@tapalbum'
      },
      tracks: []
    },
    secondToken
  );

  const projectResponse = await requestJson('GET', `/api/projects/${encodeURIComponent(slug)}`, undefined, secondToken);
  const persistedTracks = Array.isArray(projectResponse?.tracks) ? projectResponse.tracks : [];
  const targetTrack = persistedTracks.find((item) => String(item?.trackId || '').trim() === trackId);
  assert(targetTrack, `Track missing after logout/login flow (${trackId}).`);
  const persistedTrackUrl = String(targetTrack.trackUrl || targetTrack.audioUrl || targetTrack.mp3Url || '').trim();
  assert(persistedTrackUrl, 'Track URL missing after logout/login flow.');
  assert(
    persistedTrackUrl.includes('p.scdn.co') || persistedTrackUrl === trackUrl,
    `Unexpected persisted URL after login flow: ${persistedTrackUrl}`
  );

  console.log('[login-track-url-persistence] passed');
  console.log(`projectId=${projectId}`);
  console.log(`slug=${slug}`);
  console.log(`trackId=${trackId}`);
  console.log(`persistedUrl=${persistedTrackUrl}`);
};

run().catch((error) => {
  console.error('[login-track-url-persistence] failed:', error.message || error);
  process.exitCode = 1;
});
