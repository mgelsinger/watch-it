-- Add a low-priority saved state that does not participate in Watchlist or
-- Continue Watching notifications.

ALTER TABLE user_state RENAME TO user_state_legacy;

CREATE TABLE user_state (
  title_id INTEGER PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'wishlist' CHECK (status IN ('saved','wishlist','watching','watched','dropped','paused')),
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 10),
  notes TEXT,
  watched_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  never_suggest INTEGER NOT NULL DEFAULT 0
);

INSERT INTO user_state (title_id, status, user_rating, notes, watched_at, updated_at, never_suggest)
SELECT title_id, status, user_rating, notes, watched_at, updated_at, never_suggest
FROM user_state_legacy;

DROP TABLE user_state_legacy;
