import { getDb } from '../db.js';
import { localToday, nowIso } from '../config.js';
import { getGenres, type MergedGenre } from './browse.js';

const DAY = 86400_000;

export interface PickConstraints {
  time: number | null; // minutes; null or >= 120 ("2h+" / "No limit") disables the budget filter
  type: 'episode' | 'movie' | 'either';
  genres: string[]; // merged genre keys (mood chips)
  my_services_only: boolean;
  include_rent_buy: boolean; // one-click loosening of the services filter
  unwatched_only: boolean;
  bingeable_only: boolean;
}

export interface PickOffer {
  name: string;
  offer_type: string;
}

export interface PickCandidate {
  title_id: number;
  media_type: 'movie' | 'tv';
  name: string;
  year: number | null;
  poster_path: string | null;
  kind: 'continue' | 'start' | 'rewatch';
  episode_id: number | null;
  season_number: number | null;
  episode_number: number | null;
  episode_name: string | null;
  runtime: number; // effective minutes measured against the budget
  runtime_estimated: boolean;
  fits_episodes: number | null; // >1 when several episodes fit the budget
  providers: PickOffer[]; // offers on enabled services (streaming first)
  rent_buy_only: boolean;
  reasons: string[];
}

export interface Loosen {
  label: string;
  patch: Partial<PickConstraints>;
}

export interface PickResult {
  candidate: PickCandidate | null;
  pool_size: number; // candidates surviving the filters (before session exclusions)
  exhausted?: boolean; // pool nonempty but every candidate was already shown this session
  empty?: { message: string; loosen: Loosen[] };
}

interface Cand {
  title_id: number;
  media_type: 'movie' | 'tv';
  name: string;
  year: number | null;
  poster_path: string | null;
  genres_raw: string;
  rt_score: number | null;
  imdb_rating: number | null;
  tmdb_rating: number | null;
  status: string;
  added_at: string;
  kind: 'continue' | 'start' | 'rewatch';
  episode_id: number | null;
  episode_name: string | null;
  season_number: number | null;
  episode_number: number | null;
  runtime: number;
  runtime_estimated: boolean;
  watched_count: number;
  season_remaining: number;
  last_watched: string | null;
  // filled in during scoring
  genres: string[];
  mood_matched: number;
  score: number;
}

function db() {
  return getDb();
}

const TITLE_COLS = `t.id AS title_id, t.media_type, t.name, t.year, t.poster_path, t.genres AS genres_raw,
  t.rt_score, t.imdb_rating, t.tmdb_rating, t.added_at, us.status`;

function parseGenres(raw: string): string[] {
  try {
    const g = JSON.parse(raw);
    return Array.isArray(g) ? g : [];
  } catch {
    return [];
  }
}

/** Episode-runtime fallback chain: episode → show average → show runtime → 30/45 by genre. */
function episodeRuntime(epRuntime: number | null, avg: number | null, show: number | null, genres: string[]): { minutes: number; estimated: boolean } {
  if (epRuntime) return { minutes: epRuntime, estimated: false };
  if (avg) return { minutes: Math.round(avg), estimated: true };
  if (show) return { minutes: show, estimated: true };
  const halfHour = genres.some((g) => g === 'Comedy' || g === 'Animation');
  return { minutes: halfHour ? 30 : 45, estimated: true };
}

// ---- pool construction (local SQL only) ----

