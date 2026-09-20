import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { cacheSet, getDb, migrate } from '../src/db.js';
import { englishVersion } from '../src/services/englishVersions.js';
import { NETFLIX_DUBS } from '../src/catalog/netflixDubs.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-audio-test-'));
before(() => { config.dataDir = dataDir; migrate(); });
beforeEach(() => getDb().exec('DELETE FROM api_cache'));
after(() => {
  getDb().close();
  for (const file of fs.readdirSync(dataDir)) fs.unlinkSync(path.join(dataDir, file));
  fs.rmdirSync(dataDir);
});

test('audio annotations use source evidence across providers without network requests or title-name inference', (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  assert.equal(englishVersion('tv', 7654321, 'ko').audio, 'unknown');
  cacheSet('english_audio:v1:tv:7654321', { english: true, audio_source: 'https://example.org/title/7654321',
    checked_at: '2026-09-09', audio_provider: 'Example provider', audio_region: 'US' });
  const info = englishVersion('tv', 7654321, 'ko');
  assert.equal(info.audio, 'dub');
  assert.equal(info.audio_provider, 'Example provider');
  assert.equal(englishVersion('movie', 7654321, 'ko').audio, 'unknown');
  assert.equal(englishVersion('tv', 7654322, 'en').audio, 'original');
  cacheSet('english_audio:v1:tv:7654321', { english: false });
  assert.equal(englishVersion('tv', 7654321, 'ko').audio, 'unknown');
});

test('retained audio evidence has distinct identities and individual sources', () => {
  assert.equal(new Set(NETFLIX_DUBS.map((entry) => entry.media_type + ':' + entry.tmdb_id)).size, NETFLIX_DUBS.length);
  for (const entry of NETFLIX_DUBS) {
    assert.equal(entry.english, true);
    assert.equal(new URL(entry.audio_source).protocol, 'https:');
    assert.ok(Number.isFinite(Date.parse(entry.checked_at)));
  }
  assert.equal(englishVersion('tv', 93405, 'ko').audio, 'dub');
  assert.equal(englishVersion('tv', 30991, 'ja').audio_provider, 'Crunchyroll');
});

test('newer negative audio evidence supersedes dated evidence; older misses do not', () => {
  cacheSet('english_audio:v1:tv:93405', null);
  getDb().prepare("UPDATE api_cache SET fetched_at = '2025-01-01T00:00:00Z'").run();
  assert.equal(englishVersion('tv', 93405, 'ko').audio, 'dub');
  cacheSet('english_audio:v1:tv:93405', null);
  getDb().prepare("UPDATE api_cache SET fetched_at = '2027-01-01T00:00:00Z'").run();
  assert.equal(englishVersion('tv', 93405, 'ko').audio, 'unknown');
});
