import type { DB } from '../db.js';

/** Provider content is disposable. Identity and personal progress are not. */
export function expireProviderMetadata(db: DB, now = new Date()): void {
  const cutoff = new Date(now.getTime() - 90 * 86400_000).toISOString();
  const eventsCutoff = new Date(now.getTime() - 30 * 86400_000).toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE titles SET name = 'TMDB ' || media_type || ' ' || tmdb_id,
      imdb_id = NULL, year = NULL, overview = NULL, poster_path = NULL, backdrop_path = NULL,
      tmdb_rating = NULL, genres = '[]', original_language = NULL, runtime = NULL,
      status_upstream = NULL, release_cadence = NULL, metadata_refreshed_at = NULL
      WHERE COALESCE(metadata_refreshed_at, added_at) < ?`).run(cutoff);
    db.prepare(`UPDATE titles SET imdb_rating = NULL, rt_score = NULL, metacritic = NULL,
      ratings_refreshed_at = NULL WHERE ratings_refreshed_at IS NULL OR ratings_refreshed_at < ?`).run(cutoff);
    db.prepare(`UPDATE titles SET release_cadence = NULL WHERE id IN (
      SELECT s.title_id FROM seasons s JOIN episodes e ON e.season_id = s.id
      WHERE e.metadata_cached_at IS NULL OR e.metadata_cached_at < ?
    )`).run(cutoff);
    db.prepare(`UPDATE seasons SET name = NULL, episode_count = NULL, air_date = NULL,
      poster_path = NULL, metadata_cached_at = NULL
      WHERE metadata_cached_at IS NULL OR metadata_cached_at < ?`).run(cutoff);
    db.prepare(`UPDATE episodes SET name = NULL, air_date = NULL, runtime = NULL,
      overview = NULL, metadata_cached_at = NULL
      WHERE metadata_cached_at IS NULL OR metadata_cached_at < ?`).run(cutoff);
    db.prepare('DELETE FROM cast_members WHERE metadata_cached_at IS NULL OR metadata_cached_at < ?').run(cutoff);
    db.prepare('DELETE FROM release_dates WHERE metadata_cached_at IS NULL OR metadata_cached_at < ?').run(cutoff);
    db.prepare('DELETE FROM availability WHERE last_seen < ?').run(cutoff);
    db.prepare('DELETE FROM provider_checks WHERE checked_at < ?').run(cutoff);
    db.prepare('DELETE FROM events WHERE created_at < ?').run(eventsCutoff);
    db.prepare('DELETE FROM api_cache WHERE fetched_at < ?').run(eventsCutoff);
  })();
}
