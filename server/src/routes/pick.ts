import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db.js';
import { pickNext, logSuggestion, type PickConstraints } from '../services/pick.js';

const ConstraintsZ = z.object({
  time: z.number().int().min(1).max(600).nullable().default(60),
  type: z.enum(['episode', 'movie', 'either']).default('either'),
  genres: z.array(z.string()).default([]),
  my_services_only: z.boolean().default(true),
  include_rent_buy: z.boolean().default(false),
  unwatched_only: z.boolean().default(true),
  bingeable_only: z.boolean().default(false),
});

export async function pickRoutes(app: FastifyInstance): Promise<void> {
  // Everything here is local SQLite — no external calls, works offline.
  app.post('/api/pick/next', async (req) => {
    const body = z
      .object({
        constraints: ConstraintsZ.default({}),
        exclude: z.array(z.number()).default([]), // title ids already shown this session
      })
      .parse(req.body ?? {});
    return pickNext(body.constraints as PickConstraints, body.exclude);
  });

  app.post('/api/pick/log', async (req, reply) => {
    const body = z
      .object({
        title_id: z.number(),
        episode_id: z.number().nullish(),
        action: z.enum(['accepted', 'shuffled', 'skipped']),
        constraints: z.unknown().optional(),
      })
      .parse(req.body);
    const exists = getDb().prepare('SELECT id FROM titles WHERE id = ?').get(body.title_id);
    if (!exists) return reply.code(404).send({ error: 'title not found' });
    logSuggestion(body.title_id, body.episode_id ?? null, body.action, body.constraints);
    return { ok: true };
  });
}
