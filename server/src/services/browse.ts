import { getDb, getSetting, cacheGet, cacheSet } from '../db.js';
import { nowIso, localToday } from '../config.js';
import { singleFlight } from '../singleFlight.js';
import * as tmdb from '../sources/tmdb.js';
import { discoveryProviderIds, enrichCardsWithOffers, type WatchOffer } from './providers.js';
import { adaptationIds, englishVersion, knownEnglish, loadEnglishVersions, versionMatchesParams, type EnglishVersion } from './englishVersions.js';

const DAY = 86400_000;
const WEEK = 7 * DAY;

// ---- shared card shape ----

export interface BrowseCard {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  name: string;
  year: number | null;
  date: string | null; // release date (movie) / first air date (tv)
  poster_path: string | null;
  tmdb_rating: number | null;
  popularity: number | null;
  overview: string | null;
  library_id: number | null;
  user_status: string | null;
  offers?: WatchOffer[];
  english_version?: EnglishVersion;
}

function toCard(e: tmdb.ListEntry, mediaType: 'movie' | 'tv'): BrowseCard {
  const date = (mediaType === 'movie' ? e.release_date : e.first_air_date) ?? null;
  const year = date ? Number(date.slice(0, 4)) || null : null;
  return {
    tmdb_id: e.id,
    media_type: mediaType,
    name: (mediaType === 'movie' ? e.title : e.name) ?? '(untitled)',
    year,
    date,
    poster_path: e.poster_path ?? null,
    tmdb_rating: e.vote_average ?? null,
    popularity: e.popularity ?? null,
    overview: e.overview ?? null,
    library_id: null,
    user_status: null,
    english_version: englishVersion(mediaType, e.id, e.original_language),
  };
}

/** Mark cards already in the library (membership is read live, never cached). */
function attachLibrary(cards: BrowseCard[]): BrowseCard[] {
  if (cards.length === 0) return cards;
  const db = getDb();
  for (const mt of ['movie', 'tv'] as const) {
    const ids = cards.filter((c) => c.media_type === mt).map((c) => c.tmdb_id);
    if (ids.length === 0) continue;
    const rows = db
      .prepare(`
        SELECT t.id, t.tmdb_id, us.status FROM titles t
        JOIN user_state us ON us.title_id = t.id
        WHERE t.media_type = ? AND t.tmdb_id IN (${ids.map(() => '?').join(',')})
      `)
      .all(mt, ...ids) as { id: number; tmdb_id: number; status: string | null }[];
    const byTmdb = new Map(rows.map((r) => [r.tmdb_id, r]));
    for (const c of cards) {
      if (c.media_type !== mt) continue;
      const hit = byTmdb.get(c.tmdb_id);
      if (hit) {
        c.library_id = hit.id;
        c.user_status = hit.status;
      }
    }
  }
  return cards;
}

// ---- stale-while-revalidate fetch through api_cache ----

async function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<{ payload: T; stale: boolean }> {
  const cached = cacheGet(key, ttlMs);
  if (cached?.fresh) return { payload: cached.payload as T, stale: false };
  return singleFlight(key, async () => {
    try {
      const fresh = await fetcher();
      cacheSet(key, fresh);
      return { payload: fresh, stale: false };
    } catch (err) {
      if (cached) return { payload: cached.payload as T, stale: true }; // offline: degrade to stale cache
      throw err;
    }
  });
}

/** Remember a Discover query so the daily sync re-warms page 1 for 7 days. */
function recordQuery(key: string, kind: 'genre-row' | 'grid', payload: unknown): void {
  getDb()
    .prepare(`
      INSERT INTO discover_queries (key, kind, payload, last_used) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET last_used = excluded.last_used, payload = excluded.payload
    `)
    .run(key, kind, JSON.stringify(payload), nowIso());
}

function stableParams(params: Record<string, string>): string {
  return Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
}

// ---- merged genres ----

