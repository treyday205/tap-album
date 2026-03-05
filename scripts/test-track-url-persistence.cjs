#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '.track-url-persistence-state.json');
const DEFAULT_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:4000';

const mode = String(process.argv[2] || 'setup').trim().toLowerCase();
const baseUrl = String(process.argv[3] || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const requestJson = async (method, targetPath, body) => {
  const response = await fetch(`${baseUrl}${targetPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${targetPath}: ${String(payload?.message || '').trim() || 'Request failed'}`);
  }
  return payload;
};

const writeState = (value) => {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const readState = () => {
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  return JSON.parse(raw);
};

const setup = async () => {
  const createResponse = await requestJson('POST', '/api/projects', {
    title: 'Track URL Persistence Test',
    artistName: 'Tap QA'
  });
  const project = createResponse?.project || {};
  const projectId = String(project.projectId || '').trim();
  const slug = String(project.slug || '').trim();
  assert(projectId, 'Missing projectId from create response.');
  assert(slug, 'Missing slug from create response.');

  const trackUrl = 'https://p.scdn.co/mp3-preview/test-track-persistence.mp3';
  const now = new Date().toISOString();
  const trackId = `track-url-test-${Date.now()}`;
  const syncPayload = {
    project: {
      projectId,
      slug,
      title: project.title || 'Track URL Persistence Test',
      artistName: project.artistName || 'Tap QA',
      published: false
    },
    tracks: [
      {
        trackId,
        projectId,
        title: 'Persistence Track',
        mp3Url: trackUrl,
        trackUrl,
        audioUrl: trackUrl,
        spotifyUrl: 'https://open.spotify.com/track/test',
        artworkUrl: '',
        trackNo: 1,
        sortOrder: 1,
        createdAt: now
      }
    ]
  };

  await requestJson('POST', '/api/projects/sync', syncPayload);
  writeState({
    projectId,
    slug,
    trackId,
    expectedTrackUrl: trackUrl,
    createdAt: now
  });

  console.log('[track-url-persistence] setup complete');
  console.log(`Project: ${projectId}`);
  console.log(`Slug: ${slug}`);
  console.log(`State file: ${STATE_FILE}`);
  console.log('Restart the API server, then run:');
  console.log(`node scripts/test-track-url-persistence.cjs verify ${baseUrl}`);
};

const verify = async () => {
  assert(fs.existsSync(STATE_FILE), `State file not found: ${STATE_FILE}`);
  const state = readState();
  const slug = String(state.slug || '').trim();
  const trackId = String(state.trackId || '').trim();
  const expectedTrackUrl = String(state.expectedTrackUrl || '').trim();
  assert(slug, 'State file missing slug.');
  assert(trackId, 'State file missing trackId.');
  assert(expectedTrackUrl, 'State file missing expectedTrackUrl.');

  const projectResponse = await requestJson('GET', `/api/projects/${encodeURIComponent(slug)}`);
  const tracks = Array.isArray(projectResponse?.tracks) ? projectResponse.tracks : [];
  const targetTrack = tracks.find((item) => String(item?.trackId || '').trim() === trackId);

  assert(targetTrack, `Track not found after restart (${trackId}).`);
  const persistedUrl = String(targetTrack.trackUrl || targetTrack.audioUrl || targetTrack.mp3Url || '').trim();
  assert(persistedUrl, 'Persisted track URL is empty after restart.');
  assert(
    persistedUrl.includes('p.scdn.co') || persistedUrl === expectedTrackUrl,
    `Unexpected persisted URL: ${persistedUrl}`
  );

  console.log('[track-url-persistence] verify passed');
  console.log(`Track ID: ${trackId}`);
  console.log(`Persisted URL: ${persistedUrl}`);
};

const run = async () => {
  if (mode === 'setup') {
    await setup();
    return;
  }
  if (mode === 'verify') {
    await verify();
    return;
  }
  throw new Error(`Unknown mode "${mode}". Use "setup" or "verify".`);
};

run().catch((error) => {
  console.error('[track-url-persistence] failed:', error.message || error);
  process.exitCode = 1;
});
