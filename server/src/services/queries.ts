import { getDb, getSetting, cacheGet } from '../db.js';
import { localToday } from '../config.js';

const CARD_COLS = `t.id, t.tmdb_id, t.media_type, t.imdb_id, t.name, t.year, t.poster_path,
  t.tmdb_rating, t.imdb_rating, t.rt_score, t.metacritic, t.status_upstream, t.release_cadence`;

export interface CardRow {
  id: number;
  media_type: 'movie' | 'tv';
  name: string;
  year: number | null;
  poster_path: string | null;
  [k: string]: unknown;
}

function db() {
  return getDb();
}

/** Streaming offers on the user's enabled services, attached to card rows. */
function attachMyOffers(rows: CardRow[]): CardRow[] {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const q = db()
    .prepare(`
      SELECT a.title_id, a.provider_name, a.logo_path FROM availability a
      JOIN my_services m ON m.provider_id = a.provider_id AND m.enabled = 1
      WHERE a.active = 1 AND a.offer_type IN ('flatrate','free','ads')
        AND a.title_id IN (${ids.map(() => '?').join(',')})
    `)
    .all(...ids) as { title_id: number; provider_name: string; logo_path: string | null }[];
  const byTitle = new Map<number, { provider_name: string; logo_path: string | null }[]>();
  for (const r of q) {
    if (!byTitle.has(r.title_id)) byTitle.set(r.title_id, []);
    byTitle.get(r.title_id)!.push({ provider_name: r.provider_name, logo_path: r.logo_path });
  }
  for (const row of rows) row.my_offers = byTitle.get(row.id) ?? [];
  return rows;
}

export function continueWatching(): CardRow[] {
  const today = localToday();
  const rows = db()
    .prepare(`
      SELECT * FROM (
        SELECT ${CARD_COLS}, e.id AS next_episode_id, e.name AS next_episode_name,
               s.season_number AS next_season, e.episode_number AS next_episode, e.air_date AS next_air_date,
               ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY s.season_number, e.episode_number) AS rn,
               (SELECT MAX(e2.watched_at) FROM episodes e2 JOIN seasons s2 ON e2.season_id = s2.id WHERE s2.title_id = t.id) AS last_watched
        FROM titles t
        JOIN user_state us ON us.title_id = t.id AND us.status = 'watching'
        JOIN seasons s ON s.title_id = t.id AND s.season_number > 0
        JOIN episodes e ON e.season_id = s.id AND e.watched_at IS NULL AND e.air_date IS NOT NULL AND e.air_date <= ?
        WHERE t.media_type = 'tv'
      ) WHERE rn = 1
      ORDER BY last_watched DESC NULLS LAST
      LIMIT 25
    `)
    .all(today) as CardRow[];
  return attachMyOffers(rows);
}

export function newTonight(): CardRow[] {
  const today = localToday();
  const rows = db()
    .prepare(`
      SELECT DISTINCT ${CARD_COLS}, e.episode_number AS tonight_episode, s.season_number AS tonight_season
      FROM titles t
      JOIN user_state us ON us.title_id = t.id AND us.status IN ('watching','wishlist','paused')
      JOIN seasons s ON s.title_id = t.id AND s.season_number > 0
      JOIN episodes e ON e.season_id = s.id AND e.air_date = ?
      WHERE t.media_type = 'tv'
      LIMIT 25
    `)
    .all(today) as CardRow[];
  return attachMyOffers(rows);
}

export function returningSoon(): CardRow[] {
  const today = localToday();
  const rows = db()
    .prepare(`
      SELECT ${CARD_COLS}, MIN(e.air_date) AS next_air_date,
             s.season_number AS next_season, MIN(e.episode_number) AS next_episode
      FROM titles t
      JOIN user_state us ON us.title_id = t.id AND us.status IN ('watching','wishlist','paused')
      JOIN seasons s ON s.title_id = t.id AND s.season_number > 0
      JOIN episodes e ON e.season_id = s.id AND e.air_date > ?
      WHERE t.media_type = 'tv'
      GROUP BY t.id
      ORDER BY next_air_date ASC
      LIMIT 25
    `)
    .all(today) as CardRow[];
  return attachMyOffers(rows);
}

