import { getDb, getSetting } from '../db.js';
import { nowIso, localToday } from '../config.js';
import * as tmdb from '../sources/tmdb.js';
import * as omdb from '../sources/omdb.js';
import { QuotaError } from '../http.js';
import { classifyTitle } from './cadence.js';
import { applyProviders } from './availability.js';
import { upsertReleaseDates } from './releaseDates.js';
import { emitEvent, eventExists } from './events.js';

export type MediaType = 'movie' | 'tv';
export type UserStatus = 'wishlist' | 'watching' | 'watched' | 'dropped' | 'paused';

export interface TitleRow {
  id: number;
  tmdb_id: number;
  media_type: MediaType;
  imdb_id: string | null;
  name: string;
  year: number | null;
  status_upstream: string | null;
  ratings_refreshed_at: string | null;
}

const THEATRICAL_WINDOW_DAYS = 120;

function yearOf(date: string | null | undefined): number | null {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 1800 ? y : null;
}

/**
 * A released movie with a recent theatrical date and no home offer yet is
 * "In Theaters" -- that drives the theater-to-streaming pipeline.
 */
function movieStatus(details: tmdb.MovieDetails): string | null {
  const status = details.status ?? null;
  if (status !== 'Released' || !details.release_date) return status;
  const region = getSetting('region');
  const offers = details['watch/providers']?.results?.[region] ?? {};
  const hasHomeOffer = ['flatrate', 'rent', 'buy', 'free', 'ads'].some(
    (t) => ((offers as Record<string, unknown[]>)[t] ?? []).length > 0,
  );
  const ageDays = (Date.now() - Date.parse(details.release_date)) / 86400_000;
  if (!hasHomeOffer && ageDays >= 0 && ageDays <= THEATRICAL_WINDOW_DAYS) return 'In Theaters';
  return status;
}

function upsertCast(titleId: number, cast: { id: number; name: string; character?: string | null; order?: number | null; profile_path?: string | null }[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO cast_members (title_id, tmdb_person_id, name, character, ord, profile_path)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(title_id, tmdb_person_id, character)
    DO UPDATE SET name = excluded.name, ord = excluded.ord, profile_path = excluded.profile_path
  `);
  const run = db.transaction(() => {
    for (const c of cast.slice(0, 24)) {
      stmt.run(titleId, c.id, c.name, c.character ?? '', c.order ?? 0, c.profile_path ?? null);
    }
  });
  run();
}

async function syncTvSeasons(titleId: number, details: tmdb.TvDetails): Promise<void> {
  const db = getDb();
  const seasonUpsert = db.prepare(`
    INSERT INTO seasons (title_id, season_number, name, episode_count, air_date, poster_path)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(title_id, season_number)
    DO UPDATE SET name = excluded.name, episode_count = excluded.episode_count,
                  air_date = excluded.air_date, poster_path = excluded.poster_path
    RETURNING id
  `);
  const episodeUpsert = db.prepare(`
    INSERT INTO episodes (season_id, episode_number, name, air_date, runtime, overview)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(season_id, episode_number)
    DO UPDATE SET name = excluded.name, air_date = excluded.air_date,
                  runtime = excluded.runtime, overview = excluded.overview
  `);

  for (const summary of details.seasons) {
    let season: tmdb.SeasonDetails;
    try {
      season = await tmdb.seasonDetails(details.id, summary.season_number);
    } catch (err) {
      console.error(`[library] season ${summary.season_number} of tmdb:${details.id} failed, skipping:`, (err as Error).message);
      continue;
    }
    const write = db.transaction(() => {
      const { id: seasonId } = seasonUpsert.get(
        titleId,
        season.season_number,
        season.name ?? summary.name ?? `Season ${season.season_number}`,
        season.episodes.length || summary.episode_count || null,
        season.air_date ?? summary.air_date ?? null,
        season.poster_path ?? summary.poster_path ?? null,
      ) as { id: number };
      for (const ep of season.episodes) {
        episodeUpsert.run(seasonId, ep.episode_number, ep.name ?? null, ep.air_date ?? null, ep.runtime ?? null, ep.overview ?? null);
      }
    });
    write();
  }
  updateCadence(titleId);
}

export function updateCadence(titleId: number): void {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT s.season_number AS sn, e.air_date AS ad
      FROM seasons s JOIN episodes e ON e.season_id = s.id
      WHERE s.title_id = ? AND s.season_number > 0
    `)
    .all(titleId) as { sn: number; ad: string | null }[];
  const bySeason = new Map<number, (string | null)[]>();
  for (const r of rows) {
    if (!bySeason.has(r.sn)) bySeason.set(r.sn, []);
    bySeason.get(r.sn)!.push(r.ad);
  }
  const cadence = classifyTitle([...bySeason.entries()].map(([seasonNumber, airDates]) => ({ seasonNumber, airDates })));
  db.prepare('UPDATE titles SET release_cadence = ? WHERE id = ?').run(cadence ? JSON.stringify(cadence) : null, titleId);
}