/** Continue watching + start something: TV shows with a next unwatched aired episode. */
function tvPool(today: string): Cand[] {
  const rows = db()
    .prepare(`
      SELECT * FROM (
        SELECT ${TITLE_COLS}, t.runtime AS show_runtime,
               e.id AS episode_id, e.name AS episode_name, e.runtime AS episode_runtime,
               s.season_number, e.episode_number,
               ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY s.season_number, e.episode_number) AS rn,
               (SELECT COUNT(*) FROM episodes ew JOIN seasons sw ON ew.season_id = sw.id
                WHERE sw.title_id = t.id AND ew.watched_at IS NOT NULL) AS watched_count,
               (SELECT AVG(er.runtime) FROM episodes er JOIN seasons sr ON er.season_id = sr.id
                WHERE sr.title_id = t.id AND er.runtime IS NOT NULL) AS avg_ep_runtime,
               (SELECT COUNT(*) FROM episodes e2 WHERE e2.season_id = s.id
                AND e2.watched_at IS NULL AND e2.air_date IS NOT NULL AND e2.air_date <= :today) AS season_remaining
        FROM titles t
        JOIN user_state us ON us.title_id = t.id AND us.status IN ('watching','wishlist') AND us.never_suggest = 0
        JOIN seasons s ON s.title_id = t.id AND s.season_number > 0
        JOIN episodes e ON e.season_id = s.id AND e.watched_at IS NULL AND e.air_date IS NOT NULL AND e.air_date <= :today
        WHERE t.media_type = 'tv'
      ) WHERE rn = 1
    `)
    .all({ today }) as (Cand & { show_runtime: number | null; episode_runtime: number | null; avg_ep_runtime: number | null })[];
  return rows.map((r) => {
    const genres = parseGenres(r.genres_raw);
    const rt = episodeRuntime(r.episode_runtime, r.avg_ep_runtime, r.show_runtime, genres);
    return {
      ...r,
      kind: r.status === 'watching' ? 'continue' as const : 'start' as const,
      runtime: rt.minutes,
      runtime_estimated: rt.estimated,
      last_watched: null,
      genres,
      mood_matched: 0,
      score: 0,
    };
  });
}

/** Start something: wishlist / added-but-unstarted movies. */
function moviePool(): Cand[] {
  const rows = db()
    .prepare(`
      SELECT ${TITLE_COLS}, t.runtime AS movie_runtime
      FROM titles t
      JOIN user_state us ON us.title_id = t.id AND us.status IN ('wishlist','watching')
        AND us.watched_at IS NULL AND us.never_suggest = 0
      WHERE t.media_type = 'movie'
    `)
    .all() as (Cand & { movie_runtime: number | null })[];
  return rows.map((r) => ({
    ...r,
    kind: 'start' as const,
    episode_id: null,
    episode_name: null,
    season_number: null,
    episode_number: null,
    runtime: r.movie_runtime ?? 120,
    runtime_estimated: r.movie_runtime == null,
    watched_count: 0,
    season_remaining: 0,
    last_watched: null,
    genres: parseGenres(r.genres_raw),
    mood_matched: 0,
    score: 0,
  }));
}

