import assert from 'node:assert/strict';
import { config } from '../server/dist/config.js';
import * as tmdb from '../server/dist/sources/tmdb.js';
import { closeHttp } from '../server/dist/http.js';

if (!config.tmdbKey) throw new Error('Set TMDB_API_KEY to run the opt-in live check.');
try {
  for (const params of [{ with_original_language: 'ko', with_genres: '18' }, { with_original_language: 'ja', with_genres: '16' }]) {
    const page = await tmdb.discover('tv', { ...params, page: '1', sort_by: 'popularity.desc' });
    assert.ok(page.results.length > 0 && page.total_pages > 1, 'Live genre should span multiple catalog pages');
  }
  const providers = await tmdb.providerList('US');
  assert.ok(providers.length > 10, 'Live catalog should include many streaming sources');
  console.log('Live TMDB genre and multi-provider smoke checks passed.');
} finally { await closeHttp(); }
