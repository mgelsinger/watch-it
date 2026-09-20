import { z } from 'zod';
import { config, localToday } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { fetchJson, HttpError, QuotaError } from '../http.js';
import { getCredential, validateCredential } from '../services/credentials.js';

// Quota accounting: OMDb free tier allows 1,000 requests/day. We track our own
// usage in settings and stop at a safety margin; callers queue and retry later.

const OmdbZ = z
  .object({
    Response: z.string(),
    Error: z.string().optional(),
    imdbRating: z.string().optional(),
    Metascore: z.string().optional(),
    Ratings: z.array(z.object({ Source: z.string(), Value: z.string() })).optional(),
  })
  .passthrough();

export interface OmdbRatings {
  imdbRating: number | null;
  rtScore: number | null;
  metacritic: number | null;
}

export function omdbConfigured(): boolean {
  return !!getCredential('omdb');
}

function usedToday(): number {
  if (getSetting('omdb_used_date', '') !== localToday()) return 0;
  return Number(getSetting('omdb_used_count', '0')) || 0;
}

function recordUse(n = 1): void {
  const today = localToday();
  const count = usedToday() + n;
  setSetting('omdb_used_date', today);
  setSetting('omdb_used_count', String(count));
}

export function omdbQuotaRemaining(): number {
  return Math.max(0, config.omdbDailyBudget - usedToday());
}

/**
 * Fetch ratings by IMDb id (never by title -- title search wastes quota on
 * wrong matches). Throws QuotaError when the daily budget is exhausted.
 */
export async function getRatings(imdbId: string): Promise<OmdbRatings> {
  const key = getCredential('omdb');
  if (!key) throw new QuotaError('OMDb API key is not configured');
  if (omdbQuotaRemaining() <= 0) throw new QuotaError('OMDb daily budget exhausted; deferred');

  let raw: unknown;
  try {
    recordUse();
    raw = await fetchJson('omdb', `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      // 401 = invalid key OR daily limit reached. Either way, stop for today.
      setSetting('omdb_used_date', localToday());
      setSetting('omdb_used_count', String(config.omdbDailyBudget));
      throw new QuotaError(`OMDb rejected the request (401): ${err.body ?? ''}`);
    }
    throw err;
  }

  const parsed = OmdbZ.parse(raw);
  if (parsed.Response !== 'True') {
    if (/limit/i.test(parsed.Error ?? '')) {
      setSetting('omdb_used_count', String(config.omdbDailyBudget));
      throw new QuotaError(`OMDb: ${parsed.Error}`);
    }
    // e.g. "Incorrect IMDb ID." -- treat as "no ratings", not an error.
    return { imdbRating: null, rtScore: null, metacritic: null };
  }

  const num = (s: string | undefined): number | null => {
    const n = parseFloat(s ?? '');
    return Number.isFinite(n) ? n : null;
  };
  let rt: number | null = null;
  for (const r of parsed.Ratings ?? []) {
    if (r.Source === 'Rotten Tomatoes') rt = num(r.Value.replace('%', ''));
  }
  return {
    imdbRating: num(parsed.imdbRating),
    rtScore: rt,
    metacritic: num(parsed.Metascore),
  };
}

export async function testKey(key = getCredential('omdb')): Promise<void> {
  if (omdbQuotaRemaining() <= 0) throw new HttpError('OMDb daily budget exhausted. Try again tomorrow.', 429);
  recordUse();
  await validateCredential('omdb', key);
}