export function wishlistAvailable(): CardRow[] {
  const rows = db()
    .prepare(`
      SELECT DISTINCT ${CARD_COLS}
      FROM titles t
      JOIN user_state us ON us.title_id = t.id AND us.status = 'wishlist'
      JOIN availability a ON a.title_id = t.id AND a.active = 1 AND a.offer_type IN ('flatrate','free','ads')
      JOIN my_services m ON m.provider_id = a.provider_id AND m.enabled = 1
      ORDER BY us.updated_at DESC
      LIMIT 25
    `)
    .all() as CardRow[];
  return attachMyOffers(rows);
}

export function nowStreamingRow(): CardRow[] {
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = db()
    .prepare(`
      SELECT ${CARD_COLS}, MAX(ev.created_at) AS event_at
      FROM events ev
      JOIN titles t ON t.id = ev.title_id
      WHERE ev.type IN ('arrived_on_service','now_streaming') AND ev.created_at > ?
      GROUP BY t.id
      ORDER BY event_at DESC
      LIMIT 25
    `)
    .all(cutoff) as CardRow[];
  return attachMyOffers(rows);
}

export function recentlyWatched(): CardRow[] {
  const rows = db()
    .prepare(`
      SELECT * FROM (
        SELECT ${CARD_COLS}, MAX(e.watched_at) AS watched_at
        FROM titles t
        JOIN seasons s ON s.title_id = t.id
        JOIN episodes e ON e.season_id = s.id AND e.watched_at IS NOT NULL
        GROUP BY t.id
        UNION ALL
        SELECT ${CARD_COLS}, us.watched_at AS watched_at
        FROM titles t
        JOIN user_state us ON us.title_id = t.id
        WHERE t.media_type = 'movie' AND us.watched_at IS NOT NULL
      )
      ORDER BY watched_at DESC
      LIMIT 25
    `)
    .all() as CardRow[];
  return attachMyOffers(rows);
}

/** TMDB now_playing / upcoming lists from cache, flagged with library membership. */
export function theaterRows(): { inTheaters: unknown[]; comingSoon: unknown[] } {
  const region = getSetting('region');
  const map = (payload: unknown): unknown[] => {
    if (!Array.isArray(payload)) return [];
    const tmdbIds = payload.map((m) => (m as { id: number }).id);
    const inLib = new Map<number, number>();
    if (tmdbIds.length > 0) {
      const rows = db()
        .prepare(`SELECT id, tmdb_id FROM titles WHERE media_type = 'movie' AND tmdb_id IN (${tmdbIds.map(() => '?').join(',')})`)
        .all(...tmdbIds) as { id: number; tmdb_id: number }[];
      for (const r of rows) inLib.set(r.tmdb_id, r.id);
    }
    return payload.map((m) => {
      const e = m as Record<string, unknown>;
      return {
        tmdb_id: e.id,
        media_type: 'movie',
        name: e.title ?? e.name,
        poster_path: e.poster_path ?? null,
        release_date: e.release_date ?? null,
        tmdb_rating: e.vote_average ?? null,
        overview: e.overview ?? null,
        library_id: inLib.get(e.id as number) ?? null,
      };
    });
  };
  return {
    inTheaters: map(cacheGet(`tmdb_now_playing:${region}`, Infinity)?.payload ?? []),
    comingSoon: map(cacheGet(`tmdb_upcoming:${region}`, Infinity)?.payload ?? []),
  };
}

