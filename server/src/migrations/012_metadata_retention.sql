-- Independent fetch dates prevent a partial refresh from extending old child data.
ALTER TABLE seasons ADD COLUMN metadata_cached_at TEXT;
ALTER TABLE episodes ADD COLUMN metadata_cached_at TEXT;
ALTER TABLE cast_members ADD COLUMN metadata_cached_at TEXT;
ALTER TABLE release_dates ADD COLUMN metadata_cached_at TEXT;

-- Existing child records have no reliable fetch date. Leave it unknown and
-- expire descriptive fields on startup; stable IDs and watch progress survive.
