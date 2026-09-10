import { cacheGet } from '../db.js';
import { NETFLIX_DUBS } from '../catalog/netflixDubs.js';

export interface TitleIdentity { media_type: 'movie' | 'tv'; tmdb_id: number }
export interface AudioEvidence {
  english: boolean;
  audio_source: string;
  checked_at: string;
  audio_provider: string;
  audio_region?: string;
}

const identityKey = (title: TitleIdentity) => title.media_type + ':' + title.tmdb_id;
const evidence = new Map(NETFLIX_DUBS.map((entry) => [identityKey(entry), entry]));

/** Audio annotations are independent of discovery and never trigger provider scraping. */
export function cachedEnglishAudio(title: TitleIdentity): AudioEvidence | null {
  const key = identityKey(title);
  const cached = cacheGet('english_audio:v1:' + key, 7 * 86400_000);
  const seed = evidence.get(key);
  // A newer check supersedes old evidence, including when English audio was absent.
  return cached && (!seed || Date.parse(cached.fetchedAt) >= Date.parse(seed.checked_at))
    ? cached.payload as AudioEvidence | null : seed ?? null;
}