/** Rewatch candidates: watched titles whose last watch is > 180 days old. */
function rewatchPool(today: string): Cand[] {
  const cutoff = new Date(Date.now() - 180 * DAY).toISOString();
  const movies = db()
    .prepare(`
      SELECT ${TITLE_COLS}, t.runtime AS movie_runtime, us.watched_at AS last_watched
      FROM titles t
      JOIN user_state us ON us.title_id = t.id AND us.status = 'watched' AND us.never_suggest = 0
      WHERE t.media_type = 'movie' AND us.watched_at IS NOT NULL AND us.watched_at < ?
    `)
    .all(cutoff) as (Cand & { movie_runtime: number | null })[];
  const shows = db()
    .prepare(`
      SELECT ${TITLE_COLS}, t.runtime AS show_runtime, MAX(e.watched_at) AS last_watched,
             (SELECT AVG(er.runtime) FROM episodes er JOIN seasons sr ON er.season_id = sr.id
              WHERE sr.title_id = t.id AND er.runtime IS NOT NULL) AS avg_ep_runtime,
             (SELECT e1.id FROM episodes e1 JOIN seasons s1 ON e1.season_id = s1.id
              WHERE s1.title_id = t.id AND s1.season_number > 0
              ORDER BY s1.season_number, e1.episode_number LIMIT 1) AS first_episode_id,
             (SELECT e1.name FROM episodes e1 JOIN seasons s1 ON e1.season_id = s1.id
              WHERE s1.title_id = t.id AND s1.season_number > 0
              ORDER BY s1.season_number, e1.episode_number LIMIT 1) AS first_episode_name,
             (SELECT e1.runtime FROM episodes e1 JOIN seasons s1 ON e1.season_id = s1.id
              WHERE s1.title_id = t.id AND s1.season_number > 0
              ORDER BY s1.season_number, e1.episode_number LIMIT 1) AS first_episode_runtime
      FROM titles t
      JOIN user_state us ON us.title_id = t.id AND us.status = 'watched' AND us.never_suggest = 0
      JOIN seasons s ON s.title_id = t.id AND s.season_number > 0
      JOIN episodes e ON e.season_id = s.id
      WHERE t.media_type = 'tv'
      GROUP BY t.id
      HAVING SUM(CASE WHEN e.watched_at IS NULL AND e.air_date IS NOT NULL AND e.air_date <= :today THEN 1 ELSE 0 END) = 0
        AND MAX(e.watched_at) IS NOT NULL AND MAX(e.watched_at) < :cutoff
    `)
    .all({ today, cutoff }) as (Cand & {
      show_runtime: number | null; avg_ep_runtime: number | null;
      first_episode_id: number | null; first_episode_name: string | null; first_episode_runtime: number | null;
    })[];

  return [
    ...movies.map((r) => ({
      ...r,
      kind: 'rewatch' as const,
      episode_id: null,
      episode_name: null,
      season_number: null,
      episode_number: null,
      runtime: r.movie_runtime ?? 120,
      runtime_estimated: r.movie_runtime == null,
      watched_count: 0,
      season_remaining: 0,
      genres: parseGenres(r.genres_raw),
      mood_matched: 0,
      score: 0,
    })),
    ...shows.map((r) => {
      const genres = parseGenres(r.genres_raw);
      const rt = episodeRuntime(r.first_episode_runtime, r.avg_ep_runtime, r.show_runtime, genres);
      return {
        ...r,
        kind: 'rewatch' as const,
        episode_id: r.first_episode_id,
        episode_name: r.first_episode_name,
        season_number: 1,
        episode_number: 1,
        runtime: rt.minutes,
        runtime_estimated: rt.estimated,
        watched_count: 0,
        season_remaining: 0,
        genres,
        mood_matched: 0,
        score: 0,
      };
    }),
  ];
}

// ---- local signals for filters and scoring ----

/** Active offers on enabled services, per title. */
function myOffers(): Map<number, PickOffer[]> {
  const rows = db()
    .prepare(`
      SELECT a.title_id, a.provider_name AS name, a.offer_type
      FROM availability a
      JOIN my_services m ON m.provider_id = a.provider_id AND m.enabled = 1
      WHERE a.active = 1
      ORDER BY CASE WHEN a.offer_type IN ('flatrate','free','ads') THEN 0 ELSE 1 END, a.provider_name
    `)
    .all() as (PickOffer & { title_id: number })[];
  const map = new Map<number, PickOffer[]>();
  for (const r of rows) {
    if (!map.has(r.title_id)) map.set(r.title_id, []);
    const list = map.get(r.title_id)!;
    if (!list.some((o) => o.name === r.name && o.offer_type === r.offer_type)) list.push({ name: r.name, offer_type: r.offer_type });
  }
  return map;
}

const STREAM_TYPES = new Set(['flatrate', 'free', 'ads']);

/** Titles that genuinely arrived on an enabled service in the last 30 days (initial_sync = 0). */
function recentArrivals(): Map<number, string> {
  const cutoff = new Date(Date.now() - 30 * DAY).toISOString();
  const rows = db()
    .prepare(`
      SELECT a.title_id, a.provider_name FROM availability a
      JOIN my_services m ON m.provider_id = a.provider_id AND m.enabled = 1
      WHERE a.active = 1 AND a.initial_sync = 0 AND a.offer_type IN ('flatrate','free','ads') AND a.first_seen >= ?
    `)
    .all(cutoff) as { title_id: number; provider_name: string }[];
  return new Map(rows.map((r) => [r.title_id, r.provider_name]));
}

