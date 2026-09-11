import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, dbPath, allSettings, setSetting, getSetting, cacheGet } from '../db.js';
import { config, localToday } from '../config.js';
import { fetchBytes } from '../http.js';
import * as tmdb from '../sources/tmdb.js';
import * as omdb from '../sources/omdb.js';
import * as tvmaze from '../sources/tvmaze.js';
import { syncState, kickGlobalRefresh, refreshTvmazeSchedule, refreshDiscoveryLists, discoveryCacheKeys } from '../services/sync.js';
import * as q from '../services/queries.js';
import { createBackup, inspectBackup, restoreBackup } from '../services/backup.js';
import { regionalProviders } from '../services/providers.js';
import { APP_VERSION } from '../version.js';
import { REGIONS } from '../regions.js';
import { diagnostics } from '../services/maintenance.js';
import { credentialManaged, saveCredential, validateCredential } from '../services/credentials.js';

function saveSafetyBackup(): string {
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `before-restore-${stamp}.watchit.json`;
  const bytes = JSON.stringify(createBackup(getDb()), null, 2);
  const space = fs.statfsSync(dir);
  if (space.bavail * space.bsize < Buffer.byteLength(bytes) * 2 + 1024 * 1024) throw new Error('Not enough free storage for a safety backup.');
  const temporary = path.join(dir, `${filename}.tmp`);
  fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, path.join(dir, filename));
  const existing = fs.readdirSync(dir)
    .filter((name) => name.startsWith('before-restore-') && name.endsWith('.watchit.json'))
    .sort()
    .reverse();
  for (const old of existing.slice(5)) fs.rmSync(path.join(dir, old));
  return filename;
}

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  let keyChecks: number[] = [];
  const allowKeyCheck = () => {
    const now = Date.now();
    keyChecks = keyChecks.filter((time) => now - time < 60_000);
    if (keyChecks.length >= 12) return false;
    keyChecks.push(now);
    return true;
  };
  app.get('/api/diagnostics', async () => ({ ...diagnostics(), sync_running: syncState.running, last_sync_at: syncState.lastFinishedAt }));
  app.get('/api/health', { config: { public: true } }, async () => {
    getDb().prepare('SELECT 1').get();
    return { ok: true, version: APP_VERSION };
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
  app.put('/api/settings/keys/:source', { bodyLimit: 2048 }, async (req, reply) => {
    // A custom header prevents cross-origin form writes, including on local installs without login.
    if (req.headers['x-watch-it-settings'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: 'Save keys from Watch It Settings on this installation.' });
    }
    const source = z.enum(['tmdb', 'omdb']).parse((req.params as { source: string }).source);
    if (credentialManaged(source)) return reply.code(409).send({ error: 'This key is managed by the installation environment.' });
    const body = z.object({ key: z.string().trim().max(128) }).strict().parse(req.body);
    if (body.key) {
      const valid = source === 'tmdb' ? /^[a-fA-F0-9]{32}$/.test(body.key) : /^[a-zA-Z0-9]{4,64}$/.test(body.key);
      if (!valid) return reply.code(400).send({ error: source === 'tmdb' ? 'Paste the 32-character TMDB API Key, not the API Read Access Token.' : 'Paste the OMDb key from your activation email.' });
      if (!allowKeyCheck()) return reply.header('retry-after', '60').code(429).send({ error: 'Too many key checks. Wait one minute and try again.' });
      if (source === 'omdb') await omdb.testKey(body.key);
      else await validateCredential(source, body.key);
    }
    saveCredential(source, body.key);
    return { ok: true, configured: Boolean(body.key) };
  });
  app.get('/api/settings', async () => {
    let dbSize = 0;
    try {
      dbSize = fs.statSync(dbPath()).size;
    } catch { /* first boot */ }
    return {
      settings: allSettings(),
      supported_regions: REGIONS,
      keys: { tmdb: tmdb.tmdbConfigured(), omdb: omdb.omdbConfigured() },
      managed_keys: { tmdb: credentialManaged('tmdb'), omdb: credentialManaged('omdb') },
      omdb_quota_remaining: omdb.omdbConfigured() ? omdb.omdbQuotaRemaining() : null,
      db: { path: dbPath(), size_bytes: dbSize },
    };
  });

  app.put('/api/settings', async (req) => {
    const body = z.object({
      region: z.enum(REGIONS).optional(), schedule_country: z.enum(REGIONS).optional(),
      broadcast_networks: z.string().max(200).regex(/^\d+(?:\|\d+)*$/).optional(),
      pick_constraints: z.string().max(16_000).optional(),
    }).strict().parse(req.body);
    getDb().transaction(() => {
      for (const [k, v] of Object.entries(body)) if (v !== undefined) setSetting(k, v);
    })();
    return { settings: allSettings() };
  });

  app.post<{ Params: { source: string } }>('/api/settings/test/:source', async (req, reply) => {
    const source = req.params.source;
    if (!allowKeyCheck()) return reply.header('retry-after', '60').code(429).send({ error: 'Too many key checks. Wait one minute and try again.' });
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
    const providers = await regionalProviders();
    const enabled = new Set(
      (getDb().prepare('SELECT provider_id FROM my_services WHERE enabled = 1').all() as { provider_id: number }[]).map((r) => r.provider_id),
    );
    const list = providers.map((p) => ({ ...p, enabled: enabled.has(p.provider_id) }));
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

  app.post('/api/backup/inspect', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    try {
      const { preview } = inspectBackup(req.body);
      return { ok: true, preview };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/backup/restore', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    if (syncState.running) return reply.code(409).send({ error: 'Wait for the current refresh to finish before restoring a profile.' });
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
