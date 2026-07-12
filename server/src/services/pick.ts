import { cacheGet, cacheSet, getDb, getSetting } from '../db.js';
import { localToday, nowIso } from '../config.js';
import * as tmdb from '../sources/tmdb.js';
import { enabledServiceIds } from './availability.js';
import { getGenres, type MergedGenre } from './browse.js';
import { offersForTitle, type WatchOffer } from './providers.js';

const DAY = 86400_000;
const STREAM_TYPES = new Set<WatchOffer['offer_type']>(['flatrate', 'free', 'ads']);
const TEMPERATURE = 0.2;
const REPEAT_COOLDOWN_DAYS = 7;
const HISTORY_PENALTY_DAYS = 30;

export interface PickConstraints {
  time: number | null;
  type: 'tv' | 'movie' | 'either';
  genres: string[];
  my_services_only: boolean;
  include_rent_buy: boolean;
  exclude_library_titles: boolean;
}

export type PickSource = 'new_release' | 'airing_now' | 'popular';

export interface PickCandidate {
  key: string;
  tmdb_id: number;
  library_id: number | null;
  media_type: 'movie' | 'tv';
  name: string;
  year: number | null;
  poster_path: string | null;
  source: PickSource;
  runtime: number;
  runtime_estimated: boolean;
  providers: WatchOffer[];
  rent_buy_only: boolean;
  reasons: string[];
}

export interface Loosen {
  label: string;
  patch: Partial<PickConstraints>;
}

export interface PickResult {
  candidate: PickCandidate | null;
  pool_size: number;
  exhausted?: boolean;
  empty?: { message: string; loosen: Loosen[] };
}

interface DiscoveryCandidate {
  key: string;
  tmdb_id: number;
  library_id: number | null;
  media_type: 'movie' | 'tv';
  name: string;
  year: number | null;
  poster_path: string | null;
  rating: number | null;
  popularity: number;
  source: PickSource;
  score: number;
}

interface DiscoveryQuery {
  mediaType: 'movie' | 'tv';
  source: PickSource;
  params: Record<string, string>;
}

export function shouldExcludeLibraryTitle(
  local: { status: string | null } | undefined,
  excludeLibraryTitles: boolean,
): boolean {
  if (!local) return false;
  if (local.status === 'watched' || local.status === 'dropped') return true;
  return excludeLibraryTitles;
}

function db() {
  return getDb();
}

function stableParams(params: Record<string, string>): string {
  return Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
}

async function cachedDiscover(query: DiscoveryQuery): Promise<tmdb.DiscoverPage> {
  const key = `pick_discover:${query.mediaType}:${query.source}:${stableParams(query.params)}`;
  const cached = cacheGet(key, DAY);
  if (cached?.fresh) return cached.payload as tmdb.DiscoverPage;
  try {
    const fresh = await tmdb.discover(query.mediaType, query.params);
    cacheSet(key, fresh);
    return fresh;
  } catch (err) {
    if (cached) return cached.payload as tmdb.DiscoverPage;
    throw err;
  }
}

function mediaTypes(type: PickConstraints['type']): ('movie' | 'tv')[] {
  return type === 'either' ? ['movie', 'tv'] : [type];
}

function serviceParams(c: PickConstraints): Record<string, string> | null {
  const region = getSetting('region');
  const params: Record<string, string> = {
    watch_region: region,
    with_watch_monetization_types: c.include_rent_buy ? 'flatrate|free|ads|rent|buy' : 'flatrate|free|ads',
  };
  if (c.my_services_only) {
    const providers = [...enabledServiceIds()].sort((a, b) => a - b);
    if (providers.length === 0) return null;
    params.with_watch_providers = providers.join('|');
  }
  return params;
}

