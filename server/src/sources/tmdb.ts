import { z } from 'zod';
import { config } from '../config.js';
import { fetchJson } from '../http.js';

const BASE = 'https://api.themoviedb.org/3';

export function tmdbConfigured(): boolean {
  return !!config.tmdbKey;
}

async function tmdb(path: string, params: Record<string, string> = {}): Promise<unknown> {
  if (!config.tmdbKey) throw new Error('TMDB API key is not configured');
  const qs = new URLSearchParams({ api_key: config.tmdbKey, ...params });
  return fetchJson('tmdb', `${BASE}${path}?${qs}`);
}

// ---- zod schemas: intentionally loose; unknown fields pass through, most fields optional.

export const SearchResultZ = z
  .object({
    id: z.number(),
    media_type: z.string().optional(),
    title: z.string().optional(),
    name: z.string().optional(),
    release_date: z.string().nullish(),
    first_air_date: z.string().nullish(),
    poster_path: z.string().nullish(),
    vote_average: z.number().nullish(),
    overview: z.string().nullish(),
  })
  .passthrough();

const SearchPageZ = z.object({ results: z.array(z.unknown()).default([]) }).passthrough();

const GenreZ = z.object({ id: z.number(), name: z.string() }).passthrough();

const CastZ = z
  .object({
    id: z.number(),
    name: z.string(),
    character: z.string().nullish(),
    order: z.number().nullish(),
    profile_path: z.string().nullish(),
  })
  .passthrough();

const ProviderZ = z
  .object({ provider_id: z.number(), provider_name: z.string(), logo_path: z.string().nullish() })
  .passthrough();

const RegionOffersZ = z
  .object({
    flatrate: z.array(ProviderZ).optional(),
    rent: z.array(ProviderZ).optional(),
    buy: z.array(ProviderZ).optional(),
    free: z.array(ProviderZ).optional(),
    ads: z.array(ProviderZ).optional(),
  })
  .passthrough();

const WatchProvidersZ = z.object({ results: z.record(RegionOffersZ).default({}) }).passthrough();

const ExternalIdsZ = z.object({ imdb_id: z.string().nullish() }).passthrough();

export const MovieDetailsZ = z
  .object({
    id: z.number(),
    title: z.string(),
    release_date: z.string().nullish(),
    overview: z.string().nullish(),
    poster_path: z.string().nullish(),
    backdrop_path: z.string().nullish(),
    vote_average: z.number().nullish(),
    genres: z.array(GenreZ).default([]),
    runtime: z.number().nullish(),
    status: z.string().nullish(),
    imdb_id: z.string().nullish(),
    external_ids: ExternalIdsZ.optional(),
    credits: z.object({ cast: z.array(CastZ).default([]) }).passthrough().optional(),
    'watch/providers': WatchProvidersZ.optional(),
  })
  .passthrough();

const SeasonSummaryZ = z
  .object({
    season_number: z.number(),
    name: z.string().nullish(),
    episode_count: z.number().nullish(),
    air_date: z.string().nullish(),
    poster_path: z.string().nullish(),
  })
  .passthrough();

export const TvDetailsZ = z
  .object({
    id: z.number(),
    name: z.string(),
    first_air_date: z.string().nullish(),
    overview: z.string().nullish(),
    poster_path: z.string().nullish(),
    backdrop_path: z.string().nullish(),
    vote_average: z.number().nullish(),
    genres: z.array(GenreZ).default([]),
    episode_run_time: z.array(z.number()).default([]),
    status: z.string().nullish(),
    seasons: z.array(SeasonSummaryZ).default([]),
    external_ids: ExternalIdsZ.optional(),
    credits: z.object({ cast: z.array(CastZ).default([]) }).passthrough().optional(),
    'watch/providers': WatchProvidersZ.optional(),
  })
  .passthrough();

const EpisodeZ = z
  .object({
    episode_number: z.number(),
    name: z.string().nullish(),
    air_date: z.string().nullish(),
    runtime: z.number().nullish(),
    overview: z.string().nullish(),
  })
  .passthrough();

export const SeasonDetailsZ = z
  .object({
    season_number: z.number(),
    name: z.string().nullish(),
    air_date: z.string().nullish(),
    poster_path: z.string().nullish(),
    episodes: z.array(EpisodeZ).default([]),
  })
  .passthrough();

