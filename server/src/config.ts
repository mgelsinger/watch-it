import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

// Load .env from cwd, then walk up (dev runs from server/, .env lives at repo root).
for (const dir of [process.cwd(), path.resolve(process.cwd(), '..')]) {
  const p = path.join(dir, '.env');
  if (fs.existsSync(p)) dotenv.config({ path: p });
}

export const config = {
  port: Number(process.env.PORT || 8300),
  tmdbKey: process.env.TMDB_API_KEY || '',
  omdbKey: process.env.OMDB_API_KEY || '',
  dataDir: process.env.DATA_DIR || path.resolve(process.cwd(), 'data'),
  webDist: process.env.WEB_DIST || '',
  authPassword: process.env.WATCH_IT_PASSWORD || '',
  authSecureCookie: process.env.WATCH_IT_SECURE_COOKIE === 'true',
  // Safety margin under OMDb's 1,000/day free-tier limit.
  omdbDailyBudget: Number(process.env.OMDB_DAILY_BUDGET || 900),
};

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Local calendar date (YYYY-MM-DD) honoring the TZ env var. */
export function localToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return d.toLocaleDateString('en-CA');
}
