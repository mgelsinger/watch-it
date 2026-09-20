import { getDb, cacheGet, cacheSet } from '../db.js';
import { nowIso } from '../config.js';
import * as tmdb from '../sources/tmdb.js';

const WEEK = 7 * 86400_000;

/**
 * Store a movie's release dates for one region (earliest date per type).
 * Keyed by tmdb_id so discovery-row movies that aren't library titles fit too.
 */
export function upsertReleaseDates(tmdbId: number, region: string, regions: tmdb.RegionReleaseDates): void {
  const db = getDb();
  const entry = regions.find((r) => r.iso_3166_1 === region);
  if (!entry) return;
  const byType = new Map<number, string>();
  for (const rd of entry.release_dates) {
    const date = rd.release_date.slice(0, 10);
    if (!date) continue;
    const prev = byType.get(rd.type);
    if (!prev || date < prev) byType.set(rd.type, date);
  }
  const stmt = db.prepare(`
    INSERT INTO release_dates (tmdb_id, region, type, date, metadata_cached_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tmdb_id, region, type) DO UPDATE SET date = excluded.date, metadata_cached_at = excluded.metadata_cached_at
  `);
  const run = db.transaction(() => {
    for (const [type, date] of byType) stmt.run(tmdbId, region, type, date, nowIso());
  });
  run();
}

/** Fetch + store a movie's release dates unless refreshed within the last week. */
export async function ensureReleaseDates(tmdbId: number, region: string): Promise<void> {
  const key = `tmdb_release_dates:${tmdbId}:${region}`;
  if (cacheGet(key, WEEK)?.fresh) return;
  upsertReleaseDates(tmdbId, region, await tmdb.movieReleaseDates(tmdbId));
  cacheSet(key, { fetched: true }); // freshness marker; the dates live in release_dates
}

export interface ReleaseDateRow {
  type: number;
  date: string;
}

/** Region release dates for one movie: [{type, date}], types 4 = Digital, 5 = Physical. */
export function getReleaseDates(tmdbId: number, region: string): ReleaseDateRow[] {
  return getDb()
    .prepare('SELECT type, date FROM release_dates WHERE tmdb_id = ? AND region = ? ORDER BY type')
    .all(tmdbId, region) as ReleaseDateRow[];
}
