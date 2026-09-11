import { cacheGet, cacheSet, getDb, getSetting } from '../db.js';
import { localToday, nowIso } from '../config.js';
import * as tmdb from '../sources/tmdb.js';
import { enabledServiceIds } from './availability.js';
import { getGenres, genreDiscoverParams } from './browse.js';
import { discoveryProviderIds, getExternalOffers, filterAndSortOffers, type WatchOffer, type AvailabilityCheck } from './providers.js';
import { englishVersion, knownEnglish, loadEnglishVersions, versionMatchesParams, type EnglishVersion } from './englishVersions.js';

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
  excluded_provider_ids?: number[];
  include_rent_buy: boolean;
  exclude_library_titles: boolean;
  prefer_english?: boolean;
  include_adaptations?: boolean;
}

export type PickSource = 'new_release' | 'airing_now' | 'popular';

export interface PickCandidate {
  key: string;
  tmdb_id: number;
  library_id: number | null;
  media_type: 'movie' | 'tv';
  name: string;
  year: number | null;
  overview?: string | null;
  poster_path: string | null;
  source: PickSource;
  runtime: number;
  runtime_estimated: boolean;
  runtime_basis?: 'movie' | 'series' | 'first_episode';
  providers: WatchOffer[];
  availability_check: AvailabilityCheck;
  watch_url: string | null;
  rent_buy_only: boolean;
  reasons: string[];
  english_version?: EnglishVersion;
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
  notice?: string;
}

