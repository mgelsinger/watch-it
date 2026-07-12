-- Record when a recommendation is displayed so it can be held out during the
-- repeat cooldown even when the user leaves without pressing an action.

ALTER TABLE suggestion_log RENAME TO suggestion_log_legacy;

CREATE TABLE suggestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER REFERENCES titles(id) ON DELETE SET NULL,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
  episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('shown','accepted','shuffled','skipped')),
  constraints TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO suggestion_log (id, title_id, tmdb_id, media_type, episode_id, action, constraints, created_at)
SELECT id, title_id, tmdb_id, media_type, episode_id, action, constraints, created_at
FROM suggestion_log_legacy;

DROP TABLE suggestion_log_legacy;

CREATE INDEX idx_suggestion_log_identity ON suggestion_log(media_type, tmdb_id, created_at DESC);
CREATE INDEX idx_suggestion_log_title ON suggestion_log(title_id, created_at DESC);
