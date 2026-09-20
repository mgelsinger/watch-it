import { before, beforeEach, after, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { cacheSet, closeDb, getDb, migrate } from '../src/db.js';
import { pickNext, type PickConstraints } from '../src/services/pick.js';

const constraints: PickConstraints = { time: 45, type: 'tv', genres: ['comedy'], my_services_only: true, include_rent_buy: false, exclude_library_titles: true };
before(() => { config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-pick-test-')); config.tmdbKey = 'fixture'; migrate(); });
beforeEach(() => {
  getDb().exec('DELETE FROM titles; DELETE FROM api_cache; DELETE FROM suggestion_log; DELETE FROM my_services; DELETE FROM settings');
  getDb().prepare('INSERT INTO my_services(provider_id, enabled) VALUES (8, 1)').run();
  cacheSet('tmdb_genres_merged', [{ key: 'comedy', name: 'Comedy', movie_ids: [35], tv_ids: [35], names: ['Comedy'] }]);
});
after(closeDb);

function mockCatalog(t: TestContext, runtime: number | null, offer = true) {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input)); requests.push(url);
    if (url.pathname.includes('/discover/')) return Response.json({ results: [{ id: 42, name: 'Light fixture', title: 'Light fixture', genre_ids: [35], vote_average: 8, popularity: 10 }], page: 1, total_pages: 50 });
    if (url.pathname.endsWith('/watch/providers')) return Response.json({ results: { US: { flatrate: offer ? [{ provider_id: 8, provider_name: 'Netflix' }] : [], link: 'https://www.themoviedb.org/tv/42/watch?locale=US' } } });
    return Response.json({ id: 42, name: 'Light fixture', title: 'Light fixture', genres: [{ id: 35, name: 'Comedy' }], runtime, episode_run_time: runtime === null ? [] : [runtime] });
  });
  return requests;
}

test('45 minutes, subscribed services and comedy produce supported reasons and regional watch options', async (t) => {
  const requests = mockCatalog(t, 24);
  const result = await pickNext(constraints, []);
  assert.ok(result.candidate);
  assert.equal(result.candidate.runtime, 24);
  assert.equal(result.candidate.runtime_estimated, false);
  assert.match(result.candidate.reasons.join(' '), /within your 45 min limit/);
  assert.match(result.candidate.reasons.join(' '), /Listed on Netflix in US/);
  assert.match(result.candidate.reasons.join(' '), /Catalog filter: comedy/);
  assert.ok(!result.candidate.reasons.join(' ').includes('Matches your mood'));
  assert.match(result.candidate.watch_url!, /locale=US/);
  for (const url of requests.filter((item) => item.pathname.includes('/discover/'))) {
    assert.equal(url.searchParams.get('with_runtime.lte'), '45');
    assert.equal(url.searchParams.get('with_genres'), '35');
    assert.equal(url.searchParams.get('with_watch_providers'), '8');
  }
});

for (const runtime of [null, 0, 46]) test(`strict time budget skips ${runtime === null ? 'missing' : runtime}-minute runtimes`, async (t) => {
  mockCatalog(t, runtime);
  const result = await pickNext(constraints, []);
  assert.equal(result.candidate, null); assert.match(result.empty!.message, /runtime/);
  assert.ok(result.empty!.loosen.some((option) => option.patch.time === null));
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM suggestion_log').get() as { n: number }).n, 0);
});

test('150 minutes remains a limit; unknown runtime only qualifies without a limit', async (t) => {
  const requests = mockCatalog(t, 151);
  assert.equal((await pickNext({ ...constraints, time: 150 }, [])).candidate, null);
  assert.ok(requests.filter((url) => url.pathname.includes('/discover/')).every((url) => url.searchParams.get('with_runtime.lte') === '150'));
  getDb().exec('DELETE FROM api_cache');
  t.mock.restoreAll(); mockCatalog(t, null);
  const result = await pickNext({ ...constraints, genres: [], time: null }, []);
  assert.equal(result.candidate?.runtime_estimated, true);
});

test('a missing series runtime uses explicit first-episode evidence and labels the basis', async (t) => {
  mockCatalog(t, null);
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/season/1')) return Response.json({ season_number: 1, episodes: [{ episode_number: 1, runtime: 33 }] });
    if (url.pathname === '/3/tv/42') return Response.json({ id: 42, name: 'Light fixture', episode_run_time: [], seasons: [{ season_number: 1 }] });
    return fetch(input, init);
  });
  const result = await pickNext(constraints, []);
  assert.equal(result.candidate?.runtime, 33);
  assert.equal(result.candidate?.runtime_basis, 'first_episode');
  assert.equal(result.candidate?.runtime_estimated, false);
  assert.match(result.candidate!.reasons.join(' '), /33 min first episode/);
});

test('missing offers never become an availability claim, and no subscriptions do not broaden the search', async (t) => {
  const requests = mockCatalog(t, 24, false);
  assert.equal((await pickNext(constraints, [])).candidate, null);
  getDb().exec('DELETE FROM my_services'); requests.length = 0;
  const result = await pickNext(constraints, []);
  assert.match(result.empty!.message, /Choose streaming services/);
  assert.equal(requests.length, 0);
});