export interface MergedGenre {
  key: string;
  name: string;
  movie_ids: number[];
  tv_ids: number[];
  names: string[]; // original TMDB genre names, for matching titles.genres json
  original_language?: string;
  description?: string;
}

// TMDB movie and TV genre lists mostly overlap by name; these cross-type
// near-equivalents get merged under one key so "Action" spans both.
const GENRE_ALIASES: Record<string, { key: string; name: string }> = {
  'action': { key: 'action', name: 'Action' },
  'action & adventure': { key: 'action', name: 'Action' },
  'science fiction': { key: 'sci-fi-fantasy', name: 'Sci-Fi & Fantasy' },
  'fantasy': { key: 'sci-fi-fantasy', name: 'Sci-Fi & Fantasy' },
  'sci-fi & fantasy': { key: 'sci-fi-fantasy', name: 'Sci-Fi & Fantasy' },
  'war': { key: 'war', name: 'War' },
  'war & politics': { key: 'war', name: 'War' },
};

const GENRE_PRIORITY = ['Drama', 'Korean Dramas', 'Comedy', 'Action', 'Sci-Fi & Fantasy', 'Thriller', 'Crime', 'Documentary', 'Animation', 'Anime', 'Horror', 'Romance'];

const SPECIAL_GENRES: MergedGenre[] = [
  {
    key: 'korean-drama', name: 'Korean Dramas', movie_ids: [], tv_ids: [18], names: ['Drama'],
    original_language: 'ko', description: 'Korean-language TV dramas',
  },
  {
    key: 'anime', name: 'Anime', movie_ids: [16], tv_ids: [16], names: ['Animation'],
    original_language: 'ja', description: 'Japanese-language animated movies and TV shows',
  },
];

