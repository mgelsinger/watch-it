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
import { syncState, kickGlobalRefresh, refreshTvmazeSchedule, refreshDiscoveryLists, discoveryCacheKeys } from '../services/sync.js';
import * as q from '../services/queries.js';
import { createBackup, inspectBackup, restoreBackup } from '../services/backup.js';

function saveSafetyBackup(): string {
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `before-restore-${stamp}.watchit.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(createBackup(getDb()), null, 2));
  const existing = fs.readdirSync(dir)
    .filter((name) => name.startsWith('before-restore-') && name.endsWith('.watchit.json'))
    .sort()
    .reverse();
  for (const old of existing.slice(5)) fs.rmSync(path.join(dir, old));
  return filename;
}

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    getDb().prepare('SELECT 1').get();
    return { ok: true, version: '1.0.0' };
  });

  // ---- home ----
  app.get('/api/home', async () => {
    // Discovery rows are stale-while-revalidate: serve the cache instantly and
    // refresh in the background. Only block on the very first view, when there
    // is no cache to serve yet.
    if (tmdb.tmdbConfigured()) {
      const keys = discoveryCacheKeys();
      const hasCache = [keys.movies, keys.tv, keys.disc].some((k) => cacheGet(k, Infinity) !== null);
      const refresh = refreshDiscoveryLists().catch((err) =>
        console.warn('[home] discovery lists refresh failed (serving cache):', (err as Error).message),
      );
      if (!hasCache) await refresh;
    }
    return {
      continue_watching: q.continueWatching(),
      new_tonight: q.newTonight(),
      returning_soon: q.returningSoon(),
      wishlist_available: q.wishlistAvailable(),
      saved_for_later: q.savedForLater(),
      now_streaming: q.nowStreamingRow(),
      new_on_services: await q.newOnServicesRow(),
      new_disc_digital: await q.newDiscDigitalRow(),
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
    const allowed = new Set([
      'region',
      'schedule_country',
      'broadcast_networks',
      'pick_constraints',
    ]);
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
      enabled: z.boolean(),
    }).parse(req.body);
    getDb()
      .prepare(`
        INSERT INTO my_services (provider_id, enabled) VALUES (?, ?)
        ON CONFLICT(provider_id) DO UPDATE SET enabled = excluded.enabled
      `)
      .run(body.provider_id, body.enabled ? 1 : 0);
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

  // ---- portable profile backup / restore ----
  const sendBackup = async (_req: unknown, reply: { header: (name: string, value: string) => unknown }) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="watch-it-profile-${localToday()}.watchit.json"`);
    return createBackup(getDb());
  };
  app.get('/api/backup/export', sendBackup);

  app.post('/api/backup/inspect', async (req, reply) => {
    try {
      const { preview } = inspectBackup(req.body);
      return { ok: true, preview };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/backup/restore', async (req, reply) => {
    const body = req.body as { backup?: unknown; mode?: unknown } | null;
    if (!body || (body.mode !== 'merge' && body.mode !== 'replace')) {
      return reply.code(400).send({ error: 'choose merge or replace before restoring' });
    }
    // Validate before taking a safety copy or changing the current profile.
    try {
      inspectBackup(body.backup);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const safety_backup = saveSafetyBackup();
    const preview = restoreBackup(getDb(), body.backup, body.mode);
    return { ok: true, mode: body.mode, preview, safety_backup };
  });

  // ---- local image cache: /img/<size>/<file> proxies image.tmdb.org and stores on disk,
  // so posters keep working offline once seen. ----
  const SIZES = new Set(['w45', 'w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'w1280', 'h632', 'original']);
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