interface DiscoveryCandidate {
  key: string;
  tmdb_id: number;
  library_id: number | null;
  media_type: 'movie' | 'tv';
  name: string;
  overview?: string | null;
  year: number | null;
  poster_path: string | null;
  rating: number | null;
  popularity: number;
  source: PickSource;
  score: number;
  english_version: EnglishVersion;
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

async function serviceParams(c: PickConstraints): Promise<Record<string, string> | null> {
  const region = getSetting('region');
  const params: Record<string, string> = {
    watch_region: region,
    with_watch_monetization_types: c.include_rent_buy ? 'flatrate|free|ads|rent|buy' : 'flatrate|free|ads',
  };
  const providers = await discoveryProviderIds(c.excluded_provider_ids ?? [], c.my_services_only);
  if (providers?.length === 0) return null;
  if (providers) {
    params.with_watch_providers = providers.join('|');
  }
  return params;
}

async function buildQueries(c: PickConstraints): Promise<DiscoveryQuery[]> {
  const services = await serviceParams(c);
  if (!services) return [];
  const genres = c.genres.length > 0 ? await getGenres() : [];
  const today = localToday();
  const recent = localToday(-30);
  const airing = localToday(-7);
  const budget = c.time;
  const queries: DiscoveryQuery[] = [];

  for (const mediaType of mediaTypes(c.type)) {
    const common: Record<string, string> = { ...services, include_adult: 'false' };
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
  return queries.flatMap((query) =>
    genreDiscoverParams(query.mediaType, c.genres, genres).map((params) => ({
      ...query, params: { ...query.params, ...params },
    })),
  );
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
    english_version: englishVersion(query.mediaType, entry.id, entry.original_language),
    tmdb_id: entry.id,
    library_id: null,
    media_type: query.mediaType,
    name: (query.mediaType === 'movie' ? entry.title : entry.name) ?? '(untitled)',
    overview: entry.overview ?? null,
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

type Runtime = { minutes: number; estimated: boolean; basis?: 'movie' | 'series' | 'first_episode' };

async function runtimeFor(candidate: DiscoveryCandidate): Promise<Runtime> {
  const key = `pick_runtime_v3:${candidate.media_type}:${candidate.tmdb_id}`;
  const cached = cacheGet(key, DAY);
  if (cached?.fresh) return cached.payload as Runtime;
  try {
    let runtime: number | null | undefined;
    let basis: Runtime['basis'] = candidate.media_type === 'movie' ? 'movie' : 'series';
    if (candidate.media_type === 'movie') {
      runtime = (await tmdb.movieDetails(candidate.tmdb_id)).runtime;
    } else {
      const details = await tmdb.tvDetails(candidate.tmdb_id);
      runtime = details.episode_run_time.find((value) => value > 0);
      // Many series omit the summary runtime even though the first episode has one.
      // Use that explicit episode evidence, never an invented 45-minute fit.
      if (!runtime && details.seasons.some((season) => season.season_number === 1)) {
        const season = await tmdb.seasonDetails(candidate.tmdb_id, 1);
        runtime = season.episodes.find((episode) => episode.episode_number === 1)?.runtime;
        basis = 'first_episode';
      }
    }
    const payload = {
      minutes: runtime && runtime > 0 ? runtime : (candidate.media_type === 'movie' ? 120 : 45),
      estimated: !runtime || runtime <= 0,
      basis,
    };
    cacheSet(key, payload);
    return payload;
  } catch (err) {
    if (cached) return cached.payload as Runtime;
    throw err;
  }
}

function reasonsFor(candidate: DiscoveryCandidate, offers: WatchOffer[], c: PickConstraints, runtime: Runtime): string[] {
  const reasons: string[] = [];
  if (c.time != null && !runtime.estimated) reasons.push(`${runtime.minutes} min ${runtime.basis === 'first_episode' ? 'first episode' : candidate.media_type === 'tv' ? 'listed episode runtime' : 'movie'} within your ${c.time} min limit`);
  if (offers[0]) reasons.push(`Listed on ${offers[0].provider_name} in ${getSetting('region')}`);
  if (c.genres.length > 0) reasons.push(`Catalog filter: ${c.genres.map((key) => key.replace(/-/g, ' ')).join(', ')}`);
  if (candidate.rating != null && candidate.rating > 0) reasons.push(`${candidate.rating.toFixed(1)}/10 on TMDB`);
  return reasons;
}

function empty(message: string, loosen: Loosen[] = [], notice?: string): PickResult {
  return { candidate: null, pool_size: 0, empty: { message, loosen }, notice };
}

export async function pickNext(c: PickConstraints, exclude: string[]): Promise<PickResult> {
  if (c.my_services_only && c.excluded_provider_ids?.length &&
      [...enabledServiceIds()].every((id) => c.excluded_provider_ids!.includes(id))) {
    return empty('All of your selected services are excluded. Clear exclusions or search other services.', [
      { label: 'Clear service exclusions', patch: { excluded_provider_ids: [] } },
      { label: 'Other services', patch: { my_services_only: false } },
    ]);
  }
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

  let notice: string | undefined = settled.some((result) => result.status === 'rejected') ? 'Some searches could not be refreshed. Results may be incomplete.' : undefined;
  if (c.include_adaptations) {
    const versions = await loadEnglishVersions(c.genres, mediaTypes(c.type), true);
    if (versions.incomplete) notice = 'Some English-version details could not be refreshed. Results may be incomplete or use cached details.';
    const common = await serviceParams(c);
    for (const version of versions.entries) {
      if (!common) break;
      const params: Record<string, string> = {
        ...common, 'vote_count.gte': '200', sort_by: 'popularity.desc',
        [`${version.media_type === 'movie' ? 'primary_release_date' : 'first_air_date'}.lte`]: localToday(),
      };
      if (c.time != null) params['with_runtime.lte'] = String(c.time);
      if (!versionMatchesParams(version, params)) continue;
      const candidate = toCandidate(version.entry, { mediaType: version.media_type, source: 'popular', params });
      if (!deduped.has(candidate.key)) deduped.set(candidate.key, candidate);
    }
  }

  let pool = attachLibraryState([...deduped.values()], c);
  if (pool.length === 0) {
    return empty('No current titles match these filters.', [
      ...(c.excluded_provider_ids?.length ? [{ label: 'Clear service exclusions', patch: { excluded_provider_ids: [] } as Partial<PickConstraints> }] : []),
      ...(c.genres.length > 0 ? [{ label: 'Any mood', patch: { genres: [] } as Partial<PickConstraints> }] : []),
      ...(c.my_services_only ? [{ label: 'Any service', patch: { my_services_only: false } as Partial<PickConstraints> }] : []),
      ...(c.time != null ? [{ label: 'No time limit', patch: { time: null } as Partial<PickConstraints> }] : []),
      ...(c.exclude_library_titles
        ? [{ label: 'Include tracked titles', patch: { exclude_library_titles: false } as Partial<PickConstraints> }]
        : []),
    ], notice);
  }

  const history = recentSuggestions();
  const cooldown = Date.now() - REPEAT_COOLDOWN_DAYS * DAY;
  pool = pool.filter((candidate) => {
    const last = history.get(candidate.key)?.lastSuggested;
    return !last || Date.parse(last) < cooldown;
  });
  if (pool.length === 0) {
    return empty(`You have already seen every matching recommendation in the last ${REPEAT_COOLDOWN_DAYS} days. Try again later or adjust the filters.`, [], notice);
  }

  const seen = new Set(exclude);
  const poolSize = pool.length;
  pool = pool.filter((candidate) => !seen.has(candidate.key));
  if (pool.length === 0) return { candidate: null, pool_size: poolSize, exhausted: true, notice };
  scoreCandidates(pool, history);

  const budget = c.time;
  const drawable = [...pool];
  let checked = 0;
  while (drawable.length > 0 && checked++ < 12) {
    const preferred = c.prefer_english ? drawable.filter((item) => knownEnglish(item.english_version)) : [];
    const candidate = softmaxDraw(preferred.length > 0 ? preferred : drawable);
    const index = drawable.findIndex((item) => item.key === candidate.key);
    drawable.splice(index, 1);
    try {
      const [runtime, availability] = await Promise.all([
        runtimeFor(candidate),
        getExternalOffers(candidate.media_type, candidate.tmdb_id),
      ]);
      const offers = filterAndSortOffers(availability.offers, {
          myServicesOnly: c.my_services_only,
          includeRentBuy: c.include_rent_buy,
          excludedProviderIds: c.excluded_provider_ids,
        });
      if (availability.availability_check.status !== 'fresh') notice = 'Some availability checks failed or used cached offers. Results may be incomplete; try again shortly.';
      if (offers.length === 0 || (budget != null && (runtime.estimated || runtime.minutes > budget))) continue;
      logSuggestion(candidate.media_type, candidate.tmdb_id, candidate.library_id, 'shown', c);
      return {
        candidate: {
          key: candidate.key,
          tmdb_id: candidate.tmdb_id,
          library_id: candidate.library_id,
          media_type: candidate.media_type,
          name: candidate.name,
          overview: candidate.overview,
          year: candidate.year,
          poster_path: candidate.poster_path,
          source: candidate.source,
          runtime: runtime.minutes,
          runtime_estimated: runtime.estimated,
          runtime_basis: runtime.basis,
          providers: offers,
          availability_check: availability.availability_check,
          watch_url: availability.watch_url,
          rent_buy_only: offers.every((offer) => !STREAM_TYPES.has(offer.offer_type)),
          reasons: reasonsFor(candidate, offers, c, runtime),
          english_version: candidate.english_version,
        },
        pool_size: poolSize,
        notice,
      };
    } catch {
      notice = 'Some title checks failed. Results may be incomplete; try again shortly.';
      continue;
    }
  }

  return empty('None of the titles checked had both a matching watch offer and a known runtime within your limit. Runtime or availability information may be missing. Try broader filters or try again shortly.', [
    ...(c.excluded_provider_ids?.length ? [{ label: 'Clear service exclusions', patch: { excluded_provider_ids: [] } as Partial<PickConstraints> }] : []),
    ...(c.my_services_only ? [{ label: 'Any service', patch: { my_services_only: false } as Partial<PickConstraints> }] : []),
    ...(c.time != null ? [{ label: 'No time limit', patch: { time: null } as Partial<PickConstraints> }] : []),
  ], notice);
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