/** Per-title suggestion history in the last 7 days: skipped weighs heavier than merely shown. */
function recentSuggestions(): Map<number, { skipped: boolean }> {
  const cutoff = new Date(Date.now() - 7 * DAY).toISOString();
  const rows = db()
    .prepare(`
      SELECT title_id, MAX(CASE WHEN action = 'skipped' THEN 1 ELSE 0 END) AS skipped
      FROM suggestion_log WHERE created_at >= ? GROUP BY title_id
    `)
    .all(cutoff) as { title_id: number; skipped: number }[];
  return new Map(rows.map((r) => [r.title_id, { skipped: r.skipped === 1 }]));
}

/** Shows with at least one fully aired season that still has unwatched episodes (CR-02 bingeable + unwatched). */
function bingeableUnwatchedIds(today: string): Set<number> {
  const rows = db()
    .prepare(`
      SELECT DISTINCT s.title_id FROM seasons s
      WHERE s.title_id IN (SELECT title_id FROM bingeable_titles)
        AND s.season_number > 0
        AND EXISTS (SELECT 1 FROM episodes e WHERE e.season_id = s.id AND e.watched_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.season_id = s.id AND (e.air_date IS NULL OR e.air_date > ?))
    `)
    .all(today) as { title_id: number }[];
  return new Set(rows.map((r) => r.title_id));
}

// ---- mood (genre) matching ----

interface MoodChip {
  key: string;
  names: string[]; // TMDB genre names for the merged key; empty = fall back to key-pattern match
}

async function resolveMood(keys: string[]): Promise<MoodChip[]> {
  if (keys.length === 0) return [];
  // Offline with a cold genre cache: match the key loosely against the stored
  // genre names, mirroring libraryGrid's LIKE fallback.
  const genres = await getGenres().catch(() => [] as MergedGenre[]);
  return keys.map((key) => ({ key, names: genres.find((g) => g.key === key)?.names ?? [] }));
}

function chipMatches(chip: MoodChip, cand: Cand): boolean {
  if (chip.names.length > 0) return chip.names.some((n) => cand.genres.includes(n));
  return new RegExp(chip.key.split('-').join('.*'), 'i').test(cand.genres_raw);
}

// ---- scoring & selection ----

function monthsAgo(iso: string): number {
  return Math.max(1, Math.round((Date.now() - Date.parse(iso)) / (30 * DAY)));
}

function bestRating(c: Cand): number | null {
  if (c.rt_score != null) return c.rt_score / 10;
  return c.imdb_rating ?? c.tmdb_rating;
}

function scoreCandidate(
  c: Cand,
  moodCount: number,
  arrivals: Map<number, string>,
  suggested: Map<number, { skipped: boolean }>,
): number {
  const best = bestRating(c); // 0-10 scale
  let score = best != null ? Math.min(Math.max(best / 10, 0), 1) : 0.5; // unrated stays reachable, not favored
  if (c.kind === 'continue' && c.watched_count > 0) score += 0.3;
  if (arrivals.has(c.title_id)) score += 0.2;
  if (c.status === 'wishlist' && Date.now() - Date.parse(c.added_at) > 90 * DAY) score += 0.15;
  if (moodCount > 0) score += 0.1 * (c.mood_matched / moodCount);
  const hist = suggested.get(c.title_id);
  if (hist) score -= hist.skipped ? 0.5 : 0.25;
  return Math.max(score, 0.05);
}

// Temperature tuned so a +0.30 score edge is ~4-5x more likely, keeping roughly
// the top third of the pool realistically reachable while nothing is impossible.
const TEMPERATURE = 0.2;

