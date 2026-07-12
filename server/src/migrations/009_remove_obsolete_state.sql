-- Remove obsolete state left by retired recommendation, theater, and settings flows.

ALTER TABLE titles DROP COLUMN raw_tmdb;

ALTER TABLE user_state RENAME TO user_state_legacy;

CREATE TABLE user_state (
  title_id INTEGER PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'wishlist' CHECK (status IN ('saved','wishlist','watching','watched','dropped','paused')),
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 10),
  notes TEXT,
  watched_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO user_state (title_id, status, user_rating, notes, watched_at, updated_at)
SELECT title_id, status, user_rating, notes, watched_at, updated_at
FROM user_state_legacy;

DROP TABLE user_state_legacy;

ALTER TABLE suggestion_log RENAME TO suggestion_log_legacy;

CREATE TABLE suggestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER REFERENCES titles(id) ON DELETE SET NULL,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
  action TEXT NOT NULL CHECK (action IN ('shown','accepted','shuffled','skipped')),
  constraints TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO suggestion_log (id, title_id, tmdb_id, media_type, action, constraints, created_at)
SELECT id, title_id, tmdb_id, media_type, action, constraints, created_at
FROM suggestion_log_legacy;

DROP TABLE suggestion_log_legacy;

CREATE INDEX idx_suggestion_log_identity ON suggestion_log(media_type, tmdb_id, created_at DESC);
CREATE INDEX idx_suggestion_log_title ON suggestion_log(title_id, created_at DESC);

ALTER TABLE my_services RENAME TO my_services_legacy;

CREATE TABLE my_services (
  provider_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1
);

INSERT INTO my_services (provider_id, enabled)
SELECT provider_id, enabled FROM my_services_legacy;

DROP TABLE my_services_legacy;

ALTER TABLE events RENAME TO events_legacy;

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER REFERENCES titles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('new_episode','season_premiere','arrived_on_service','left_service','now_streaming')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  seen INTEGER NOT NULL DEFAULT 0
);

INSERT INTO events (id, title_id, type, payload, created_at, seen)
SELECT id, title_id, type, payload, created_at, seen
FROM events_legacy
WHERE type != 'now_in_theaters';

DROP TABLE events_legacy;

CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_events_seen ON events(seen);

DELETE FROM settings WHERE key IN ('theme', 'pick_scope_default_v2');
