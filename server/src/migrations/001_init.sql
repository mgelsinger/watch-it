-- watch-it initial schema
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
  imdb_id TEXT,
  name TEXT NOT NULL,
  year INTEGER,
  overview TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  tmdb_rating REAL,
  imdb_rating REAL,
  rt_score INTEGER,
  metacritic INTEGER,
  genres TEXT NOT NULL DEFAULT '[]',
  runtime INTEGER,
  status_upstream TEXT,
  release_cadence TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ratings_refreshed_at TEXT,
  metadata_refreshed_at TEXT,
  raw_tmdb TEXT,
  UNIQUE (tmdb_id, media_type)
);

CREATE TABLE IF NOT EXISTS user_state (
  title_id INTEGER PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'wishlist' CHECK (status IN ('wishlist','watching','watched','dropped','paused')),
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 10),
  notes TEXT,
  watched_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  name TEXT,
  episode_count INTEGER,
  air_date TEXT,
  poster_path TEXT,
  UNIQUE (title_id, season_number)
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  name TEXT,
  air_date TEXT,
  runtime INTEGER,
  overview TEXT,
  watched_at TEXT,
  UNIQUE (season_id, episode_number)
);

CREATE TABLE IF NOT EXISTS cast_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  tmdb_person_id INTEGER NOT NULL,
  imdb_person_id TEXT,
  name TEXT NOT NULL,
  character TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  profile_path TEXT,
  UNIQUE (title_id, tmdb_person_id, character)
);

CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL,
  provider_name TEXT NOT NULL,
  logo_path TEXT,
  offer_type TEXT NOT NULL CHECK (offer_type IN ('flatrate','rent','buy','free','ads')),
  region TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (title_id, provider_id, offer_type, region)
);

CREATE TABLE IF NOT EXISTS my_services (
  provider_id INTEGER PRIMARY KEY,
  provider_name TEXT NOT NULL,
  logo_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER REFERENCES titles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('new_episode','season_premiere','arrived_on_service','left_service','now_in_theaters','now_streaming')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  seen INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seasons_title ON seasons(title_id);
CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_episodes_air ON episodes(air_date);
CREATE INDEX IF NOT EXISTS idx_episodes_watched ON episodes(watched_at);
CREATE INDEX IF NOT EXISTS idx_cast_title ON cast_members(title_id);
CREATE INDEX IF NOT EXISTS idx_avail_title ON availability(title_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_seen ON events(seen);
CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log(started_at DESC);