async function buildQueries(c: PickConstraints): Promise<DiscoveryQuery[]> {
  const services = serviceParams(c);
  if (!services) return [];
  const genres = c.genres.length > 0 ? await getGenres() : [];
  const today = localToday();
  const recent = localToday(-30);
  const airing = localToday(-7);
  const budget = c.time != null && c.time < 120 ? c.time : null;
  const queries: DiscoveryQuery[] = [];

  for (const mediaType of mediaTypes(c.type)) {
    const genreIds = c.genres.flatMap((key) =>
      genres.find((g: MergedGenre) => g.key === key)?.[mediaType === 'movie' ? 'movie_ids' : 'tv_ids'] ?? [],
    );
    if (c.genres.length > 0 && genreIds.length === 0) continue;
    const common: Record<string, string> = { ...services, include_adult: 'false' };
    if (genreIds.length > 0) common.with_genres = genreIds.join('|');
    if (budget != null) common['with_runtime.lte'] = String(budget);

    if (mediaType === 'movie') {
      queries.push({
        mediaType,
        source: 'new_release',
        params: {
          ...common,
          region: getSetting('region'),
          with_release_type: '4',
          'release_date.gte': recent,
          'release_date.lte': today,
          'vote_count.gte': '20',
          sort_by: 'primary_release_date.desc',
        },
      });
    } else {
      queries.push({
        mediaType,
        source: 'new_release',
        params: {
          ...common,
          'first_air_date.gte': recent,
          'first_air_date.lte': today,
          'vote_count.gte': '20',
          sort_by: 'first_air_date.desc',
        },
      });
      queries.push({
        mediaType,
        source: 'airing_now',
        params: {
          ...common,
          'air_date.gte': airing,
          'air_date.lte': today,
          'vote_count.gte': '50',
          sort_by: 'popularity.desc',
        },
      });
    }

    queries.push({
      mediaType,
      source: 'popular',
      params: {
        ...common,
        [`${mediaType === 'movie' ? 'primary_release_date' : 'first_air_date'}.lte`]: today,
        'vote_count.gte': '200',
        sort_by: 'popularity.desc',
      },
    });
  }
  return queries;
}

function sourceBoost(source: PickSource): number {
  if (source === 'new_release') return 0.3;
  if (source === 'airing_now') return 0.2;
  return 0;
}

function sourcePriority(source: PickSource): number {
  return source === 'new_release' ? 2 : source === 'airing_now' ? 1 : 0;
}

export function calculateCandidateScore(
  rating: number | null,
  popularityPercentile: number,
  source: PickSource,
  history?: { skipped: boolean },
): number {
  const quality = (rating ?? 5) / 10;
  let score = 0.55 * quality + 0.25 * popularityPercentile + sourceBoost(source);
  if (history) score -= history.skipped ? 0.5 : 0.25;
  return score;
}

function toCandidate(entry: tmdb.ListEntry, query: DiscoveryQuery): DiscoveryCandidate {
  const date = query.mediaType === 'movie' ? entry.release_date : entry.first_air_date;
  return {
    key: `${query.mediaType}:${entry.id}`,
    tmdb_id: entry.id,
    library_id: null,
    media_type: query.mediaType,
    name: (query.mediaType === 'movie' ? entry.title : entry.name) ?? '(untitled)',
    year: date ? Number(date.slice(0, 4)) || null : null,
    poster_path: entry.poster_path ?? null,
    rating: entry.vote_average ?? null,
    popularity: entry.popularity ?? 0,
    source: query.source,
    score: 0,
  };
}

function attachLibraryState(candidates: DiscoveryCandidate[], constraints: PickConstraints): DiscoveryCandidate[] {
  if (candidates.length === 0) return candidates;
  const result: DiscoveryCandidate[] = [];
  const suppressed = new Set(
    (db().prepare('SELECT media_type, tmdb_id FROM suggestion_suppressions').all() as { media_type: string; tmdb_id: number }[])
      .map((r) => `${r.media_type}:${r.tmdb_id}`),
  );

  for (const mediaType of ['movie', 'tv'] as const) {
    const subset = candidates.filter((candidate) => candidate.media_type === mediaType);
    if (subset.length === 0) continue;
    const ids = subset.map((candidate) => candidate.tmdb_id);
    const rows = db().prepare(`
      SELECT t.id, t.tmdb_id, us.status
      FROM titles t
      LEFT JOIN user_state us ON us.title_id = t.id
      WHERE t.media_type = ? AND t.tmdb_id IN (${ids.map(() => '?').join(',')})
    `).all(mediaType, ...ids) as { id: number; tmdb_id: number; status: string | null }[];
    const state = new Map(rows.map((row) => [row.tmdb_id, row]));
    for (const candidate of subset) {
      const stored = state.get(candidate.tmdb_id);
      const tracked = stored?.status ? stored : undefined;
      if (suppressed.has(candidate.key)) continue;
      if (shouldExcludeLibraryTitle(tracked, constraints.exclude_library_titles)) continue;
      candidate.library_id = tracked?.id ?? null;
      result.push(candidate);
    }
  }
  return result;
}

