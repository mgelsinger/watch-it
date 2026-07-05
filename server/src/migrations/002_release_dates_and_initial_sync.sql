-- CR-01: release_dates cache + honest availability dates.

-- Keyed by tmdb_id (not titles.id) because discovery-row movies are usually
-- not in the library yet; library titles join through titles.tmdb_id.
CREATE TABLE IF NOT EXISTS release_dates (
  tmdb_id INTEGER NOT NULL,
  region TEXT NOT NULL,
  type INTEGER NOT NULL, -- TMDB release type: 4 = Digital, 5 = Physical
  date TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, region, type)
);

-- initial_sync = 1: row written the first time we ever synced this title's
-- providers. first_seen on such rows is "when tracking started", NOT an
-- observed arrival on the service. Only initial_sync = 0 rows represent a
-- real arrival seen by a later diff.
ALTER TABLE availability ADD COLUMN initial_sync INTEGER NOT NULL DEFAULT 0;

-- Backfill: rows first seen the same day the title was added came from the
-- initial snapshot, not an observed arrival.
UPDATE availability SET initial_sync = 1
WHERE date(first_seen) = (SELECT date(t.added_at) FROM titles t WHERE t.id = availability.title_id);

-- Purge fake arrival events generated on the day a title was added.
DELETE FROM events
WHERE type = 'arrived_on_service'
  AND title_id IS NOT NULL
  AND date(created_at) = (SELECT date(t.added_at) FROM titles t WHERE t.id = events.title_id);
