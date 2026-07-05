-- CR-02: Browse mode.

-- Discover queries used recently, so the daily sync can re-warm page 1 of
-- anything the user browsed in the last 7 days.
CREATE TABLE IF NOT EXISTS discover_queries (
  key TEXT PRIMARY KEY,   -- api_cache key holding the cached payload
  kind TEXT NOT NULL,     -- 'genre-row' | 'grid'
  payload TEXT NOT NULL,  -- JSON with everything needed to re-run the fetch
  last_used TEXT NOT NULL
);

-- "Bingeable": has at least one real season whose every episode already aired.
-- Computable only for tracked shows (TMDB Discover has no per-episode filter).
CREATE VIEW IF NOT EXISTS bingeable_titles AS
SELECT DISTINCT s.title_id
FROM seasons s
WHERE s.season_number > 0
  AND EXISTS (SELECT 1 FROM episodes e WHERE e.season_id = s.id)
  AND NOT EXISTS (
    SELECT 1 FROM episodes e
    WHERE e.season_id = s.id AND (e.air_date IS NULL OR e.air_date > date('now','localtime'))
  );
