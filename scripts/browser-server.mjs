import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// This entry point is only used by tests and is excluded from the release image.
process.env.WATCH_IT_LOAD_ENV = 'false';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-browser-'));
process.env.TMDB_API_KEY = '';
process.env.OMDB_API_KEY = '';
process.env.WATCH_IT_PASSWORD = 'browser-fixture-password';
process.env.WEB_DIST = path.resolve('web/dist');
// Fixture upstream only, so browser tests exercise the real API and database without external requests.
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const offers = { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }], link: 'https://www.themoviedb.org/tv/42/watch?locale=US' } };
  if (url.hostname !== 'api.themoviedb.org') return Response.json([]);
  if (url.searchParams.get('api_key') !== 'a'.repeat(32)) return Response.json({}, { status: 401 });
  if (url.pathname.endsWith('/configuration')) return Response.json({ images: {} });
  if (/\/genre\//.test(url.pathname)) return Response.json({ genres: [{ id: 35, name: 'Comedy' }] });
  if (/\/watch\/providers\/(tv|movie)$/.test(url.pathname)) return Response.json({ results: [{ provider_id: 8, provider_name: 'Netflix' }] });
  if (url.pathname.endsWith('/watch/providers')) return Response.json({ results: offers });
  if (url.pathname.includes('/discover/')) return Response.json({ results: [{ id: 42, name: 'Launch fixture', title: 'Launch fixture', genre_ids: [35], vote_average: 8, popularity: 10 }], page: 1, total_pages: 1 });
  if (url.pathname.includes('/season/')) return Response.json({ season_number: 1, name: 'Season 1', episodes: [1, 2, 3].map((episode_number) => ({ episode_number, name: `Episode ${episode_number}`, air_date: '2020-01-01', runtime: 24 })) });
  return Response.json({ id: 42, name: 'Launch fixture', title: 'Launch fixture', runtime: 24, episode_run_time: [24], genres: [{ id: 35, name: 'Comedy' }], seasons: [{ season_number: 1, episode_count: 3 }], 'watch/providers': { results: offers } });
};
const { createApp } = await import('../server/dist/app.js');
const { getDb, closeDb } = await import('../server/dist/db.js');
const app = await createApp({ logger: false });
getDb().prepare("INSERT INTO titles (id, tmdb_id, media_type, name, original_language) VALUES (1, 123, 'tv', 'Saved fixture', 'ja')").run();
getDb().prepare("INSERT INTO user_state (title_id, status, notes) VALUES (1, 'saved', 'Private fixture note')").run();
await app.listen({ host: '127.0.0.1', port: 8317 });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); closeDb(); });
