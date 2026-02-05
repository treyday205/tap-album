CREATE TABLE IF NOT EXISTS access_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  email TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  unlocked BOOLEAN NOT NULL DEFAULT false,
  remaining INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  unlocked_at TIMESTAMPTZ,
  UNIQUE (project_id, email)
);

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

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  cover_image_url TEXT,
  published BOOLEAN NOT NULL DEFAULT false,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
