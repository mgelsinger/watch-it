-- CR-03: Pick For Me Tonight.

CREATE TABLE IF NOT EXISTS suggestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('accepted','shuffled','skipped')),
  constraints TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_suggestion_log_title ON suggestion_log(title_id, created_at DESC);

ALTER TABLE user_state ADD COLUMN never_suggest INTEGER NOT NULL DEFAULT 0;
