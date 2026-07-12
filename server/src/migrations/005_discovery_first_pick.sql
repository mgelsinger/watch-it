-- Discovery-first Pick For Me.
-- Suggestions are keyed by TMDB identity so external candidates do not need
-- to be added to the local library before they can be shown or skipped.

ALTER TABLE suggestion_log RENAME TO suggestion_log_legacy;

CREATE TABLE suggestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER REFERENCES titles(id) ON DELETE SET NULL,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
  episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('accepted','shuffled','skipped')),
  constraints TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO suggestion_log (id, title_id, tmdb_id, media_type, episode_id, action, constraints, created_at)
SELECT sl.id, sl.title_id, t.tmdb_id, t.media_type, sl.episode_id, sl.action, sl.constraints, sl.created_at
FROM suggestion_log_legacy sl
JOIN titles t ON t.id = sl.title_id;

DROP TABLE suggestion_log_legacy;

CREATE INDEX idx_suggestion_log_identity ON suggestion_log(media_type, tmdb_id, created_at DESC);
CREATE INDEX idx_suggestion_log_title ON suggestion_log(title_id, created_at DESC);

CREATE TABLE suggestion_suppressions (
  media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
  tmdb_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (media_type, tmdb_id)
);

INSERT OR IGNORE INTO suggestion_suppressions (media_type, tmdb_id)
SELECT t.media_type, t.tmdb_id
FROM titles t
JOIN user_state us ON us.title_id = t.id
WHERE us.never_suggest = 1;
