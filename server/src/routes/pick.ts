import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db.js';
import * as tmdb from '../sources/tmdb.js';
import { pickNext, logSuggestion, setSuggestionSuppressed, type PickConstraints } from '../services/pick.js';

const ConstraintsZ = z.object({
  time: z.number().int().min(1).max(600).nullable().default(60),
  type: z.enum(['tv', 'movie', 'either']).default('either'),
  genres: z.array(z.string()).default([]),
  my_services_only: z.boolean().default(false),
  excluded_provider_ids: z.array(z.number().int().positive().safe()).max(500).default([])
    .transform((ids) => [...new Set(ids)].sort((a, b) => a - b)),
  include_rent_buy: z.boolean().default(false),
  exclude_library_titles: z.boolean().default(true),
  prefer_english: z.boolean().default(false),
  include_adaptations: z.boolean().default(false),
});

export async function pickRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pick/next', async (req, reply) => {
    const body = z
      .object({
        constraints: ConstraintsZ.default({}),
        exclude: z.array(z.string()).default([]),
      })
      .parse(req.body ?? {});
    try {
      return await pickNext(body.constraints as PickConstraints, body.exclude);
    } catch (err) {
      const message = (err as Error).message;
      return reply.code(tmdb.tmdbConfigured() ? 502 : 503).send({
        error: tmdb.tmdbConfigured()
          ? `TMDB is unavailable and no cached recommendations match: ${message}`
          : 'TMDB API key is not configured and no cached recommendations are available',
      });
    }
  });

  app.post('/api/pick/log', async (req, reply) => {
    const body = z
      .object({
        tmdb_id: z.number().int().positive(),
        media_type: z.enum(['movie', 'tv']),
        title_id: z.number().int().positive().nullish(),
        action: z.enum(['accepted', 'shuffled', 'skipped']),
        constraints: z.unknown().optional(),
      })
      .parse(req.body);
    if (body.title_id) {
      const exists = getDb().prepare('SELECT id FROM titles WHERE id = ?').get(body.title_id);
      if (!exists) return reply.code(404).send({ error: 'title not found' });
    }
    logSuggestion(body.media_type, body.tmdb_id, body.title_id ?? null, body.action, body.constraints);
    return { ok: true };
  });

  app.put('/api/pick/suppress', async (req) => {
    const body = z.object({
      tmdb_id: z.number().int().positive(),
      media_type: z.enum(['movie', 'tv']),
      suppressed: z.boolean().default(true),
    }).parse(req.body);
    setSuggestionSuppressed(body.media_type, body.tmdb_id, body.suppressed);
    return { ok: true };
  });
}