export function history(filter: { year?: number; type?: 'movie' | 'tv' }): { items: unknown[]; stats: unknown } {
  const items = db()
    .prepare(`
      SELECT * FROM (
        SELECT 'episode' AS kind, t.id AS title_id, t.name AS title_name, t.poster_path, t.media_type,
               s.season_number, e.episode_number, e.name AS episode_name, COALESCE(e.runtime, t.runtime) AS runtime, e.watched_at
        FROM episodes e
        JOIN seasons s ON e.season_id = s.id
        JOIN titles t ON s.title_id = t.id
        WHERE e.watched_at IS NOT NULL
        UNION ALL
        SELECT 'movie' AS kind, t.id AS title_id, t.name AS title_name, t.poster_path, t.media_type,
               NULL, NULL, NULL, t.runtime, us.watched_at
        FROM user_state us
        JOIN titles t ON us.title_id = t.id
        WHERE t.media_type = 'movie' AND us.watched_at IS NOT NULL
      )
      WHERE (:year IS NULL OR CAST(strftime('%Y', watched_at) AS INTEGER) = :year)
        AND (:type IS NULL OR media_type = :type)
      ORDER BY watched_at DESC
      LIMIT 500
    `)
    .all({ year: filter.year ?? null, type: filter.type ?? null });

  const monthStart = `${localToday().slice(0, 7)}-01`;
  const stats = db()
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM episodes WHERE watched_at IS NOT NULL) AS episodes_total,
        (SELECT COUNT(*) FROM episodes WHERE watched_at >= :monthStart) AS episodes_this_month,
        (SELECT COUNT(*) FROM user_state us JOIN titles t ON t.id = us.title_id WHERE t.media_type='movie' AND us.watched_at IS NOT NULL) AS movies_total,
        (SELECT COALESCE(SUM(COALESCE(e.runtime, t.runtime, 0)), 0)
           FROM episodes e JOIN seasons s ON e.season_id = s.id JOIN titles t ON s.title_id = t.id
           WHERE e.watched_at IS NOT NULL)
        + (SELECT COALESCE(SUM(COALESCE(t.runtime, 0)), 0)
           FROM user_state us JOIN titles t ON t.id = us.title_id
           WHERE t.media_type='movie' AND us.watched_at IS NOT NULL) AS minutes_total
    `)
    .get({ monthStart });

  return { items, stats };
}

/** Everything the detail page needs, in one payload. */
export function titleDetail(titleId: number): unknown | null {
  const d = db();
  const title = d
    .prepare(`
      SELECT t.*, us.status AS user_status, us.user_rating, us.notes, us.watched_at AS user_watched_at, us.updated_at AS state_updated_at
      FROM titles t LEFT JOIN user_state us ON us.title_id = t.id
      WHERE t.id = ?
    `)
    .get(titleId) as Record<string, unknown> | undefined;
  if (!title) return null;
  delete title.raw_tmdb;

  const seasons = d
    .prepare('SELECT * FROM seasons WHERE title_id = ? ORDER BY season_number')
    .all(titleId) as Record<string, unknown>[];
  const episodes = d
    .prepare('SELECT e.* FROM episodes e JOIN seasons s ON e.season_id = s.id WHERE s.title_id = ? ORDER BY s.season_number, e.episode_number')
    .all(titleId) as Record<string, unknown>[];
  const byId = new Map<number, Record<string, unknown>[]>();
  for (const ep of episodes) {
    const sid = ep.season_id as number;
    if (!byId.has(sid)) byId.set(sid, []);
    byId.get(sid)!.push(ep);
  }
  for (const s of seasons) s.episodes = byId.get(s.id as number) ?? [];

  const cast = d.prepare('SELECT * FROM cast_members WHERE title_id = ? ORDER BY ord').all(titleId);
  const availability = d
    .prepare('SELECT * FROM availability WHERE title_id = ? ORDER BY active DESC, offer_type, provider_name')
    .all(titleId);
  const events = d
    .prepare('SELECT * FROM events WHERE title_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(titleId);
  const myServices = d.prepare('SELECT provider_id FROM my_services WHERE enabled = 1').all() as { provider_id: number }[];

  // Next up: first unwatched aired episode; next upstream: first future episode.
  const today = localToday();
  const nextUnwatched = d
    .prepare(`
      SELECT e.id, e.name, e.episode_number, s.season_number, e.air_date
      FROM episodes e JOIN seasons s ON e.season_id = s.id
      WHERE s.title_id = ? AND s.season_number > 0 AND e.watched_at IS NULL AND e.air_date IS NOT NULL AND e.air_date <= ?
      ORDER BY s.season_number, e.episode_number LIMIT 1
    `)
    .get(titleId, today);
  const nextAiring = d
    .prepare(`
      SELECT e.id, e.name, e.episode_number, s.season_number, e.air_date
      FROM episodes e JOIN seasons s ON e.season_id = s.id
      WHERE s.title_id = ? AND s.season_number > 0 AND e.air_date > ?
      ORDER BY e.air_date, s.season_number, e.episode_number LIMIT 1
    `)
    .get(titleId, today);

  return {
    ...title,
    seasons,
    cast,
    availability,
    events,
    my_service_ids: myServices.map((m) => m.provider_id),
    next_unwatched: nextUnwatched ?? null,
    next_airing: nextAiring ?? null,
    region: getSetting('region'),
  };
}

export function libraryList(status?: string): CardRow[] {
  const where = status ? 'WHERE us.status = ?' : '';
  const rows = db()
    .prepare(`
      SELECT ${CARD_COLS}, us.status AS user_status, us.updated_at
      FROM titles t JOIN user_state us ON us.title_id = t.id
      ${where}
      ORDER BY us.updated_at DESC
    `)
    .all(...(status ? [status] : [])) as CardRow[];
  return attachMyOffers(rows);
}