/** Separate language-specific branches preserve OR matching across selected genres. */
export function genreDiscoverParams(mt: 'movie' | 'tv', keys: string[], genres: MergedGenre[]): Record<string, string>[] {
  if (keys.length === 0) return [{}];
  const side = mt === 'movie' ? 'movie_ids' : 'tv_ids';
  const selected = genres.filter((g) => keys.includes(g.key) && g[side].length > 0);
  const ids = [...new Set(selected.filter((g) => !g.original_language).flatMap((g) => g[side]))];
  const params: Record<string, string>[] = ids.length ? [{ with_genres: ids.join('|') }] : [];
  for (const g of selected.filter((g) => g.original_language)) {
    params.push({ with_genres: g[side].join('|'), with_original_language: g.original_language! });
  }
  return params;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function getGenres(): Promise<MergedGenre[]> {
  const r = await cachedFetch('tmdb_genres_merged', WEEK, async () => {
    const [movie, tv] = await Promise.all([tmdb.genreList('movie'), tmdb.genreList('tv')]);
    const merged = new Map<string, MergedGenre>();
    const add = (g: tmdb.GenreEntry, side: 'movie_ids' | 'tv_ids') => {
      const canon = GENRE_ALIASES[g.name.toLowerCase()] ?? { key: slugify(g.name), name: g.name };
      let entry = merged.get(canon.key);
      if (!entry) {
        entry = { key: canon.key, name: canon.name, movie_ids: [], tv_ids: [], names: [] };
        merged.set(canon.key, entry);
      }
      entry[side].push(g.id);
      if (!entry.names.includes(g.name)) entry.names.push(g.name);
    };
    for (const g of movie) add(g, 'movie_ids');
    for (const g of tv) add(g, 'tv_ids');
    return [...merged.values()];
  });
  // Add local categories after reading the cache so upgrades expose them immediately.
  return [...r.payload.filter((g) => !SPECIAL_GENRES.some((s) => s.key === g.key)), ...SPECIAL_GENRES].sort((a, b) => {
    const pa = GENRE_PRIORITY.indexOf(a.name);
    const pb = GENRE_PRIORITY.indexOf(b.name);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return a.name.localeCompare(b.name);
  });
}

// ---- genre rows (Discover default view) ----

async function buildGenreRowItems(g: MergedGenre): Promise<BrowseCard[]> {
  const cards: BrowseCard[] = [];
  // vote_count floor keeps obscure junk out of popularity rows.
  for (const mt of ['movie', 'tv'] as const) {
    for (const params of genreDiscoverParams(mt, [g.key], [g])) {
      const page = await tmdb.discover(mt, { ...params, sort_by: 'popularity.desc', 'vote_count.gte': '50' });
      cards.push(...page.results.map((e) => toCard(e, mt)));
    }
  }
  cards.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  return cards.slice(0, 20);
}

export async function genreRow(key: string): Promise<{ items: BrowseCard[]; stale: boolean } | null> {
  const genres = await getGenres();
  const g = genres.find((x) => x.key === key);
  if (!g) return null;
  const cacheKey = `browse_genre_row:${key}`;
  const r = await cachedFetch(cacheKey, DAY, () => buildGenreRowItems(g));
  recordQuery(cacheKey, 'genre-row', { key });
  const cards = attachLibrary(structuredClone(r.payload));
  return {
    items: await enrichCardsWithOffers(cards, { myServicesOnly: false, includeRentBuy: false }),
    stale: r.stale,
  };
}

// ---- Discover grid ----

export interface BrowseFilters {
  type: 'movie' | 'tv' | 'both';
  genres: string[]; // merged genre keys
  watch: 'any' | 'my' | 'streaming' | 'broadcast';
  excludedProviders?: number[];
  status: '' | 'returning' | 'ended' | 'canceled';
  library: '' | 'not_added' | 'saved' | 'wishlist' | 'watching' | 'watched' | 'dropped';
  yearMin: number | null;
  yearMax: number | null;
  rating: number | null;
  bingeable: boolean;
  preferEnglish?: boolean;
  includeAdaptations?: boolean;
  sort: 'newest' | 'rating' | 'popular' | 'az' | 'added' | 'watched';
}

const TV_STATUS_PARAM = { returning: '0', ended: '3', canceled: '4' } as const;

/** TMDB query branches for one media type, empty when this type cannot match. */
async function buildDiscoverParams(mt: 'movie' | 'tv', f: BrowseFilters, genres: MergedGenre[]): Promise<Record<string, string>[]> {
  const p: Record<string, string> = {};
  const region = getSetting('region');

  const prov = await discoveryProviderIds(f.excludedProviders ?? [], f.watch === 'my');
  if (prov?.length === 0) return [];
  if (prov) {
    p.with_watch_providers = prov.join('|');
    p.watch_region = region;
    p.with_watch_monetization_types = 'flatrate|free|ads';
  } else if (f.watch === 'streaming') {
    p.watch_region = region;
    p.with_watch_monetization_types = 'flatrate|free|ads';
  }
  if (f.watch === 'broadcast') {
    if (mt !== 'tv') return [];
    const networks = getSetting('broadcast_networks').split(/[|,\s]+/).filter(Boolean);
    if (networks.length === 0) return [];
    p.with_networks = networks.join('|');
  }

  if (f.status) {
    if (mt !== 'tv') return []; // series status is TV-only
    p.with_status = TV_STATUS_PARAM[f.status];
  }

  const dateKey = mt === 'movie' ? 'primary_release_date' : 'first_air_date';
  if (f.yearMin) p[`${dateKey}.gte`] = `${f.yearMin}-01-01`;
  const today = localToday();
  let lte = f.yearMax ? `${f.yearMax}-12-31` : null;
  // "Newest" caps at today so unreleased announcements don't lead the grid.
  if (f.sort === 'newest') lte = lte && lte < today ? lte : today;
  if (lte) p[`${dateKey}.lte`] = lte;

  if (f.rating) {
    p['vote_average.gte'] = String(f.rating);
    p['vote_count.gte'] = '200'; // suppress junk with 3 perfect votes
  }

  p.sort_by =
    f.sort === 'newest' ? `${dateKey}.desc`
    : f.sort === 'rating' ? 'vote_average.desc'
    : f.sort === 'az' ? (mt === 'movie' ? 'original_title.asc' : 'name.asc')
    : 'popularity.desc';
  if (f.sort === 'rating') p['vote_count.gte'] = '200';

  return genreDiscoverParams(mt, f.genres, genres).map((params) => ({ ...p, ...params }));
}

function sortCards(cards: BrowseCard[], sort: BrowseFilters['sort']): BrowseCard[] {
  const cmp: (a: BrowseCard, b: BrowseCard) => number =
    sort === 'newest' ? (a, b) => (b.date ?? '').localeCompare(a.date ?? '')
    : sort === 'rating' ? (a, b) => (b.tmdb_rating ?? 0) - (a.tmdb_rating ?? 0)
    : sort === 'az' ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0);
  return cards.sort(cmp);
}