const ListEntryZ = z
  .object({
    id: z.number(),
    title: z.string().optional(),
    name: z.string().optional(),
    release_date: z.string().nullish(),
    poster_path: z.string().nullish(),
    vote_average: z.number().nullish(),
    overview: z.string().nullish(),
  })
  .passthrough();

const ListPageZ = z.object({ results: z.array(ListEntryZ).default([]) }).passthrough();

const ProviderListZ = z.object({ results: z.array(ProviderZ).default([]) }).passthrough();

const FindZ = z
  .object({
    movie_results: z.array(ListEntryZ).default([]),
    tv_results: z.array(ListEntryZ).default([]),
  })
  .passthrough();

// ---- API surface ----

export type MovieDetails = z.infer<typeof MovieDetailsZ>;
export type TvDetails = z.infer<typeof TvDetailsZ>;
export type SeasonDetails = z.infer<typeof SeasonDetailsZ>;
export type RegionOffers = z.infer<typeof RegionOffersZ>;

export async function searchMulti(query: string): Promise<unknown[]> {
  const raw = await tmdb('/search/multi', { query, include_adult: 'false' });
  return SearchPageZ.parse(raw).results;
}

export async function movieDetails(id: number): Promise<MovieDetails> {
  const raw = await tmdb(`/movie/${id}`, { append_to_response: 'external_ids,credits,watch/providers' });
  return MovieDetailsZ.parse(raw);
}

export async function tvDetails(id: number): Promise<TvDetails> {
  const raw = await tmdb(`/tv/${id}`, { append_to_response: 'external_ids,credits,watch/providers' });
  return TvDetailsZ.parse(raw);
}

export async function seasonDetails(tvId: number, seasonNumber: number): Promise<SeasonDetails> {
  const raw = await tmdb(`/tv/${tvId}/season/${seasonNumber}`);
  return SeasonDetailsZ.parse(raw);
}

export async function movieProviders(id: number): Promise<Record<string, RegionOffers>> {
  const raw = await tmdb(`/movie/${id}/watch/providers`);
  return WatchProvidersZ.parse(raw).results;
}

export async function tvProviders(id: number): Promise<Record<string, RegionOffers>> {
  const raw = await tmdb(`/tv/${id}/watch/providers`);
  return WatchProvidersZ.parse(raw).results;
}

export async function personImdbId(personId: number): Promise<string | null> {
  const raw = await tmdb(`/person/${personId}/external_ids`);
  return ExternalIdsZ.parse(raw).imdb_id ?? null;
}

export async function nowPlaying(region: string): Promise<z.infer<typeof ListEntryZ>[]> {
  const raw = await tmdb('/movie/now_playing', { region });
  return ListPageZ.parse(raw).results;
}

export async function upcoming(region: string): Promise<z.infer<typeof ListEntryZ>[]> {
  const raw = await tmdb('/movie/upcoming', { region });
  return ListPageZ.parse(raw).results;
}

export async function providerList(region: string): Promise<z.infer<typeof ProviderZ>[]> {
  const [movies, tv] = await Promise.all([
    tmdb('/watch/providers/movie', { watch_region: region }),
    tmdb('/watch/providers/tv', { watch_region: region }),
  ]);
  const seen = new Map<number, z.infer<typeof ProviderZ>>();
  for (const p of [...ProviderListZ.parse(movies).results, ...ProviderListZ.parse(tv).results]) {
    if (!seen.has(p.provider_id)) seen.set(p.provider_id, p);
  }
  return [...seen.values()].sort((a, b) => a.provider_name.localeCompare(b.provider_name));
}

/** Resolve an IMDb id to a TMDB id. Returns null when TMDB doesn't know it. */
export async function findByImdb(imdbId: string): Promise<{ tmdbId: number; mediaType: 'movie' | 'tv' } | null> {
  const raw = await tmdb(`/find/${imdbId}`, { external_source: 'imdb_id' });
  const found = FindZ.parse(raw);
  if (found.tv_results[0]) return { tmdbId: found.tv_results[0].id, mediaType: 'tv' };
  if (found.movie_results[0]) return { tmdbId: found.movie_results[0].id, mediaType: 'movie' };
  return null;
}

export async function searchTv(query: string): Promise<{ id: number; name?: string }[]> {
  const raw = await tmdb('/search/tv', { query });
  return ListPageZ.parse(raw).results;
}

export async function testKey(): Promise<void> {
  await tmdb('/configuration');
}