function softmaxDraw(pool: Cand[]): Cand {
  const weights = pool.map((c) => Math.exp(c.score / TEMPERATURE));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// ---- card assembly ----

function buildReasons(
  c: Cand,
  offers: PickOffer[],
  moodChips: MoodChip[],
  arrivals: Map<number, string>,
): string[] {
  const reasons: string[] = [];
  if (c.rt_score != null) reasons.push(`${c.rt_score}% RT`);
  else if (c.imdb_rating != null) reasons.push(`${c.imdb_rating} IMDb`);
  else if (c.tmdb_rating != null) reasons.push(`${c.tmdb_rating.toFixed(1)} TMDB`);

  const arrival = arrivals.get(c.title_id);
  const streaming = offers.filter((o) => STREAM_TYPES.has(o.offer_type));
  if (arrival) reasons.push(`Just landed on ${arrival}`);
  else if (streaming.length > 0) reasons.push(`On ${streaming[0].name}`);
  else if (offers.length > 0) reasons.push(`Rent/buy on ${offers[0].name}`);

  if (c.kind === 'continue' && c.watched_count > 0) {
    if (c.season_remaining === 1) reasons.push(`Last episode of S${c.season_number}`);
    else if (c.episode_number === 1) reasons.push(`Start S${c.season_number}`);
    else reasons.push(`You're ${c.season_remaining} episodes from finishing S${c.season_number}`);
  } else if (c.kind === 'start' && c.status === 'wishlist') {
    const m = monthsAgo(c.added_at);
    if (m >= 3) reasons.push(`On your wishlist for ${m} months`);
  } else if (c.kind === 'rewatch' && c.last_watched) {
    reasons.push(`You watched this ${monthsAgo(c.last_watched)} months ago`);
  }

  if (moodChips.length > 0 && c.mood_matched === moodChips.length) {
    reasons.push('Matches your mood');
  }
  return reasons;
}

function toCard(c: Cand, offers: PickOffer[], moodChips: MoodChip[], arrivals: Map<number, string>, budget: number | null): PickCandidate {
  const streaming = offers.some((o) => STREAM_TYPES.has(o.offer_type));
  return {
    title_id: c.title_id,
    media_type: c.media_type,
    name: c.name,
    year: c.year,
    poster_path: c.poster_path,
    kind: c.kind,
    episode_id: c.episode_id,
    season_number: c.season_number,
    episode_number: c.episode_number,
    episode_name: c.episode_name,
    runtime: c.runtime,
    runtime_estimated: c.runtime_estimated,
    fits_episodes:
      c.media_type === 'tv' && budget != null && budget < 120 && c.runtime > 0 && Math.floor(budget / c.runtime) > 1
        ? Math.min(Math.floor(budget / c.runtime), c.season_remaining || 1)
        : null,
    providers: offers,
    rent_buy_only: offers.length > 0 && !streaming,
    reasons: buildReasons(c, offers, moodChips, arrivals),
  };
}

// ---- the main entry point ----

const TIME_STEPS = [30, 45, 60, 90];

export async function pickNext(c: PickConstraints, exclude: number[]): Promise<PickResult> {
  const today = localToday();
  const offers = myOffers();
  const arrivals = recentArrivals();
  const suggested = recentSuggestions();
  const moodChips = await resolveMood(c.genres);

  // Pool: continue watching + start something (+ rewatches when allowed).
  let pool: Cand[] = [...tvPool(today), ...moviePool()];
  if (!c.unwatched_only) pool.push(...rewatchPool(today));

  const empty = (message: string, loosen: Loosen[]): PickResult => ({ candidate: null, pool_size: 0, empty: { message, loosen } });

  if (pool.length === 0) {
    return empty(
      'Your library has nothing to suggest — everything is watched, dropped, or not out yet.',
      c.unwatched_only ? [{ label: 'Include rewatches', patch: { unwatched_only: false } }] : [],
    );
  }

  // Constraint filters, applied one at a time so an empty result can name the
  // exact constraint that eliminated everything.
  if (c.type !== 'either') {
    const mt = c.type === 'movie' ? 'movie' : 'tv';
    pool = pool.filter((x) => x.media_type === mt);
    if (pool.length === 0) {
      return empty(
        c.type === 'movie' ? 'No movies to suggest right now.' : 'No episodes to suggest right now.',
        [{ label: 'Movies & episodes', patch: { type: 'either' } }],
      );
    }
  }

  if (moodChips.length > 0) {
    for (const x of pool) x.mood_matched = moodChips.filter((chip) => chipMatches(chip, x)).length;
    pool = pool.filter((x) => x.mood_matched > 0);
    if (pool.length === 0) {
      return empty('Nothing in your library matches that mood.', [{ label: 'Any mood', patch: { genres: [] } }]);
    }
  }

  if (c.my_services_only) {
    const allowed = c.include_rent_buy
      ? () => true
      : (o: PickOffer) => STREAM_TYPES.has(o.offer_type);
    const hasServices = (db().prepare('SELECT COUNT(*) AS n FROM my_services WHERE enabled = 1').get() as { n: number }).n > 0;
    pool = pool.filter((x) => (offers.get(x.title_id) ?? []).some(allowed));
    if (pool.length === 0) {
      if (!hasServices) {
        return empty('You haven’t picked any streaming services in Settings, so nothing passes "on my services".', [
          { label: 'Any service', patch: { my_services_only: false } },
        ]);
      }
      return empty(
        c.include_rent_buy ? 'Nothing is available on your services, even to rent or buy.' : 'Nothing streams on your services right now.',
        [
          ...(c.include_rent_buy ? [] : [{ label: 'Include rent/buy', patch: { include_rent_buy: true } as Partial<PickConstraints> }]),
          { label: 'Any service', patch: { my_services_only: false } },
        ],
      );
    }
  }

  const budget = c.time != null && c.time < 120 ? c.time : null;
  if (budget != null) {
    pool = pool.filter((x) => x.runtime <= budget);
    if (pool.length === 0) {
      const next = TIME_STEPS.find((t) => t > budget);
      const where = c.my_services_only ? ' on your services' : '';
      return empty(`Nothing under ${budget} min${where}.`, [
        ...(next ? [{ label: `Try ${next} min`, patch: { time: next } as Partial<PickConstraints> }] : []),
        { label: 'No time limit', patch: { time: null } },
        ...(c.my_services_only && !c.include_rent_buy
          ? [{ label: 'Include rent/buy', patch: { include_rent_buy: true } as Partial<PickConstraints> }]
          : []),
      ]);
    }
  }

  if (c.bingeable_only) {
    const bingeable = bingeableUnwatchedIds(today);
    pool = pool.filter((x) => x.media_type === 'tv' && bingeable.has(x.title_id));
    if (pool.length === 0) {
      return empty('No show has a fully aired season left to binge under these filters.', [
        { label: 'Not just bingeable', patch: { bingeable_only: false } },
      ]);
    }
  }

  const poolSize = pool.length;
  const seen = new Set(exclude);
  const drawable = pool.filter((x) => !seen.has(x.title_id));
  if (drawable.length === 0) {
    return { candidate: null, pool_size: poolSize, exhausted: true };
  }

  for (const x of drawable) x.score = scoreCandidate(x, moodChips.length, arrivals, suggested);
  const picked = softmaxDraw(drawable);
  return {
    candidate: toCard(picked, offers.get(picked.title_id) ?? [], moodChips, arrivals, budget),
    pool_size: poolSize,
  };
}

// ---- suggestion log ----

export function logSuggestion(titleId: number, episodeId: number | null, action: 'accepted' | 'shuffled' | 'skipped', constraints: unknown): void {
  db()
    .prepare('INSERT INTO suggestion_log (title_id, episode_id, action, constraints, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(titleId, episodeId, action, JSON.stringify(constraints ?? {}), nowIso());
}