export interface GridResult {
  items: BrowseCard[];
  page: number;
  total_pages: number;
  stale: boolean;
  notice?: string;
}

/**
 * One page of the Discover grid. type=both fetches both endpoints for the same
 * page number and interleaves by the active sort key, so a merged Movies+TV
 * grid orders by date/rating/popularity, not grouped by type.
 * "Bingeable" is intentionally NOT supported here: Discover has no per-episode
 * air-date filter, so the chip only exists in Library scope.
 */
export async function discoverGrid(f: BrowseFilters, page: number): Promise<GridResult> {
  const genres = await getGenres();
  const types: ('movie' | 'tv')[] = f.type === 'both' ? ['movie', 'tv'] : [f.type];

  let cards: BrowseCard[] = [];
  let totalPages = 0;
  let stale = false;
  for (const mt of types) {
    for (const params of await buildDiscoverParams(mt, f, genres)) {
      const key = `browse_grid:${mt}:p${page}:${stableParams(params)}`;
      const r = await cachedFetch(key, DAY, () => tmdb.discover(mt, { ...params, page: String(page) }));
      if (page === 1) recordQuery(key, 'grid', { mediaType: mt, params });
      stale ||= r.stale;
      cards.push(...r.payload.results.map((e) => toCard(e, mt)));
      totalPages = Math.max(totalPages, r.payload.total_pages);
    }
  }

  const supplements = new Set<string>();
  let notice: string | undefined;
  if (page === 1 && f.includeAdaptations) {
    const versions = await loadEnglishVersions(f.genres, types, true);
    if (versions.incomplete) notice = 'Some English-version details could not be refreshed. Results may be incomplete or use cached details.';
    for (const version of versions.entries) {
      const params = (await buildDiscoverParams(version.media_type, { ...f, genres: [] }, genres))[0];
      if (!params || !versionMatchesParams(version, params)) continue;
      const key = `${version.media_type}:${version.entry.id}`;
      if (cards.some((card) => `${card.media_type}:${card.tmdb_id}` === key)) continue;
      cards.push(toCard(version.entry, version.media_type));
      supplements.add(key);
    }
  }

  cards = [...new Map(cards.map((c) => [`${c.media_type}:${c.tmdb_id}`, c])).values()];
  attachLibrary(cards);
  if (f.library === 'not_added') cards = cards.filter((c) => c.library_id === null);
  else if (f.library) cards = cards.filter((c) => c.user_status === f.library);

  const sorted = sortCards(cards, f.sort);
  let items = await enrichCardsWithOffers(sorted, {
    myServicesOnly: f.watch === 'my',
    includeRentBuy: false,
    excludedProviderIds: f.excludedProviders,
  });
  // Verify actual offers too, including supplemental adaptations and stale Discover matches.
  if (items.some((card) => card.availability_check.status === 'unavailable')) {
    notice = [notice, 'Some availability checks failed. Results may be incomplete; try refreshing availability.'].filter(Boolean).join(' ');
  }
  if (items.some((card) => card.availability_check.status === 'stale')) {
    notice = [notice, 'Some service offers are cached and may have changed.'].filter(Boolean).join(' ');
  }
  if (f.excludedProviders?.length) items = items.filter((card) => card.offers.length > 0);
  // Provider restrictions for explicit catalog titles cannot be delegated to Discover.
  if (f.watch === 'my' || f.watch === 'streaming') {
    items = items.filter((card) => !supplements.has(`${card.media_type}:${card.tmdb_id}`) || card.offers.length > 0);
  }
  if (f.preferEnglish) {
    items.sort((a, b) => Number(knownEnglish(b.english_version)) - Number(knownEnglish(a.english_version)));
  }
  if (items.length > 0) totalPages = Math.max(totalPages, 1);
  return { items, page, total_pages: Math.min(totalPages, 500), stale, notice };
}

