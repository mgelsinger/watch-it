import test, { before, beforeEach, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from '../src/config.js';
import { cacheSet, getDb, migrate, setSetting, getSetting } from '../src/db.js';
import { discoverGrid, libraryGrid, type BrowseFilters } from '../src/services/browse.js';
import { pickNext, type PickConstraints } from '../src/services/pick.js';
import { filterAndSortOffers, regionalProviders } from '../src/services/providers.js';
import { browseRoutes } from '../src/routes/browse.js';
import { pickRoutes } from '../src/routes/pick.js';
import { createBackup, restoreBackup } from '../src/services/backup.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-exclusions-test-'));
const providers = [
  { provider_id: 8, provider_name: 'Netflix', logo_path: null },
  { provider_id: 15, provider_name: 'Hulu', logo_path: null },
  { provider_id: 283, provider_name: 'Crunchyroll', logo_path: null },
  { provider_id: 1968, provider_name: 'Crunchyroll Amazon Channel', logo_path: null },
];
const entries = [
  { id: 100001, services: [283], name: 'Excluded only' },
  { id: 100002, services: [8], name: 'Netflix only' },
  { id: 100003, services: [283, 8], name: 'Shared title' },
  { id: 100004, services: [1968], name: 'Channel only' },
  { id: 100005, services: [283], name: 'Allowed elsewhere in another region' },
  { id: 100006, services: [], name: 'Unavailable' },
];
const filters: BrowseFilters = { type: 'tv', genres: ['anime'], watch: 'any', status: '', library: '',
  yearMin: null, yearMax: null, rating: null, bingeable: false, sort: 'popular', excludedProviders: [283, 1968] };
const constraints: PickConstraints = { type: 'tv', genres: ['anime'], time: null, my_services_only: false,
  include_rent_buy: false, exclude_library_titles: false, excluded_provider_ids: [283, 1968] };

before(() => { config.dataDir = dataDir; config.tmdbKey = 'test-key'; migrate(); });
beforeEach(() => {
  getDb().exec('DELETE FROM titles; DELETE FROM api_cache; DELETE FROM discover_queries; DELETE FROM settings; DELETE FROM my_services; DELETE FROM suggestion_log; DELETE FROM suggestion_suppressions');
  cacheSet('tmdb_genres_merged', []);
  cacheSet('tmdb_providers:US', providers);
});
after(() => {
  getDb().close();
  for (const name of fs.readdirSync(dataDir)) fs.unlinkSync(path.join(dataDir, name));
  fs.rmdirSync(dataDir);
});

function mockTmdb(t: TestContext): URL[] {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url);
    if (/\/3\/watch\/providers\/(movie|tv)$/.test(url.pathname)) return Response.json({ results: providers });
    if (url.pathname.startsWith('/3/discover/')) return Response.json({
      // Intentionally retain excluded titles to exercise final availability checks too.
      results: entries.map((entry) => ({ ...entry, original_language: 'ja', genre_ids: [16], vote_average: 8, popularity: 10 })),
      page: Number(url.searchParams.get('page') ?? 1), total_pages: 2,
    });
    const id = Number(url.pathname.split('/')[3]);
    const entry = entries.find((item) => item.id === id);
    if (url.pathname.endsWith('/watch/providers')) return Response.json({ results: {
      US: { flatrate: providers.filter((provider) => (entry?.services ?? [283]).includes(provider.provider_id)) },
      CA: { flatrate: [providers[0]] },
    } });
    return Response.json({ id, name: entry?.name ?? 'Adaptation', title: 'Adaptation', original_language: 'en',
      genres: [{ id: 18, name: 'Drama' }], vote_count: 500, vote_average: 8, popularity: 10,
      runtime: 90, episode_run_time: [24], first_air_date: '2020-01-01', release_date: '2020-01-01', status: 'Ended' });
  });
  return requests;
}

test('Browse excludes sources before pagination, keeps shared titles, and filters supplemental adaptations', async (t) => {
  const requests = mockTmdb(t);
  const first = await discoverGrid({ ...filters, includeAdaptations: true, preferEnglish: true }, 1);
  assert.deepEqual(first.items.map((item) => item.tmdb_id).sort(), [100002, 100003]);
  assert.ok(first.items.every((item) => item.offers?.length === 1 && item.offers[0].provider_id === 8));
  const second = await discoverGrid(filters, 2);
  assert.equal(second.page, 2);
  assert.equal(second.total_pages, 2);
  const queries = requests.filter((url) => url.pathname.startsWith('/3/discover/'));
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.equal(query.searchParams.get('with_watch_providers'), '8|15');
    assert.equal(query.searchParams.get('watch_region'), 'US');
    assert.equal(query.searchParams.get('with_original_language'), 'ja');
    assert.equal(query.searchParams.get('with_genres'), '16');
    assert.equal(query.searchParams.has('without_watch_providers'), false, 'shared titles must remain eligible');
  }
  // Clearing the filter restores all matches without corrupting cached offer data.
  const cleared = await discoverGrid({ ...filters, excludedProviders: [] }, 1);
  assert.equal(cleared.items.length, entries.length);
  assert.deepEqual(cleared.items.find((item) => item.tmdb_id === 100003)!.offers!.map((offer) => offer.provider_id).sort((a, b) => a - b), [8, 283]);
});

