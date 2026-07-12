import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCandidateScore, shouldExcludeLibraryTitle } from '../src/services/pick.js';
import { filterAndSortOffers, type WatchOffer } from '../src/services/providers.js';

test('recommendation scoring applies source boosts and history penalties', () => {
  const popular = calculateCandidateScore(8, 0.5, 'popular');
  const airing = calculateCandidateScore(8, 0.5, 'airing_now');
  const recent = calculateCandidateScore(8, 0.5, 'new_release');
  assert.ok(Math.abs(airing - popular - 0.2) < Number.EPSILON * 4);
  assert.ok(Math.abs(recent - popular - 0.3) < Number.EPSILON * 4);
  assert.ok(Math.abs(calculateCandidateScore(8, 0.5, 'popular', { skipped: false }) - (popular - 0.25)) < Number.EPSILON * 4);
  assert.ok(Math.abs(calculateCandidateScore(8, 0.5, 'popular', { skipped: true }) - (popular - 0.5)) < Number.EPSILON * 4);
});

test('provider filtering prefers enabled streaming offers and deduplicates providers', () => {
  const offers: WatchOffer[] = [
    { provider_id: 20, provider_name: 'Other Stream', logo_path: null, offer_type: 'flatrate' },
    { provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg', offer_type: 'rent' },
    { provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg', offer_type: 'flatrate' },
    { provider_id: 30, provider_name: 'Store', logo_path: null, offer_type: 'buy' },
  ];

  assert.deepEqual(
    filterAndSortOffers(offers, { myServicesOnly: true, includeRentBuy: false }, new Set([8])).map((o) => o.provider_name),
    ['Netflix'],
  );
  assert.deepEqual(
    filterAndSortOffers(offers, { myServicesOnly: false, includeRentBuy: true }, new Set([8])).map((o) => `${o.provider_name}:${o.offer_type}`),
    ['Netflix:flatrate', 'Other Stream:flatrate', 'Store:buy'],
  );
});

test('tracked-title filter excludes Watchlist and Watching only when enabled', () => {
  assert.equal(shouldExcludeLibraryTitle(undefined, true), false);
  assert.equal(shouldExcludeLibraryTitle({ status: 'wishlist' }, true), true);
  assert.equal(shouldExcludeLibraryTitle({ status: 'watching' }, true), true);
  assert.equal(shouldExcludeLibraryTitle({ status: 'wishlist' }, false), false);
  assert.equal(shouldExcludeLibraryTitle({ status: 'watched' }, false), true);
  assert.equal(shouldExcludeLibraryTitle({ status: 'dropped' }, false), true);
});
