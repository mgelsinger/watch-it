import { cacheGet, cacheSet } from '../db.js';
import * as tmdb from '../sources/tmdb.js';
import { cachedEnglishAudio } from './englishAudio.js';

type MediaType = 'movie' | 'tv';
export interface EnglishVersion {
  audio: 'original' | 'dub' | 'unknown';
  audio_source?: string;
  adaptation_of?: string;
  adaptation_source?: string;
  checked_at?: string;
  audio_provider?: string;
  audio_region?: string;
}

interface CatalogEntry {
  tmdb_id: number;
  media_type: MediaType;
  name: string;
  category: 'korean-drama' | 'anime';
  audio: 'original' | 'dub';
  audio_source: string;
  adaptation_of?: string;
  adaptation_source?: string;
  audio_provider?: string;
  checked_at?: string;
}

// Explicit work-to-work relationships and additional provider evidence.
// Audio evidence only annotates results; it never defines the genre search pool.
const CHECKED_AT = '2026-09-09';
export const ENGLISH_VERSION_CATALOG: readonly CatalogEntry[] = [
  { tmdb_id: 30991, media_type: 'tv', name: 'Cowboy Bebop (1998)', category: 'anime', audio: 'dub',
    audio_source: 'https://www.crunchyroll.com/series/GYVNXMVP6/cowboy-bebop',
    audio_provider: 'Crunchyroll', checked_at: '2026-09-10' },
  { tmdb_id: 71712, media_type: 'tv', name: 'The Good Doctor', category: 'korean-drama', audio: 'original',
    audio_source: 'https://www.themoviedb.org/tv/71712', adaptation_of: 'Good Doctor (2013, Korea)',
    adaptation_source: 'https://abc.com/cast/707cc913-07cb-4b63-8dab-65d4733941db' },
  { tmdb_id: 84469, media_type: 'tv', name: 'Cowboy Bebop (2021)', category: 'anime', audio: 'original',
    audio_source: 'https://www.netflix.com/title/80207033', adaptation_of: 'Cowboy Bebop (1998 anime)',
    adaptation_source: 'https://media.netflix.com/en/only-on-netflix/80207033' },
  { tmdb_id: 351460, media_type: 'movie', name: 'Death Note (2017)', category: 'anime', audio: 'original',
    audio_source: 'https://www.netflix.com/title/80122759', adaptation_of: 'Death Note (manga)',
    adaptation_source: 'https://media.netflix.com/en/only-on-netflix/80122759' },
  { tmdb_id: 111110, media_type: 'tv', name: 'ONE PIECE (2023)', category: 'anime', audio: 'original',
    audio_source: 'https://www.netflix.com/title/80217863', adaptation_of: 'One Piece (manga)',
    adaptation_source: 'https://media.netflix.com/en/only-on-netflix/80217863' },
];

export function englishVersion(mediaType: MediaType, tmdbId: number, originalLanguage?: string | null): EnglishVersion {
  const known = ENGLISH_VERSION_CATALOG.find((entry) => entry.media_type === mediaType && entry.tmdb_id === tmdbId);
  if (known) return {
    audio: known.audio, audio_source: known.audio_source, adaptation_of: known.adaptation_of,
    adaptation_source: known.adaptation_source, checked_at: known.checked_at ?? CHECKED_AT, audio_provider: known.audio_provider,
  };
  if (originalLanguage === 'en') return { audio: 'original', audio_source: `https://www.themoviedb.org/${mediaType}/${tmdbId}` };
  const evidence = cachedEnglishAudio({ media_type: mediaType, tmdb_id: tmdbId });
  return evidence?.english ? { audio: 'dub', audio_source: evidence.audio_source,
    checked_at: evidence.checked_at, audio_provider: evidence.audio_provider, audio_region: evidence.audio_region } : { audio: 'unknown' };
}

export function knownEnglish(version: EnglishVersion | undefined): boolean {
  return version?.audio === 'original' || version?.audio === 'dub';
}

export function adaptationIds(category: string, mediaType: MediaType): number[] {
  return ENGLISH_VERSION_CATALOG.filter((entry) => entry.category === category && entry.media_type === mediaType && entry.adaptation_of)
    .map((entry) => entry.tmdb_id);
}

export interface VersionEntry {
  media_type: MediaType;
  entry: tmdb.ListEntry;
  status: string | null;
  networks: number[];
  runtime: number | null;
}

/** Supplement discovery with explicit identities instead of broadening it to all English titles. */
export async function loadEnglishVersions(
  genres: string[], types: MediaType[], includeAdaptations: boolean,
): Promise<{ entries: VersionEntry[]; incomplete: boolean }> {
  const selected = ENGLISH_VERSION_CATALOG.filter((item) => genres.includes(item.category) && types.includes(item.media_type) &&
    item.adaptation_of && includeAdaptations);
  let stale = false;
  const settled = await Promise.allSettled(selected.map(async (item): Promise<VersionEntry> => {
    const key = `english_version:${item.media_type}:${item.tmdb_id}`;
    const cached = cacheGet(key, 86400_000);
    if (cached?.fresh) return cached.payload as VersionEntry;
    try {
      const d = item.media_type === 'movie' ? await tmdb.movieDetails(item.tmdb_id) : await tmdb.tvDetails(item.tmdb_id);
      const parsed = tmdb.ListEntryZ.parse({ ...d, genre_ids: d.genres.map((genre) => genre.id) });
      const payload: VersionEntry = {
        media_type: item.media_type, entry: parsed, status: d.status ?? null,
        networks: 'networks' in d && Array.isArray(d.networks) ? d.networks.map((network) => Number(network.id)) : [],
        runtime: item.media_type === 'movie' ? (d as tmdb.MovieDetails).runtime ?? null : (d as tmdb.TvDetails).episode_run_time[0] ?? null,
      };
      cacheSet(key, payload);
      return payload;
    } catch (err) {
      if (cached) {
        stale = true;
        return cached.payload as VersionEntry;
      }
      throw err;
    }
  }));
  return {
    entries: settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
    incomplete: stale || settled.some((result) => result.status === 'rejected'),
  };
}

/** Apply the same metadata restrictions to explicit titles as to Discover results. */
export function versionMatchesParams(v: VersionEntry, params: Record<string, string>): boolean {
  const dateKey = v.media_type === 'movie' ? 'primary_release_date' : 'first_air_date';
  const date = v.media_type === 'movie' ? v.entry.release_date : v.entry.first_air_date;
  if (params[`${dateKey}.gte`] && (!date || date < params[`${dateKey}.gte`])) return false;
  if (params[`${dateKey}.lte`] && (!date || date > params[`${dateKey}.lte`])) return false;
  if (params['vote_average.gte'] && (v.entry.vote_average ?? 0) < Number(params['vote_average.gte'])) return false;
  if (params['vote_count.gte'] && (v.entry.vote_count ?? 0) < Number(params['vote_count.gte'])) return false;
  if (params['with_runtime.lte'] && v.runtime != null && v.runtime > Number(params['with_runtime.lte'])) return false;
  if (params.with_status) {
    const status = { '0': 'Returning Series', '3': 'Ended', '4': 'Canceled' }[params.with_status];
    if (v.status !== status) return false;
  }
  if (params.with_networks && !v.networks.some((id) => params.with_networks.split('|').includes(String(id)))) return false;
  return true;
}