/** Refresh OMDb ratings for one title. Silently defers on quota exhaustion. */
export async function refreshRatings(titleId: number): Promise<boolean> {
  const db = getDb();
  const title = db.prepare('SELECT imdb_id FROM titles WHERE id = ?').get(titleId) as { imdb_id: string | null } | undefined;
  if (!title?.imdb_id || !omdb.omdbConfigured()) return false;
  try {
    const r = await omdb.getRatings(title.imdb_id);
    db.prepare('UPDATE titles SET imdb_rating = ?, rt_score = ?, metacritic = ?, ratings_refreshed_at = ? WHERE id = ?')
      .run(r.imdbRating, r.rtScore, r.metacritic, nowIso(), titleId);
    return true;
  } catch (err) {
    if (err instanceof QuotaError) {
      console.warn(`[omdb] deferred ratings for title ${titleId}: ${err.message}`);
      return false;
    }
    console.error(`[omdb] ratings for title ${titleId} failed:`, (err as Error).message);
    return false;
  }
}

async function fetchAndStore(
  tmdbId: number,
  mediaType: MediaType,
  existingId: number | null,
  opts: { initialSync: boolean },
): Promise<number> {
  const db = getDb();
  const now = nowIso();

  let common: {
    name: string; year: number | null; overview: string | null; poster: string | null; backdrop: string | null;
    rating: number | null; genres: string; runtime: number | null; status: string | null; imdb: string | null;
    raw: string; providers: Record<string, tmdb.RegionOffers>;
    cast: { id: number; name: string; character?: string | null; order?: number | null; profile_path?: string | null }[];
  };
  let tvPayload: tmdb.TvDetails | null = null;

  if (mediaType === 'movie') {
    const d = await tmdb.movieDetails(tmdbId);
    common = {
      name: d.title,
      year: yearOf(d.release_date),
      overview: d.overview ?? null,
      poster: d.poster_path ?? null,
      backdrop: d.backdrop_path ?? null,
      rating: d.vote_average ?? null,
      genres: JSON.stringify(d.genres.map((g) => g.name)),
      runtime: d.runtime ?? null,
      status: movieStatus(d),
      imdb: d.external_ids?.imdb_id ?? d.imdb_id ?? null,
      raw: JSON.stringify(d),
      providers: d['watch/providers']?.results ?? {},
      cast: d.credits?.cast ?? [],
    };
    upsertReleaseDates(tmdbId, getSetting('region'), d.release_dates?.results ?? []);
  } else {
    const d = await tmdb.tvDetails(tmdbId);
    tvPayload = d;
    common = {
      name: d.name,
      year: yearOf(d.first_air_date),
      overview: d.overview ?? null,
      poster: d.poster_path ?? null,
      backdrop: d.backdrop_path ?? null,
      rating: d.vote_average ?? null,
      genres: JSON.stringify(d.genres.map((g) => g.name)),
      runtime: d.episode_run_time[0] ?? null,
      status: d.status ?? null,
      imdb: d.external_ids?.imdb_id ?? null,
      raw: JSON.stringify(d),
      providers: d['watch/providers']?.results ?? {},
      cast: d.credits?.cast ?? [],
    };
  }

  let titleId: number;
  if (existingId == null) {
    const res = db
      .prepare(`
        INSERT INTO titles (tmdb_id, media_type, imdb_id, name, year, overview, poster_path, backdrop_path,
                            tmdb_rating, genres, runtime, status_upstream, added_at, metadata_refreshed_at, raw_tmdb)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(tmdbId, mediaType, common.imdb, common.name, common.year, common.overview, common.poster, common.backdrop,
        common.rating, common.genres, common.runtime, common.status, now, now, common.raw);
    titleId = Number(res.lastInsertRowid);
  } else {
    titleId = existingId;
    db.prepare(`
      UPDATE titles SET imdb_id = ?, name = ?, year = ?, overview = ?, poster_path = ?, backdrop_path = ?,
                        tmdb_rating = ?, genres = ?, runtime = ?, status_upstream = ?, metadata_refreshed_at = ?, raw_tmdb = ?
      WHERE id = ?
    `).run(common.imdb, common.name, common.year, common.overview, common.poster, common.backdrop,
      common.rating, common.genres, common.runtime, common.status, now, common.raw, titleId);
  }

  upsertCast(titleId, common.cast);
  applyProviders(titleId, common.providers, { initialSync: opts.initialSync });

  if (tvPayload) await syncTvSeasons(titleId, tvPayload);
  return titleId;
}

/** Add a title to the library (or return the existing one). */
export async function addTitle(tmdbId: number, mediaType: MediaType, status: UserStatus = 'wishlist'): Promise<number> {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM titles WHERE tmdb_id = ? AND media_type = ?')
    .get(tmdbId, mediaType) as { id: number } | undefined;
  if (existing) return existing.id;

  // Initial availability snapshot: flagged initial_sync, no "arrived" events.
  const titleId = await fetchAndStore(tmdbId, mediaType, null, { initialSync: true });
  db.prepare('INSERT OR IGNORE INTO user_state (title_id, status, updated_at) VALUES (?, ?, ?)').run(titleId, status, nowIso());
  await refreshRatings(titleId); // best effort; quota-aware
  return titleId;
}

/** Full per-title refresh: metadata, seasons/episodes, providers (with events), stale ratings. */
export async function refreshTitle(titleId: number): Promise<void> {
  const db = getDb();
  const title = db.prepare('SELECT id, tmdb_id, media_type, ratings_refreshed_at FROM titles WHERE id = ?').get(titleId) as
    | Pick<TitleRow, 'id' | 'tmdb_id' | 'media_type' | 'ratings_refreshed_at'>
    | undefined;
  if (!title) throw new Error(`title ${titleId} not found`);
  await fetchAndStore(title.tmdb_id, title.media_type, title.id, { initialSync: false });
  const staleBefore = Date.now() - 7 * 86400_000;
  if (!title.ratings_refreshed_at || Date.parse(title.ratings_refreshed_at) < staleBefore) {
    await refreshRatings(titleId);
  }
}

/** Providers-only refresh (cheaper; used by the daily availability sweep). */
export async function refreshProviders(titleId: number): Promise<void> {
  const db = getDb();
  const title = db.prepare('SELECT tmdb_id, media_type FROM titles WHERE id = ?').get(titleId) as
    | { tmdb_id: number; media_type: MediaType }
    | undefined;
  if (!title) return;
  const providers = title.media_type === 'movie' ? await tmdb.movieProviders(title.tmdb_id) : await tmdb.tvProviders(title.tmdb_id);
  applyProviders(titleId, providers, { initialSync: false });
}

/** Lazily resolve IMDb person ids for a title's cast (first detail-page view). */
export async function hydrateCastImdbIds(titleId: number): Promise<void> {
  const db = getDb();
  const missing = db
    .prepare('SELECT id, tmdb_person_id FROM cast_members WHERE title_id = ? AND imdb_person_id IS NULL')
    .all(titleId) as { id: number; tmdb_person_id: number }[];
  for (const m of missing) {
    try {
      const imdb = await tmdb.personImdbId(m.tmdb_person_id);
      // Cache a sentinel for people with no IMDb page so we don't refetch forever.
      db.prepare('UPDATE cast_members SET imdb_person_id = ? WHERE id = ?').run(imdb ?? 'none', m.id);
      if (imdb) {
        // The same person may appear on other titles; share the answer.
        db.prepare('UPDATE cast_members SET imdb_person_id = ? WHERE tmdb_person_id = ? AND imdb_person_id IS NULL').run(imdb, m.tmdb_person_id);
      }
    } catch (err) {
      console.error(`[library] person ${m.tmdb_person_id} external_ids failed:`, (err as Error).message);
    }
  }
}

/**
 * Emit new_episode / season_premiere events for followed shows' episodes airing today.
 * Deduped via the events table.
 */
export function emitTonightEvents(): void {
  const db = getDb();
  const today = localToday();
  const rows = db
    .prepare(`
      SELECT t.id AS title_id, t.name AS title_name, s.season_number, e.id AS episode_id, e.episode_number, e.name AS episode_name
      FROM titles t
      JOIN user_state us ON us.title_id = t.id AND us.status IN ('watching','wishlist','paused')
      JOIN seasons s ON s.title_id = t.id AND s.season_number > 0
      JOIN episodes e ON e.season_id = s.id
      WHERE t.media_type = 'tv' AND e.air_date = ?
    `)
    .all(today) as { title_id: number; title_name: string; season_number: number; episode_id: number; episode_number: number; episode_name: string | null }[];
  for (const r of rows) {
    const type = r.episode_number === 1 ? 'season_premiere' : 'new_episode';
    const key = `"episode_id":${r.episode_id}`;
    if (eventExists(r.title_id, type, key)) continue;
    emitEvent(r.title_id, type, {
      episode_id: r.episode_id,
      season_number: r.season_number,
      episode_number: r.episode_number,
      episode_name: r.episode_name,
      title_name: r.title_name,
      air_date: today,
    });
  }
}
