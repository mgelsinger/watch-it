import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, dbPath, allSettings, setSetting, getSetting, cacheGet, cacheSet } from '../db.js';
import { config, localToday } from '../config.js';
import { fetchBytes } from '../http.js';
import * as tmdb from '../sources/tmdb.js';
import * as omdb from '../sources/omdb.js';
import * as tvmaze from '../sources/tvmaze.js';
import { syncState, kickGlobalRefresh, refreshTvmazeSchedule, refreshTheaterLists } from '../services/sync.js';
import * as q from '../services/queries.js';

const EXPORT_TABLES = [
  'titles', 'user_state', 'seasons', 'episodes', 'cast_members',
  'availability', 'my_services', 'events', 'settings',
] as const;

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    getDb().prepare('SELECT 1').get();
    return { ok: true, version: '1.0.0' };
  });

  // ---- home ----
  app.get('/api/home', async () => {
    // Populate theater lists on first view if the daily job hasn't run yet.
    if (tmdb.tmdbConfigured()) {
      try {
        await refreshTheaterLists();
      } catch (err) {
        console.warn('[home] theater lists refresh failed (serving cache):', (err as Error).message);
      }
    }
    const theaters = q.theaterRows();
    return {
      continue_watching: q.continueWatching(),
      new_tonight: q.newTonight(),
      returning_soon: q.returningSoon(),
      wishlist_available: q.wishlistAvailable(),
      now_streaming: q.nowStreamingRow(),
      in_theaters: theaters.inTheaters,
      coming_soon: theaters.comingSoon,
      recently_watched: q.recentlyWatched(),
    };
  });

  app.get<{ Querystring: { year?: string; type?: string } }>('/api/history', async (req) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const type = req.query.type === 'movie' || req.query.type === 'tv' ? req.query.type : undefined;
    return q.history({ year, type });
  });

  // ---- schedule (TVmaze) ----
  app.get<{ Querystring: { date?: string } }>('/api/schedule', async (req, reply) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date ?? '') ? req.query.date! : localToday();
    let airings: unknown;
    try {
      airings = await refreshTvmazeSchedule(date);
    } catch (err) {
      return reply.code(502).send({ error: `TVmaze unavailable: ${(err as Error).message}` });
    }
    // Match followed shows by IMDb id or (fallback) exact name.
    const db = getDb();
    const followed = db
      .prepare(`
        SELECT t.id, t.imdb_id, LOWER(t.name) AS lname FROM titles t
        JOIN user_state us ON us.title_id = t.id AND us.status IN ('watching','wishlist','paused')
        WHERE t.media_type = 'tv'
      `)
      .all() as { id: number; imdb_id: string | null; lname: string }[];
    const byImdb = new Map(followed.filter((f) => f.imdb_id).map((f) => [f.imdb_id!, f.id]));
    const byName = new Map(followed.map((f) => [f.lname, f.id]));
    const items = (Array.isArray(airings) ? airings : []).map((a) => {
      const e = a as Record<string, any>;
      const show = e.show ?? {};
      const imdb = show.externals?.imdb ?? null;
      return {
        airtime: e.airtime ?? '',
        airdate: e.airdate ?? date,
        episode_name: e.name ?? null,
        season: e.season ?? null,
        number: e.number ?? null,
        runtime: e.runtime ?? null,
        show_name: show.name ?? '(unknown)',
        show_type: show.type ?? null,
        network: show.network?.name ?? show.webChannel?.name ?? 'Other',
        imdb_id: imdb,
        image: show.image?.medium ?? null,
        library_id: (imdb && byImdb.get(imdb)) || byName.get(String(show.name ?? '').toLowerCase()) || null,
      };
    });
    return { date, country: getSetting('schedule_country'), items };
  });

  // ---- events feed ----
  app.get<{ Querystring: { unseen?: string } }>('/api/events', async (req) => {
    const db = getDb();
    const where = req.query.unseen === '1' ? 'WHERE ev.seen = 0' : '';
    const events = db
      .prepare(`
        SELECT ev.*, t.name AS title_name, t.poster_path, t.media_type
        FROM events ev LEFT JOIN titles t ON t.id = ev.title_id
        ${where}
        ORDER BY ev.created_at DESC, ev.id DESC LIMIT 200
      `)
      .all();
    const unseen = (db.prepare('SELECT COUNT(*) AS n FROM events WHERE seen = 0').get() as { n: number }).n;
    return { events, unseen };
  });

  app.post('/api/events/seen', async (req) => {
    const body = z.object({ ids: z.array(z.number()).optional(), all: z.boolean().optional() }).parse(req.body ?? {});
    const db = getDb();
    if (body.all) db.prepare('UPDATE events SET seen = 1').run();
    else if (body.ids?.length) {
      db.prepare(`UPDATE events SET seen = 1 WHERE id IN (${body.ids.map(() => '?').join(',')})`).run(...body.ids);
    }
    return { ok: true };
  });

  // ---- settings ----
  app.get('/api/settings', async () => {
    let dbSize = 0;
    try {
      dbSize = fs.statSync(dbPath()).size;
    } catch { /* first boot */ }
    return {
      settings: allSettings(),
      keys: { tmdb: tmdb.tmdbConfigured(), omdb: omdb.omdbConfigured() },
      omdb_quota_remaining: omdb.omdbConfigured() ? omdb.omdbQuotaRemaining() : null,
      db: { path: dbPath(), size_bytes: dbSize },
    };
  });

  app.put('/api/settings', async (req) => {
    const body = z.record(z.string()).parse(req.body);
    const allowed = new Set(['region', 'schedule_country', 'theme']);
    for (const [k, v] of Object.entries(body)) {
      if (allowed.has(k)) setSetting(k, v);
    }
    return { settings: allSettings() };
  });

  app.post<{ Params: { source: string } }>('/api/settings/test/:source', async (req, reply) => {
    const source = req.params.source;
    try {
      if (source === 'tmdb') await tmdb.testKey();
      else if (source === 'omdb') await omdb.testKey();
      else if (source === 'tvmaze') await tvmaze.testApi();
      else return reply.code(400).send({ ok: false, error: 'unknown source' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // ---- my services / provider list ----
  app.get('/api/providers', async () => {
    const region = getSetting('region');
    const key = `tmdb_providers:${region}`;
    let cached = cacheGet(key, 7 * 86400_000);
    if (!cached?.fresh && tmdb.tmdbConfigured()) {
      try {
        cacheSet(key, await tmdb.providerList(region));
        cached = cacheGet(key, Infinity);
      } catch (err) {
        console.warn('[providers] list refresh failed:', (err as Error).message);
      }
    }
    const enabled = new Set(
      (getDb().prepare('SELECT provider_id FROM my_services WHERE enabled = 1').all() as { provider_id: number }[]).map((r) => r.provider_id),
    );
    const list = ((cached?.payload as any[]) ?? []).map((p) => ({ ...p, enabled: enabled.has(p.provider_id) }));
    return { region, providers: list };
  });

  app.put('/api/my-services', async (req) => {
    const body = z.object({
      provider_id: z.number(),
      provider_name: z.string(),
      logo_path: z.string().nullish(),
      enabled: z.boolean(),
    }).parse(req.body);
    getDb()
      .prepare(`
        INSERT INTO my_services (provider_id, provider_name, logo_path, enabled) VALUES (?, ?, ?, ?)
        ON CONFLICT(provider_id) DO UPDATE SET enabled = excluded.enabled, provider_name = excluded.provider_name, logo_path = excluded.logo_path
      `)
      .run(body.provider_id, body.provider_name, body.logo_path ?? null, body.enabled ? 1 : 0);
    return { ok: true };
  });

  // ---- sync ----
  app.post('/api/sync/run', async () => {
    const started = kickGlobalRefresh();
    return { started, state: syncState };
  });

  app.get('/api/sync/status', async () => {
    const log = getDb().prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 50').all();
    return { state: syncState, log };
  });

  // ---- export / import ----
  app.get('/api/export', async (_req, reply) => {
    const db = getDb();
    const dump: Record<string, unknown> = { app: 'watch-it', version: 1, exported_at: new Date().toISOString() };
    for (const table of EXPORT_TABLES) dump[table] = db.prepare(`SELECT * FROM ${table}`).all();
    reply.header('content-disposition', `attachment; filename="watch-it-export-${localToday()}.json"`);
    return dump;
  });

  app.post('/api/import', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (!body || body.app !== 'watch-it' || !Array.isArray(body.titles)) {
      return reply.code(400).send({ error: 'not a watch-it export file' });
    }
    const db = getDb();
    const run = db.transaction(() => {
      for (const table of [...EXPORT_TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run();
      for (const table of EXPORT_TABLES) {
        const rows = body[table];
        if (!Array.isArray(rows)) continue;
        for (const row of rows as Record<string, unknown>[]) {
          const cols = Object.keys(row);
          db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
            .run(...cols.map((c) => row[c]));
        }
      }
    });
    run();
    return { ok: true, titles: (body.titles as unknown[]).length };
  });

  // ---- local image cache: /img/<size>/<file> proxies image.tmdb.org and stores on disk,
  // so posters keep working offline once seen. ----
  const SIZES = new Set(['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'w1280', 'h632', 'original']);
  app.get<{ Params: { size: string; file: string } }>('/img/:size/:file', async (req, reply) => {
    const { size, file } = req.params;
    if (!SIZES.has(size) || !/^[A-Za-z0-9]+\.(jpg|png|svg)$/.test(file)) {
      return reply.code(400).send({ error: 'bad image path' });
    }
    const dir = path.join(config.dataDir, 'img', size);
    const local = path.join(dir, file);
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg';
    reply.header('cache-control', 'public, max-age=604800');
    if (fs.existsSync(local)) return reply.type(type).send(fs.createReadStream(local));
    try {
      const got = await fetchBytes('image', `https://image.tmdb.org/t/p/${size}/${file}`);
      if (!got) return reply.code(404).send({ error: 'image not found' });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(local, got.bytes);
      return reply.type(type).send(got.bytes);
    } catch {
      return reply.code(502).send({ error: 'image fetch failed' });
    }
  });
}