interface SuggestionHistory {
  skipped: boolean;
  lastSuggested: string;
}

function recentSuggestions(): Map<string, SuggestionHistory> {
  const cutoff = new Date(Date.now() - HISTORY_PENALTY_DAYS * DAY).toISOString();
  const rows = db().prepare(`
    SELECT media_type, tmdb_id,
           MAX(CASE WHEN action = 'skipped' THEN 1 ELSE 0 END) AS skipped,
           MAX(created_at) AS last_suggested
    FROM suggestion_log WHERE created_at >= ? GROUP BY media_type, tmdb_id
  `).all(cutoff) as { media_type: string; tmdb_id: number; skipped: number; last_suggested: string }[];
  return new Map(rows.map((r) => [
    `${r.media_type}:${r.tmdb_id}`,
    { skipped: r.skipped === 1, lastSuggested: r.last_suggested },
  ]));
}

function scoreCandidates(candidates: DiscoveryCandidate[], history: Map<string, SuggestionHistory>): void {
  const ordered = [...candidates].sort((a, b) => a.popularity - b.popularity);
  const percentile = new Map(ordered.map((candidate, index) => [candidate.key, ordered.length === 1 ? 1 : index / (ordered.length - 1)]));
  for (const candidate of candidates) {
    const hist = history.get(candidate.key);
    candidate.score = calculateCandidateScore(
      candidate.rating,
      percentile.get(candidate.key) ?? 0,
      candidate.source,
      hist,
    );
  }
}

