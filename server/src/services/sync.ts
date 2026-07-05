import cron from 'node-cron';
import { getDb, getSetting, cacheGet, cacheSet } from '../db.js';
import { nowIso, localToday } from '../config.js';
import * as tmdb from '../sources/tmdb.js';
import * as omdb from '../sources/omdb.js';
import * as tvmaze from '../sources/tvmaze.js';
import { refreshTitle, refreshProviders, refreshRatings, emitTonightEvents } from './library.js';

// ---- in-memory progress, exposed at /api/sync/status ----

export interface SyncState {
  running: boolean;
  scope: string | null;
  done: number;
  total: number;
  startedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

export const syncState: SyncState = {
  running: false,
  scope: null,
  done: 0,
  total: 0,
  startedAt: null,
  lastFinishedAt: null,
  lastError: null,
};

function logStart(source: string, scope: string): number {
  const res = getDb()
    .prepare('INSERT INTO sync_log (source, scope, started_at) VALUES (?, ?, ?)')
    .run(source, scope, nowIso());
  return Number(res.lastInsertRowid);
}

function logFinish(id: number, ok: boolean, error?: string): void {
  getDb()
    .prepare('UPDATE sync_log SET finished_at = ?, ok = ?, error = ? WHERE id = ?')
    .run(nowIso(), ok ? 1 : 0, error ?? null, id);
}

/** Run a scoped job with sync_log bookkeeping. Errors are logged, never thrown. */
async function scoped(source: string, scope: string, fn: () => Promise<void>): Promise<void> {
  const logId = logStart(source, scope);
  try {
    await fn();
    logFinish(logId, true);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[sync] ${source}/${scope} failed:`, msg);
    logFinish(logId, false, msg);
    syncState.lastError = `${scope}: ${msg}`;
  }
}

interface IdRow { id: number }

function trackedTitleIds(where: string): number[] {
  const rows = getDb()
    .prepare(`SELECT t.id FROM titles t JOIN user_state us ON us.title_id = t.id WHERE ${where}`)
    .all() as IdRow[];
  return rows.map((r) => r.id);
}

/** Per-title loop where one failure never aborts the batch. */
async function eachTitle(ids: number[], fn: (id: number) => Promise<void>): Promise<void> {
  syncState.total += ids.length;
  for (const id of ids) {
    try {
      await fn(id);
    } catch (err) {
      console.error(`[sync] title ${id} failed:`, (err as Error).message);
    }
    syncState.done += 1;
  }
}

// ---- cached list refreshers ----

const DAY = 86400_000;
const HOUR = 3600_000;

export async function refreshTheaterLists(force = false): Promise<void> {
  if (!tmdb.tmdbConfigured()) return;
  const region = getSetting('region');
  if (force || !cacheGet(`tmdb_now_playing:${region}`, DAY)?.fresh) {
    cacheSet(`tmdb_now_playing:${region}`, await tmdb.nowPlaying(region));
  }
  if (force || !cacheGet(`tmdb_upcoming:${region}`, DAY)?.fresh) {
    cacheSet(`tmdb_upcoming:${region}`, await tmdb.upcoming(region));
  }
}

export async function refreshTvmazeSchedule(date: string, force = false): Promise<unknown> {
  const country = getSetting('schedule_country');
  const key = `tvmaze_schedule:${country}:${date}`;
  const cached = cacheGet(key, 6 * HOUR);
  if (!force && cached?.fresh) return cached.payload;
  try {
    const airings = await tvmaze.schedule(country, date);
    cacheSet(key, airings);
    return airings;
  } catch (err) {
    if (cached) return cached.payload; // offline: serve stale
    throw err;
  }
}

// ---- the three cron bodies ----

/** Hourly: shows airing today + TVmaze schedule for today/tomorrow. */
export async function runHourly(): Promise<void> {
  await scoped('tvmaze', 'hourly:schedule', async () => {
    await refreshTvmazeSchedule(localToday());
    await refreshTvmazeSchedule(localToday(1));
  });
  await scoped('tmdb', 'hourly:airing-today', async () => {
    if (!tmdb.tmdbConfigured()) return;
    const today = localToday();
    const ids = getDb()
      .prepare(`
        SELECT DISTINCT t.id FROM titles t
        JOIN user_state us ON us.title_id = t.id AND us.status IN ('watching','wishlist','paused')
        JOIN seasons s ON s.title_id = t.id
        JOIN episodes e ON e.season_id = s.id
        WHERE t.media_type = 'tv' AND e.air_date IN (?, ?)
      `)
      .all(today, localToday(1))
      .map((r) => (r as IdRow).id);
    await eachTitle(ids, refreshTitle);
    emitTonightEvents();
  });
}

/** Daily (~4am): metadata for non-ended titles, providers for everything tracked, theater lists. */
export async function runDaily(): Promise<void> {
  if (!tmdb.tmdbConfigured()) return;
  await scoped('tmdb', 'daily:metadata', async () => {
    const ids = trackedTitleIds(
      "us.status NOT IN ('dropped') AND (t.status_upstream IS NULL OR t.status_upstream NOT IN ('Ended','Canceled'))",
    );
    await eachTitle(ids, refreshTitle);
  });
  await scoped('tmdb', 'daily:providers', async () => {
    // Ended/canceled titles still gain and lose providers; sweep everything.
    const ids = trackedTitleIds("us.status IN ('dropped','watched') OR t.status_upstream IN ('Ended','Canceled')");
    await eachTitle(ids, refreshProviders);
  });
  await scoped('tmdb', 'daily:theater-lists', () => refreshTheaterLists(true));
  await scoped('app', 'daily:events', async () => emitTonightEvents());
}

/** Weekly: OMDb ratings (oldest first, quota-aware) + metadata for ended titles. */
export async function runWeekly(): Promise<void> {
  await scoped('omdb', 'weekly:ratings', async () => {
    if (!omdb.omdbConfigured()) return;
    const cutoff = new Date(Date.now() - 7 * DAY).toISOString();
    const ids = getDb()
      .prepare(`
        SELECT id FROM titles
        WHERE imdb_id IS NOT NULL AND (ratings_refreshed_at IS NULL OR ratings_refreshed_at < ?)
        ORDER BY ratings_refreshed_at IS NOT NULL, ratings_refreshed_at ASC
      `)
      .all(cutoff)
      .map((r) => (r as IdRow).id);
    for (const id of ids) {
      if (omdb.omdbQuotaRemaining() <= 0) {
        console.warn('[sync] OMDb budget exhausted; remaining titles deferred to next run');
        break;
      }
      await refreshRatings(id);
    }
  });
  await scoped('tmdb', 'weekly:ended-metadata', async () => {
    if (!tmdb.tmdbConfigured()) return;
    const ids = trackedTitleIds("t.status_upstream IN ('Ended','Canceled')");
    await eachTitle(ids, refreshTitle);
  });
}

// ---- manual + scheduling ----

async function withState(scope: string, fn: () => Promise<void>): Promise<void> {
  if (syncState.running) return;
  syncState.running = true;
  syncState.scope = scope;
  syncState.done = 0;
  syncState.total = 0;
  syncState.startedAt = nowIso();
  syncState.lastError = null;
  try {
    await fn();
  } finally {
    syncState.running = false;
    syncState.scope = null;
    syncState.lastFinishedAt = nowIso();
  }
}

export function kickGlobalRefresh(): boolean {
  if (syncState.running) return false;
  void withState('manual:global', async () => {
    await runDaily();
    await runHourly();
  });
  return true;
}

export async function refreshOneTitle(titleId: number): Promise<void> {
  await scoped('tmdb', `manual:title:${titleId}`, () => refreshTitle(titleId));
}

export function startCron(): void {
  cron.schedule('5 * * * *', () => void withState('cron:hourly', runHourly));
  cron.schedule('0 4 * * *', () => void withState('cron:daily', runDaily));
  cron.schedule('30 4 * * 0', () => void withState('cron:weekly', runWeekly));
  console.log('[sync] cron scheduled (hourly :05, daily 04:00, weekly Sun 04:30)');
}