export async function similarTitles(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): Promise<{ items: BrowseCard[]; stale: boolean }> {
  const key = `tmdb_similar:${mediaType}:${tmdbId}`;
  const result = await cachedFetch(key, DAY, () => tmdb.similar(mediaType, tmdbId));
  const cards = attachLibrary(
    result.payload.results
      .filter((entry) => entry.id !== tmdbId)
      .map((entry) => toCard(entry, mediaType))
      .slice(0, 20),
  );
  return {
    items: await enrichCardsWithOffers(cards, { myServicesOnly: false, includeRentBuy: false }),
    stale: result.stale,
  };
}

// ---- Library grid (local SQL; instant, offline) ----

const BEST_RATING = 'COALESCE(t.rt_score / 10.0, t.imdb_rating, t.tmdb_rating)';

export async function libraryGrid(f: BrowseFilters): Promise<BrowseCard[]> {
  const db = getDb();
  const where: string[] = [];
  const args: unknown[] = [];

  if (f.type !== 'both') {
    where.push('t.media_type = ?');
    args.push(f.type);
  }

  if (f.genres.length > 0) {
    // Match against the stored TMDB genre-name json; resolve merged keys to
    // their member names. Offline with a cold genre cache, fall back to a
    // loose LIKE built from the key itself.
    const genres = await getGenres().catch(() => SPECIAL_GENRES);
    const clauses = f.genres.map((k) => {
      const genre = genres.find((g) => g.key === k);
      const patterns = genre?.names.length ? genre.names.map((n) => `%"${n}"%`) : [`%${k.replace(/-/g, '%')}%`];
      let clause = `(${patterns.map(() => 't.genres LIKE ?').join(' OR ')})`;
      args.push(...patterns);
      if (genre?.original_language) {
        clause += ' AND t.original_language = ?';
        args.push(genre.original_language);
        if (genre.movie_ids.length === 0) clause += " AND t.media_type = 'tv'";
      }
      if (f.includeAdaptations) {
        const adaptations = (['movie', 'tv'] as const).flatMap((mt) => {
          const ids = adaptationIds(k, mt);
          if (ids.length === 0) return [];
          args.push(mt, ...ids);
          return [`(t.media_type = ? AND t.tmdb_id IN (${ids.map(() => '?').join(',')}))`];
        });
        if (adaptations.length) clause = `(${clause}) OR ${adaptations.join(' OR ')}`;
      }
      return `(${clause})`;
    });
    where.push(`(${clauses.join(' OR ')})`);
  }

  if (f.watch === 'my' || f.watch === 'streaming' || f.excludedProviders?.length) {
    where.push(`EXISTS (
      SELECT 1 FROM availability a
      ${f.watch === 'my' ? 'JOIN my_services m ON m.provider_id = a.provider_id AND m.enabled = 1' : ''}
      WHERE a.title_id = t.id AND a.active = 1 AND a.region = ? AND a.offer_type IN ('flatrate','free','ads')
      ${f.excludedProviders?.length ? `AND a.provider_id NOT IN (${f.excludedProviders.map(() => '?').join(',')})` : ''})`);
    args.push(getSetting('region'), ...(f.excludedProviders ?? []));
  }
  // watch === 'broadcast' is ignored here: networks aren't stored locally, so
  // the option is hidden in Library scope on the client.

  if (f.status) {
    const map = { returning: 'Returning Series', ended: 'Ended', canceled: 'Canceled' } as const;
    where.push("t.media_type = 'tv' AND t.status_upstream = ?");
    args.push(map[f.status]);
  }

  if (f.bingeable) {
    where.push('t.id IN (SELECT title_id FROM bingeable_titles)');
  }

  if (f.library && f.library !== 'not_added') {
    where.push('us.status = ?');
    args.push(f.library);
  }

  if (f.yearMin) {
    where.push('t.year >= ?');
    args.push(f.yearMin);
  }
  if (f.yearMax) {
    where.push('t.year <= ?');
    args.push(f.yearMax);
  }
  if (f.rating) {
    where.push(`${BEST_RATING} >= ?`);
    args.push(f.rating);
  }

  const lastWatched = `COALESCE(us.watched_at,
    (SELECT MAX(e.watched_at) FROM episodes e JOIN seasons s ON e.season_id = s.id WHERE s.title_id = t.id))`;
  const orderBy =
    f.sort === 'az' ? 't.name COLLATE NOCASE ASC'
    : f.sort === 'added' ? 't.added_at DESC'
    : f.sort === 'watched' ? `${lastWatched} DESC NULLS LAST`
    : f.sort === 'newest' ? 't.year DESC NULLS LAST, t.name COLLATE NOCASE ASC'
    : `${BEST_RATING} DESC NULLS LAST`; // rating; 'popular' has no local signal, falls back to rating per spec

  const rows = db
    .prepare(`
      SELECT t.id AS library_id, t.tmdb_id, t.media_type, t.name, t.year, t.poster_path,
             t.tmdb_rating, t.overview, t.original_language, us.status AS user_status
      FROM titles t
      JOIN user_state us ON us.title_id = t.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
    `)
    .all(...args) as (Omit<BrowseCard, 'date' | 'popularity'> & { original_language: string | null })[];

  const cards = rows.map((r) => ({ ...r, date: r.year ? String(r.year) : null, popularity: null,
    english_version: englishVersion(r.media_type, r.tmdb_id, r.original_language) }));
  if (f.preferEnglish) cards.sort((a, b) => Number(knownEnglish(b.english_version)) - Number(knownEnglish(a.english_version)));
  return cards;
}

