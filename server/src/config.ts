import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

// Load .env from cwd, then walk up (dev runs from server/, .env lives at repo root).
for (const dir of [process.cwd(), path.resolve(process.cwd(), '..')]) {
  const p = path.join(dir, '.env');
  if (process.env.WATCH_IT_LOAD_ENV !== 'false' && fs.existsSync(p)) dotenv.config({ path: p });
}

export const config = {
  port: Number(process.env.PORT || 8300),
  host: process.env.HOST || '127.0.0.1',
  // Explicit addresses/CIDRs only. Never trust arbitrary forwarded headers.
  trustedProxies: (process.env.WATCH_IT_TRUSTED_PROXIES || '').split(',').map((value) => value.trim()).filter(Boolean),
  tmdbKey: process.env.TMDB_API_KEY || '',
  omdbKey: process.env.OMDB_API_KEY || '',
  dataDir: process.env.DATA_DIR || path.resolve(process.cwd(), 'data'),
  webDist: process.env.WEB_DIST || '',
  authPassword: process.env.WATCH_IT_PASSWORD || '',
  authSecureCookie: process.env.WATCH_IT_SECURE_COOKIE === 'true',
  imageCacheMb: Math.max(16, Math.min(4096, Number(process.env.IMAGE_CACHE_MB) || 256)),
  imageCacheDays: Math.max(1, Math.min(90, Number(process.env.IMAGE_CACHE_DAYS) || 90)),
  backupDirectory: process.env.BACKUP_DIR || '',
  backupRetention: Math.max(1, Math.min(365, Math.floor(Number(process.env.BACKUP_RETENTION) || 7))),
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
