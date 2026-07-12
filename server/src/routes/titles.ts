import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db.js';
import { nowIso } from '../config.js';
import * as tmdb from '../sources/tmdb.js';
import { addTitle, ensureTitlePreview, hydrateCastImdbIds, type MediaType, type UserStatus } from '../services/library.js';
import { refreshOneTitle } from '../services/sync.js';
import { titleDetail, libraryList } from '../services/queries.js';
import { setSuggestionSuppressed } from '../services/pick.js';
import { similarTitles } from '../services/browse.js';

const AddBodyZ = z.object({
  tmdb_id: z.number(),
  media_type: z.enum(['movie', 'tv']),
  status: z.enum(['saved', 'wishlist', 'watching', 'watched', 'dropped', 'paused']).default('wishlist'),
});

const StateBodyZ = z.object({
  status: z.enum(['saved', 'wishlist', 'watching', 'watched', 'dropped', 'paused']).optional(),
  user_rating: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
  watched: z.boolean().optional(), // movies only
  never_suggest: z.boolean().optional(), // excludes the title from Pick For Me
});

export async function titleRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>('/api/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (!q) return { results: [] };
    if (!tmdb.tmdbConfigured()) return reply.code(503).send({ error: 'TMDB API key is not configured' });
    const raw = await tmdb.searchMulti(q);
    const db = getDb();
    const inLib = db.prepare(`
      SELECT t.id FROM titles t JOIN user_state us ON us.title_id = t.id
      WHERE t.tmdb_id = ? AND t.media_type = ?
    `);
    const results = [];
    for (const entry of raw) {
      const parsed = tmdb.SearchResultZ.safeParse(entry);
      if (!parsed.success) continue;
      const r = parsed.data;
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      const lib = inLib.get(r.id, r.media_type) as { id: number } | undefined;
      results.push({
        tmdb_id: r.id,
        media_type: r.media_type,
        name: r.title ?? r.name ?? '(untitled)',
        year: Number((r.release_date ?? r.first_air_date ?? '').slice(0, 4)) || null,
        poster_path: r.poster_path ?? null,
        tmdb_rating: r.vote_average ?? null,
        overview: r.overview ?? null,
        library_id: lib?.id ?? null,
      });
    }
    return { results };
  });

  app.post('/api/titles', async (req, reply) => {
    const body = AddBodyZ.parse(req.body);
    const id = await addTitle(body.tmdb_id, body.media_type as MediaType, body.status as UserStatus);
    return reply.code(201).send(titleDetail(id));
  });

  app.post('/api/titles/preview', async (req, reply) => {
    const body = z.object({
      tmdb_id: z.number().int().positive(),
      media_type: z.enum(['movie', 'tv']),
    }).parse(req.body);
    const id = await ensureTitlePreview(body.tmdb_id, body.media_type);
    return reply.code(200).send(titleDetail(id));
  });

  // Add from TVmaze schedule (IMDb id preferred, falls back to name search).
  app.post('/api/titles/from-external', async (req, reply) => {
    const body = z.object({ imdb_id: z.string().nullish(), name: z.string() }).parse(req.body);
    let found: { tmdbId: number; mediaType: 'movie' | 'tv' } | null = null;
    if (body.imdb_id) found = await tmdb.findByImdb(body.imdb_id);
    if (!found) {
      const results = await tmdb.searchTv(body.name);
      if (results[0]) found = { tmdbId: results[0].id, mediaType: 'tv' };
    }
    if (!found) return reply.code(404).send({ error: `TMDB has no match for "${body.name}"` });
    const id = await addTitle(found.tmdbId, found.mediaType, 'wishlist');
    return reply.code(201).send(titleDetail(id));
  });

  app.get<{ Querystring: { status?: string } }>('/api/titles', async (req) => {
    return { titles: libraryList(req.query.status) };
  });

  app.get<{ Params: { id: string } }>('/api/titles/:id', async (req, reply) => {
    const detail = titleDetail(Number(req.params.id));
    if (!detail) return reply.code(404).send({ error: 'title not found' });
    return detail;
  });

  app.get<{ Params: { id: string } }>('/api/titles/:id/similar', async (req, reply) => {
    const title = getDb().prepare('SELECT tmdb_id, media_type FROM titles WHERE id = ?')
      .get(Number(req.params.id)) as { tmdb_id: number; media_type: MediaType } | undefined;
    if (!title) return reply.code(404).send({ error: 'title not found' });
    try {
      return await similarTitles(title.media_type, title.tmdb_id);
    } catch (err) {
      return reply.code(502).send({ error: `Similar titles are unavailable: ${(err as Error).message}` });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/titles/:id', async (req, reply) => {
    const res = getDb().prepare('DELETE FROM titles WHERE id = ?').run(Number(req.params.id));
    if (res.changes === 0) return reply.code(404).send({ error: 'title not found' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/titles/:id/refresh', async (req, reply) => {
    const id = Number(req.params.id);
    await refreshOneTitle(id);
    const detail = titleDetail(id);
    if (!detail) return reply.code(404).send({ error: 'title not found' });
    return detail;
  });

  // Lazy IMDb person-id hydration, called once by the detail page.
  app.post<{ Params: { id: string } }>('/api/titles/:id/cast-imdb', async (req) => {
    const id = Number(req.params.id);
    await hydrateCastImdbIds(id);
    return { cast: getDb().prepare('SELECT * FROM cast_members WHERE title_id = ? ORDER BY ord').all(id) };
  });

  app.patch<{ Params: { id: string } }>('/api/titles/:id/state', async (req, reply) => {
    const id = Number(req.params.id);
    const body = StateBodyZ.parse(req.body);
    const db = getDb();
    const existing = db.prepare('SELECT title_id FROM user_state WHERE title_id = ?').get(id);
    if (!existing) {
      db.prepare('INSERT INTO user_state (title_id, status, updated_at) VALUES (?, ?, ?)').run(id, body.status ?? 'wishlist', nowIso());
    }
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [nowIso()];
    if (body.status !== undefined) {
      sets.push('status = ?');
      vals.push(body.status);
    }
    if (body.user_rating !== undefined) {
      sets.push('user_rating = ?');
      vals.push(body.user_rating);
    }
    if (body.notes !== undefined) {
      sets.push('notes = ?');
      vals.push(body.notes);
    }
    if (body.never_suggest !== undefined) {
      sets.push('never_suggest = ?');
      vals.push(body.never_suggest ? 1 : 0);
    }
    if (body.watched !== undefined) {
      sets.push('watched_at = ?');
      vals.push(body.watched ? nowIso() : null);
      if (body.watched && body.status === undefined) {
        sets.push("status = 'watched'");
      }
    }
    db.prepare(`UPDATE user_state SET ${sets.join(', ')} WHERE title_id = ?`).run(...vals, id);
    if (body.never_suggest !== undefined) {
      const title = db.prepare('SELECT tmdb_id, media_type FROM titles WHERE id = ?').get(id) as
        | { tmdb_id: number; media_type: MediaType }
        | undefined;
      if (title) setSuggestionSuppressed(title.media_type, title.tmdb_id, body.never_suggest);
    }
    const detail = titleDetail(id);
    if (!detail) return reply.code(404).send({ error: 'title not found' });
    return detail;
  });

  app.delete<{ Params: { id: string } }>('/api/titles/:id/state', async (req, reply) => {
    const id = Number(req.params.id);
    const db = getDb();
    const title = db.prepare('SELECT id FROM titles WHERE id = ?').get(id);
    if (!title) return reply.code(404).send({ error: 'title not found' });
    db.prepare('DELETE FROM user_state WHERE title_id = ?').run(id);
    const detail = titleDetail(id);
    if (!detail) return reply.code(404).send({ error: 'title not found' });
    return detail;
  });

  app.patch<{ Params: { id: string } }>('/api/episodes/:id/watched', async (req, reply) => {
    const body = z.object({ watched: z.boolean() }).parse(req.body);
    const res = getDb()
      .prepare('UPDATE episodes SET watched_at = ? WHERE id = ?')
      .run(body.watched ? nowIso() : null, Number(req.params.id));
    if (res.changes === 0) return reply.code(404).send({ error: 'episode not found' });
    return { ok: true, watched: body.watched };
  });

  // Season-level "mark all watched" (only aired episodes when watched=true).
  app.patch<{ Params: { id: string } }>('/api/seasons/:id/watched', async (req, reply) => {
    const body = z.object({ watched: z.boolean() }).parse(req.body);
    const db = getDb();
    const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(Number(req.params.id));
    if (!season) return reply.code(404).send({ error: 'season not found' });
    if (body.watched) {
      db.prepare(`
        UPDATE episodes SET watched_at = ?
        WHERE season_id = ? AND watched_at IS NULL AND air_date IS NOT NULL AND air_date <= date('now','localtime')
      `).run(nowIso(), Number(req.params.id));
    } else {
      db.prepare('UPDATE episodes SET watched_at = NULL WHERE season_id = ?').run(Number(req.params.id));
    }
    return { ok: true };
  });
}