function softmaxDraw(pool: DiscoveryCandidate[]): DiscoveryCandidate {
  const weights = pool.map((candidate) => Math.exp(candidate.score / TEMPERATURE));
  let draw = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < pool.length; i++) {
    draw -= weights[i];
    if (draw <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

async function runtimeFor(candidate: DiscoveryCandidate): Promise<{ minutes: number; estimated: boolean }> {
  const key = `pick_runtime:${candidate.media_type}:${candidate.tmdb_id}`;
  const cached = cacheGet(key, DAY);
  if (cached?.fresh) return cached.payload as { minutes: number; estimated: boolean };
  try {
    let runtime: number | null | undefined;
    if (candidate.media_type === 'movie') {
      runtime = (await tmdb.movieDetails(candidate.tmdb_id)).runtime;
    } else {
      runtime = (await tmdb.tvDetails(candidate.tmdb_id)).episode_run_time[0];
    }
    const payload = {
      minutes: runtime ?? (candidate.media_type === 'movie' ? 120 : 45),
      estimated: runtime == null,
    };
    cacheSet(key, payload);
    return payload;
  } catch (err) {
    if (cached) return cached.payload as { minutes: number; estimated: boolean };
    throw err;
  }
}

function reasonsFor(candidate: DiscoveryCandidate, offers: WatchOffer[], c: PickConstraints): string[] {
  const reasons: string[] = [];
  if (candidate.source === 'new_release') reasons.push('Released in the last 30 days');
  else if (candidate.source === 'airing_now') reasons.push('Airing now');
  else reasons.push('Popular right now');
  if (candidate.rating != null) reasons.push(`${candidate.rating.toFixed(1)} TMDB`);
  if (offers[0]) reasons.push(`On ${offers[0].provider_name}`);
  if (c.genres.length > 0) reasons.push('Matches your mood');
  return reasons;
}

function empty(message: string, loosen: Loosen[] = []): PickResult {
  return { candidate: null, pool_size: 0, empty: { message, loosen } };
}

export async function pickNext(c: PickConstraints, exclude: string[]): Promise<PickResult> {
  if (c.my_services_only && enabledServiceIds().size === 0) {
    return empty('Choose streaming services in Settings, or allow recommendations from any service.', [
      { label: 'Any service', patch: { my_services_only: false, include_rent_buy: false } },
    ]);
  }

  const queries = await buildQueries(c);
  const settled = await Promise.allSettled(queries.map(async (query) => ({ query, page: await cachedDiscover(query) })));
  const fulfilled = settled.filter((r): r is PromiseFulfilledResult<{ query: DiscoveryQuery; page: tmdb.DiscoverPage }> => r.status === 'fulfilled');
  if (fulfilled.length === 0 && settled.length > 0) throw (settled[0] as PromiseRejectedResult).reason;

  const deduped = new Map<string, DiscoveryCandidate>();
  for (const { query, page } of fulfilled.map((r) => r.value)) {
    for (const entry of page.results) {
      const candidate = toCandidate(entry, query);
      const existing = deduped.get(candidate.key);
      if (!existing || sourcePriority(candidate.source) > sourcePriority(existing.source)) deduped.set(candidate.key, candidate);
    }
  }

  let pool = attachLibraryState([...deduped.values()], c);
  if (pool.length === 0) {
    return empty('No current titles match these filters.', [
      ...(c.genres.length > 0 ? [{ label: 'Any mood', patch: { genres: [] } as Partial<PickConstraints> }] : []),
      ...(c.my_services_only ? [{ label: 'Any service', patch: { my_services_only: false } as Partial<PickConstraints> }] : []),
      ...(c.time != null ? [{ label: 'No time limit', patch: { time: null } as Partial<PickConstraints> }] : []),
      ...(c.exclude_library_titles
        ? [{ label: 'Include tracked titles', patch: { exclude_library_titles: false } as Partial<PickConstraints> }]
        : []),
    ]);
  }

  const history = recentSuggestions();
  const cooldown = Date.now() - REPEAT_COOLDOWN_DAYS * DAY;
  pool = pool.filter((candidate) => {
    const last = history.get(candidate.key)?.lastSuggested;
    return !last || Date.parse(last) < cooldown;
  });
  if (pool.length === 0) {
    return empty(`You have already seen every matching recommendation in the last ${REPEAT_COOLDOWN_DAYS} days. Try again later or adjust the filters.`);
  }

  const seen = new Set(exclude);
  const poolSize = pool.length;
  pool = pool.filter((candidate) => !seen.has(candidate.key));
  if (pool.length === 0) return { candidate: null, pool_size: poolSize, exhausted: true };
  scoreCandidates(pool, history);

  const budget = c.time != null && c.time < 120 ? c.time : null;
  const drawable = [...pool];
  while (drawable.length > 0) {
    const candidate = softmaxDraw(drawable);
    const index = drawable.findIndex((item) => item.key === candidate.key);
    drawable.splice(index, 1);
    try {
      const [runtime, offers] = await Promise.all([
        runtimeFor(candidate),
        offersForTitle(candidate.media_type, candidate.tmdb_id, {
          myServicesOnly: c.my_services_only,
          includeRentBuy: c.include_rent_buy,
        }),
      ]);
      if (offers.length === 0 || (budget != null && runtime.minutes > budget)) continue;
      logSuggestion(candidate.media_type, candidate.tmdb_id, candidate.library_id, 'shown', c);
      return {
        candidate: {
          key: candidate.key,
          tmdb_id: candidate.tmdb_id,
          library_id: candidate.library_id,
          media_type: candidate.media_type,
          name: candidate.name,
          year: candidate.year,
          poster_path: candidate.poster_path,
          source: candidate.source,
          runtime: runtime.minutes,
          runtime_estimated: runtime.estimated,
          providers: offers,
          rent_buy_only: offers.every((offer) => !STREAM_TYPES.has(offer.offer_type)),
          reasons: reasonsFor(candidate, offers, c),
        },
        pool_size: poolSize,
      };
    } catch {
      continue;
    }
  }

  return empty('Availability changed while checking these titles. Try broader filters or try again shortly.', [
    ...(c.my_services_only ? [{ label: 'Any service', patch: { my_services_only: false } as Partial<PickConstraints> }] : []),
    ...(c.time != null ? [{ label: 'No time limit', patch: { time: null } as Partial<PickConstraints> }] : []),
  ]);
}

export function logSuggestion(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  titleId: number | null,
  action: 'shown' | 'accepted' | 'shuffled' | 'skipped',
  constraints: unknown,
): void {
  db().prepare(`
    INSERT INTO suggestion_log (title_id, tmdb_id, media_type, action, constraints, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(titleId, tmdbId, mediaType, action, JSON.stringify(constraints ?? {}), nowIso());
}

export function setSuggestionSuppressed(mediaType: 'movie' | 'tv', tmdbId: number, suppressed: boolean): void {
  if (suppressed) {
    db().prepare('INSERT OR IGNORE INTO suggestion_suppressions (media_type, tmdb_id, created_at) VALUES (?, ?, ?)')
      .run(mediaType, tmdbId, nowIso());
  } else {
    db().prepare('DELETE FROM suggestion_suppressions WHERE media_type = ? AND tmdb_id = ?').run(mediaType, tmdbId);
  }
}