// ---- daily sync hook ----

/** Re-warm merged genres plus page 1 of every Discover query used in the last 7 days. */
export async function refreshBrowseCaches(): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - WEEK).toISOString();
  db.prepare('DELETE FROM api_cache WHERE key IN (SELECT key FROM discover_queries WHERE last_used < ?)').run(cutoff);
  db.prepare('DELETE FROM discover_queries WHERE last_used < ?').run(cutoff);

  const genres = await getGenres();
  const recent = db.prepare('SELECT key, kind, payload FROM discover_queries WHERE last_used >= ?').all(cutoff) as
    { key: string; kind: string; payload: string }[];
  for (const row of recent) {
    try {
      const payload = JSON.parse(row.payload) as { key?: string; mediaType?: 'movie' | 'tv'; params?: Record<string, string> };
      if (row.kind === 'genre-row' && payload.key) {
        const g = genres.find((x) => x.key === payload.key);
        if (g) cacheSet(row.key, await buildGenreRowItems(g));
      } else if (row.kind === 'grid' && payload.mediaType && payload.params) {
        cacheSet(row.key, await tmdb.discover(payload.mediaType, { ...payload.params, page: '1' }));
      }
    } catch (err) {
      console.warn(`[browse] refresh of ${row.key} failed:`, (err as Error).message);
    }
  }
}