test('exclusions take precedence over My Services and an empty service set never broadens discovery', async (t) => {
  const requests = mockTmdb(t);
  getDb().prepare('INSERT INTO my_services (provider_id, enabled) VALUES (8, 1), (283, 1)').run();
  const result = await discoverGrid({ ...filters, watch: 'my' }, 1);
  assert.deepEqual(result.items.map((item) => item.tmdb_id).sort(), [100002, 100003]);
  assert.equal(requests.find((url) => url.pathname.startsWith('/3/discover/'))!.searchParams.get('with_watch_providers'), '8');
  requests.length = 0;
  assert.deepEqual((await discoverGrid({ ...filters, watch: 'my', excludedProviders: [8, 283] }, 1)).items, []);
  const pick = await pickNext({ ...constraints, my_services_only: true, excluded_provider_ids: [8, 283] }, []);
  assert.equal(pick.candidate, null);
  assert.ok(pick.empty?.loosen.some((option) => option.patch.excluded_provider_ids?.length === 0));
  assert.equal(requests.length, 0);
});

test('Pick removes excluded offers and skips titles only available on excluded sources', async (t) => {
  const requests = mockTmdb(t);
  const seen: string[] = [];
  for (let i = 0; i < 2; i++) {
    const result = await pickNext({ ...constraints, include_adaptations: true }, seen);
    assert.ok(result.candidate);
    assert.ok([100002, 100003].includes(result.candidate.tmdb_id));
    assert.deepEqual(result.candidate.providers.map((offer) => offer.provider_id), [8]);
    seen.push(result.candidate.key);
  }
  assert.equal((await pickNext(constraints, seen)).candidate, null);
  for (const url of requests.filter((item) => item.pathname.startsWith('/3/discover/'))) {
    assert.equal(url.searchParams.get('with_watch_providers'), '8|15');
  }
});

test('Library source exclusions use active regional offers and preserve titles shared with included services', async () => {
  for (const entry of entries) {
    const titleId = getDb().prepare(`INSERT INTO titles (tmdb_id, media_type, name, original_language, genres)
      VALUES (?, 'tv', ?, 'ja', '["Animation"]')`).run(entry.id, entry.name).lastInsertRowid;
    getDb().prepare("INSERT INTO user_state (title_id, status) VALUES (?, 'wishlist')").run(titleId);
    for (const providerId of entry.services) getDb().prepare(`INSERT INTO availability
      (title_id, provider_id, provider_name, offer_type, region, first_seen, last_seen) VALUES (?, ?, 'Service', 'flatrate', 'US', '2026-01-01', '2026-01-01')`)
      .run(titleId, providerId);
    if (entry.id === 100005) getDb().prepare(`INSERT INTO availability
      (title_id, provider_id, provider_name, offer_type, region, first_seen, last_seen) VALUES (?, 8, 'Netflix', 'flatrate', 'CA', '2026-01-01', '2026-01-01')`).run(titleId);
  }
  assert.deepEqual((await libraryGrid(filters)).map((item) => item.tmdb_id).sort(), [100002, 100003]);
  getDb().prepare('INSERT INTO my_services (provider_id, enabled) VALUES (283, 1)').run();
  assert.deepEqual(await libraryGrid({ ...filters, watch: 'my' }), []);
  assert.equal((await libraryGrid({ ...filters, excludedProviders: [] })).length, entries.length);
});

test('source exclusions apply to every offer type, including rentals, free and ad-supported services', () => {
  const offers = [
    { ...providers[2], offer_type: 'flatrate' as const },
    { ...providers[2], offer_type: 'rent' as const },
    { ...providers[0], offer_type: 'free' as const },
    { ...providers[1], offer_type: 'ads' as const },
  ];
  assert.deepEqual(filterAndSortOffers(offers, { myServicesOnly: false, includeRentBuy: true, excludedProviderIds: [283] }, new Set())
    .map((offer) => offer.provider_id), [8, 15]);
});

test('the regional provider catalog is cached and survives refresh failures', async (t) => {
  getDb().exec("DELETE FROM api_cache WHERE key = 'tmdb_providers:US'");
  const requests = mockTmdb(t);
  assert.equal((await regionalProviders()).length, providers.length);
  assert.equal(requests.length, 2);
  await regionalProviders();
  assert.equal(requests.length, 2);
  getDb().prepare("UPDATE api_cache SET fetched_at = ? WHERE key = 'tmdb_providers:US'").run(new Date(Date.now() - 8 * 86400_000).toISOString());
  t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 400 }));
  assert.equal((await regionalProviders()).length, providers.length);
});

test('HTTP exclusions are validated, restored from a URL, and survive preference backups', async (t) => {
  mockTmdb(t);
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ error: error.message }));
  await app.register(browseRoutes);
  await app.register(pickRoutes);
  t.after(() => app.close());
  const url = '/api/browse/discover?genres=anime&type=tv&exclude_providers=283,1968';
  const response = await app.inject(url);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().items.map((item: { tmdb_id: number }) => item.tmdb_id).sort(), [100002, 100003]);
  assert.deepEqual((await app.inject(url)).json(), response.json());
  for (const invalid of ['-1', 'abc', '1.5', 'Infinity']) assert.equal((await app.inject('/api/browse/discover?exclude_providers=' + invalid)).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/pick/next', payload: { constraints: { excluded_provider_ids: ['283'] } } })).statusCode, 400);
  const picked = await app.inject({ method: 'POST', url: '/api/pick/next', payload: { constraints } });
  assert.equal(picked.statusCode, 200);
  assert.ok([100002, 100003].includes(picked.json().candidate.tmdb_id));
  setSetting('pick_constraints', JSON.stringify(constraints));
  const backup = createBackup(getDb());
  setSetting('pick_constraints', '{}');
  restoreBackup(getDb(), backup, 'merge');
  assert.deepEqual(JSON.parse(getSetting('pick_constraints')).excluded_provider_ids, [283, 1968]);
});
