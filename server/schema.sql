CREATE TABLE IF NOT EXISTS access_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  email TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  unlocked BOOLEAN NOT NULL DEFAULT false,
  remaining INTEGER NOT NULL DEFAULT 1000000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  unlocked_at TIMESTAMPTZ,
  last_ip TEXT,
  last_user_agent TEXT,
  UNIQUE (project_id, email)
);

ALTER TABLE access_records
  ADD COLUMN IF NOT EXISTS last_ip TEXT;

ALTER TABLE access_records
  ADD COLUMN IF NOT EXISTS last_user_agent TEXT;

ALTER TABLE access_records
  ALTER COLUMN remaining SET DEFAULT 1000000;

UPDATE access_records
SET remaining = 1000000
WHERE remaining < 1000000;

DELETE FROM access_records a
USING access_records b
WHERE a.project_id = b.project_id
  AND a.email = b.email
  AND (
    a.updated_at < b.updated_at
    OR (a.updated_at = b.updated_at AND a.id < b.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_records_project_email_unique
  ON access_records (project_id, email);

CREATE TABLE IF NOT EXISTS project_email_unlocks (
  project_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  email TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  unlocks_used INTEGER NOT NULL DEFAULT 0,
  last_unlock_at TIMESTAMPTZ,
  per_email_limit INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_ip TEXT,
  last_user_agent TEXT,
  PRIMARY KEY (project_id, email_normalized)
);

ALTER TABLE project_email_unlocks
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE project_email_unlocks
  ADD COLUMN IF NOT EXISTS unlocks_used INTEGER NOT NULL DEFAULT 0;

ALTER TABLE project_email_unlocks
  ADD COLUMN IF NOT EXISTS last_unlock_at TIMESTAMPTZ;

ALTER TABLE project_email_unlocks
  ADD COLUMN IF NOT EXISTS per_email_limit INTEGER;

ALTER TABLE project_email_unlocks
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE project_email_unlocks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE project_email_unlocks
  ADD COLUMN IF NOT EXISTS last_ip TEXT;

ALTER TABLE project_email_unlocks
  ADD COLUMN IF NOT EXISTS last_user_agent TEXT;

CREATE INDEX IF NOT EXISTS idx_project_email_unlocks_project
  ON project_email_unlocks (project_id);

CREATE INDEX IF NOT EXISTS idx_project_email_unlocks_recent
  ON project_email_unlocks (project_id, last_unlock_at DESC);

CREATE TABLE IF NOT EXISTS magic_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pins (
  id TEXT PRIMARY KEY,
  access_id TEXT NOT NULL REFERENCES access_records(id) ON DELETE CASCADE,
  pin_code TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links (expires_at);
CREATE INDEX IF NOT EXISTS idx_pins_access_used ON pins (access_id, used);
CREATE INDEX IF NOT EXISTS idx_access_records_project_unlocked ON access_records (project_id, unlocked);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  cover_image_url TEXT,
  pin_unlock_count INTEGER NOT NULL DEFAULT 0,
  pin_active_count INTEGER NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT false,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS pin_unlock_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS pin_active_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE projects
  ALTER COLUMN pin_unlock_count SET DEFAULT 0;

ALTER TABLE projects
  ALTER COLUMN pin_active_count SET DEFAULT 0;

UPDATE projects p
SET pin_unlock_count = stats.unlocked_count
FROM (
  SELECT project_id, COUNT(*)::int AS unlocked_count
  FROM access_records
  WHERE unlocked = true
  GROUP BY project_id
) stats
WHERE p.project_id = stats.project_id
  AND p.pin_unlock_count < stats.unlocked_count;

UPDATE projects p
SET pin_active_count = COALESCE(stats.active_count, 0)
FROM (
  SELECT p2.project_id, COALESCE(ap.active_count, 0) AS active_count
  FROM projects p2
  LEFT JOIN (
    SELECT ar.project_id, COUNT(*)::int AS active_count
    FROM access_records ar
    JOIN pins pin ON pin.access_id = ar.id
    WHERE pin.used = false
    GROUP BY ar.project_id
  ) ap ON ap.project_id = p2.project_id
) stats
WHERE p.project_id = stats.project_id
  AND p.pin_active_count <> stats.active_count;

CREATE TABLE IF NOT EXISTS tracks (
  track_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  track_no INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT,
  audio_path TEXT,
  audio_url TEXT,
  mp3_url TEXT,
  artwork_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS track_no INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS audio_path TEXT;

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS audio_url TEXT;

UPDATE tracks
SET track_no = CASE
  WHEN COALESCE(track_no, 0) > 0 THEN track_no
  WHEN COALESCE(sort_order, 0) > 0 THEN sort_order
  ELSE 1
END;

UPDATE tracks
SET storage_path = SUBSTRING(mp3_url FROM 7)
WHERE (storage_path IS NULL OR BTRIM(storage_path) = '')
  AND mp3_url LIKE 'asset:%';

UPDATE tracks
SET audio_path = storage_path
WHERE (audio_path IS NULL OR BTRIM(audio_path) = '')
  AND storage_path IS NOT NULL
  AND BTRIM(storage_path) <> '';

UPDATE tracks
SET audio_url = mp3_url
WHERE (audio_url IS NULL OR BTRIM(audio_url) = '')
  AND mp3_url ILIKE 'http%';

CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug);
CREATE INDEX IF NOT EXISTS idx_tracks_project ON tracks (project_id);
CREATE INDEX IF NOT EXISTS idx_tracks_project_track_no ON tracks (project_id, track_no);
