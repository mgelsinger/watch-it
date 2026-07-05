import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as tmdbSource from '../sources/tmdb.js';
import { getGenres, genreRow, discoverGrid, libraryGrid, type BrowseFilters } from '../services/browse.js';

const FiltersQ = z.object({
  type: z.enum(['movie', 'tv', 'both']).default('both'),
  genres: z.string().default(''), // csv of merged genre keys
  watch: z.enum(['any', 'my', 'streaming', 'broadcast']).default('any'),
  status: z.enum(['', 'returning', 'ended', 'canceled']).default(''),
  library: z.enum(['', 'not_added', 'wishlist', 'watching', 'watched', 'dropped']).default(''),
  year_min: z.coerce.number().int().min(1870).max(2100).optional(),
  year_max: z.coerce.number().int().min(1870).max(2100).optional(),
  rating: z.coerce.number().min(0).max(10).optional(),
  bingeable: z.string().optional(),
  sort: z.enum(['newest', 'rating', 'popular', 'az', 'added', 'watched']).default('newest'),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

function toFilters(q: z.infer<typeof FiltersQ>): BrowseFilters {
  return {
    type: q.type,
    genres: q.genres.split(',').map((s) => s.trim()).filter(Boolean),
    watch: q.watch,
    status: q.status,
    library: q.library,
    yearMin: q.year_min ?? null,
    yearMax: q.year_max ?? null,
    rating: q.rating ?? null,
    bingeable: q.bingeable === '1',
    sort: q.sort,
  };
}

export async function browseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/browse/genres', async (_req, reply) => {
    if (!tmdbSource.tmdbConfigured()) return reply.code(503).send({ error: 'TMDB API key is not configured' });
    try {
      return { genres: await getGenres() };
    } catch (err) {
      return reply.code(502).send({ error: `genre list unavailable: ${(err as Error).message}` });
    }
  });

  app.get<{ Querystring: { genre?: string } }>('/api/browse/row', async (req, reply) => {
    if (!tmdbSource.tmdbConfigured()) return reply.code(503).send({ error: 'TMDB API key is not configured' });
    const key = (req.query.genre ?? '').trim();
    if (!key) return reply.code(400).send({ error: 'genre is required' });
    try {
      const row = await genreRow(key);
      if (!row) return reply.code(404).send({ error: `unknown genre "${key}"` });
      return row;
    } catch (err) {
      return reply.code(502).send({ error: `TMDB unavailable: ${(err as Error).message}` });
    }
  });

  app.get('/api/browse/discover', async (req, reply) => {
    if (!tmdbSource.tmdbConfigured()) return reply.code(503).send({ error: 'TMDB API key is not configured' });
    const q = FiltersQ.parse(req.query);
    const f = toFilters(q);
    // Library-only sorts have no Discover equivalent.
    if (f.sort === 'added' || f.sort === 'watched') f.sort = 'newest';
    try {
      return await discoverGrid(f, q.page);
    } catch (err) {
      return reply.code(502).send({ error: `TMDB unavailable and nothing cached yet: ${(err as Error).message}` });
    }
  });

  app.get('/api/browse/library', async (req) => {
    const f = toFilters(FiltersQ.parse(req.query));
    return { items: await libraryGrid(f) };
  });
}
