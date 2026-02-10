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
  UNIQUE (project_id, email)
);

ALTER TABLE access_records
  ALTER COLUMN remaining SET DEFAULT 1000000;

UPDATE access_records
SET remaining = 1000000
WHERE remaining < 1000000;

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
  mp3_url TEXT,
  artwork_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug);
CREATE INDEX IF NOT EXISTS idx_tracks_project ON tracks (project_id);
