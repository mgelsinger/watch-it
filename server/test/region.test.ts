import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { cacheSet, closeDb, getDb, migrate, setSetting } from '../src/db.js';
import { libraryList, titleDetail, wishlistAvailable, newOnServicesRow } from '../src/services/queries.js';
import { getExternalOffers, enrichCardsWithOffers, watchUrl } from '../src/services/providers.js';
import { discoverGrid } from '../src/services/browse.js';
import { applyProviders } from '../src/services/availability.js';

before(() => { config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-regions-')); config.tmdbKey = 'fixture'; migrate(); });
beforeEach(() => { getDb().exec('DELETE FROM titles; DELETE FROM settings; DELETE FROM api_cache; DELETE FROM my_services'); });
after(closeDb);

test('current Home, Library and detail offers follow the active region while history remains stored', async () => {
  const db = getDb();
  db.prepare("INSERT INTO titles (id, tmdb_id, media_type, name) VALUES (1, 10, 'tv', 'Regional fixture')").run();
  db.prepare("INSERT INTO user_state (title_id, status) VALUES (1, 'wishlist')").run();
  db.prepare('INSERT INTO my_services (provider_id, enabled) VALUES (8, 1), (283, 1)').run();
  setSetting('region', 'US');
  applyProviders(1, { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } }, { initialSync: true });
  setSetting('region', 'CA');
  assert.equal(wishlistAvailable().length, 0);
  assert.deepEqual(libraryList()[0].my_offers, []);
  assert.deepEqual(titleDetail(1)?.availability, []);
  applyProviders(1, { CA: { flatrate: [{ provider_id: 283, provider_name: 'Crunchyroll' }], link: 'https://www.themoviedb.org/tv/10/watch?locale=CA' } }, { initialSync: true });
  assert.equal(wishlistAvailable().length, 1);
  assert.deepEqual((libraryList()[0].my_offers as Array<{ provider_id: number }>).map((offer) => offer.provider_id), [283]);
  const detail = titleDetail(1)!;
  assert.ok((detail.availability as Array<{ region: string }>).every((offer) => offer.region === 'CA'));
  assert.equal(detail.availability_check.status, 'fresh');
  assert.ok(detail.watch_url?.includes('locale=CA'));
  assert.equal((db.prepare("SELECT count(*) AS n FROM availability WHERE region = 'US'").get() as { n: number }).n, 1);
  assert.deepEqual(await newOnServicesRow(), []);
});

test('provider failures preserve dates and distinguish unavailable from a successful empty response', async (t) => {
  cacheSet('tmdb_providers:US:tv:1', { offers: [{ provider_id: 8, provider_name: 'Netflix', offer_type: 'flatrate', logo_path: null }] });
  getDb().prepare("UPDATE api_cache SET fetched_at = '2020-01-01T00:00:00Z'").run();
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  const stale = await getExternalOffers('tv', 1);
  assert.equal(stale.availability_check.status, 'stale');
  assert.equal(stale.availability_check.checked_at, '2020-01-01T00:00:00Z');
  assert.equal(stale.offers.length, 1);
  const missing = await getExternalOffers('tv', 2);
  assert.equal(missing.availability_check.status, 'unavailable');
  assert.equal(missing.availability_check.checked_at, null);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results: {} }));
  const empty = await getExternalOffers('tv', 2);
  assert.equal(empty.availability_check.status, 'fresh'); assert.deepEqual(empty.offers, []);
});

test('failed checks removed by source exclusions produce an incomplete-results notice', async (t) => {
  cacheSet('tmdb_genres_merged', []);
  cacheSet('tmdb_providers:US', [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 283, provider_name: 'Crunchyroll' }]);
  t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('/discover/') ? Response.json({ results: [{ id: 2, name: 'Unknown availability', original_language: 'ja' }], page: 1, total_pages: 2 }) : new Response('', { status: 403 }));
  const page = await discoverGrid({ type: 'tv', genres: ['anime'], watch: 'any', excludedProviders: [283], sort: 'popular' }, 1);
  assert.deepEqual(page.items, []); assert.equal(page.total_pages, 2);
  assert.match(page.notice ?? '', /incomplete/);
  const ordinary = await enrichCardsWithOffers([{ tmdb_id: 2, media_type: 'tv' as const }], { myServicesOnly: false, includeRentBuy: false });
  assert.equal(ordinary.length, 1); assert.equal(ordinary[0].availability_check.status, 'unavailable');
});

test('watch links only accept a regional TMDB watch page', () => {
  assert.ok(watchUrl('https://www.themoviedb.org/movie/123-title/watch?locale=US'));
  for (const url of ['javascript:alert(1)', 'https://evil.test/tv/1/watch', 'https://www.themoviedb.org@evil.test/tv/1/watch', 'http://www.themoviedb.org/tv/1/watch', 'https://www.themoviedb.org/search']) assert.equal(watchUrl(url), null);
});
