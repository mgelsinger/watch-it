CREATE TABLE auth_configuration (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  password_digest TEXT NOT NULL
);

CREATE TABLE provider_checks (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  watch_url TEXT,
  PRIMARY KEY (title_id, region)
);
