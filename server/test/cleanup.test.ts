import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { pruneDisposableData } from '../src/services/cleanup.js';
import { expireProviderMetadata } from '../src/services/retention.js';

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations');

function database(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const name of fs.readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrations, name), 'utf8'));
  }
  return db;
}

test('cleanup removes stale previews and API caches while preserving tracked titles', () => {
  const db = database();
  const old = '2026-05-01T00:00:00.000Z';
  const trackedId = Number(db.prepare(`
    INSERT INTO titles (tmdb_id, media_type, name, added_at) VALUES (1, 'movie', 'Tracked', ?)
  `).run(old).lastInsertRowid);
  db.prepare(`INSERT INTO user_state (title_id, status) VALUES (?, 'wishlist')`).run(trackedId);
  db.prepare(`INSERT INTO titles (tmdb_id, media_type, name, added_at) VALUES (2, 'movie', 'Preview', ?)`).run(old);
  db.prepare(`INSERT INTO titles (tmdb_id, media_type, name, added_at) VALUES (3, 'movie', 'Recent preview', '2026-07-10T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO api_cache (key, payload, fetched_at) VALUES ('old', '{}', ?), ('new', '{}', '2026-07-10T00:00:00.000Z')`).run(old);

  const result = pruneDisposableData(db, new Date('2026-07-12T00:00:00.000Z'));

  assert.deepEqual(result, { preview_titles: 1, api_cache_entries: 1 });
  assert.deepEqual(db.prepare('SELECT tmdb_id FROM titles ORDER BY tmdb_id').all(), [{ tmdb_id: 1 }, { tmdb_id: 3 }]);
  assert.deepEqual(db.prepare('SELECT key FROM api_cache').all(), [{ key: 'new' }]);
  db.close();
});

test('expiry removes provider content independently while retaining identity and personal history', () => {
  const db = database();
  const old = '2025-01-01T00:00:00Z';
  const recent = '2026-09-19T00:00:00Z';
  db.prepare(`INSERT INTO titles (id, tmdb_id, media_type, name, overview, metadata_refreshed_at, added_at)
    VALUES (1, 123, 'tv', 'Old name', 'Old plot', ?, ?), (2, 456, 'tv', 'Fresh name', 'Fresh plot', ?, ?)`)
    .run(old, old, recent, old);
  db.exec(`INSERT INTO user_state (title_id, status, user_rating, notes) VALUES (1, 'watching', 8, 'My own note');
    INSERT INTO my_services (provider_id) VALUES (8);
    INSERT INTO suggestion_suppressions (media_type, tmdb_id) VALUES ('tv', 123);`);
  db.prepare(`INSERT INTO seasons (id,title_id,season_number,name,metadata_cached_at) VALUES (1,1,1,'Old season',?), (2,2,1,'Failed refresh',?)`).run(old, old);
  db.prepare(`INSERT INTO episodes (id,season_id,episode_number,name,overview,watched_at,metadata_cached_at)
    VALUES (1,1,1,'Old episode','Old episode plot',?,?), (2,2,1,'Fresh episode','New plot',NULL,?)`).run(old, old, recent);
  db.prepare(`INSERT INTO cast_members (title_id,tmdb_person_id,name,metadata_cached_at) VALUES (2,123,'Expired cast',?)`).run(old);
  db.prepare(`INSERT INTO release_dates (tmdb_id,region,type,date,metadata_cached_at) VALUES (123,'US',4,'2025-01-01',?)`).run(old);
  db.prepare(`INSERT INTO availability (title_id,provider_id,provider_name,offer_type,region,first_seen,last_seen) VALUES (2,8,'Old offer','flatrate','US','2025-01-01',?)`).run(old);
  db.prepare(`INSERT INTO provider_checks (title_id,region,checked_at,watch_url) VALUES (2,'US',?,'https://www.themoviedb.org/tv/456/watch')`).run(old);
  db.prepare(`INSERT INTO events (title_id,type,payload,created_at) VALUES (2,'new_episode','{"name":"old provider content"}',?)`).run(old);
  expireProviderMetadata(db, new Date('2026-09-20T00:00:00Z'));
  assert.deepEqual(db.prepare('SELECT name, overview FROM titles WHERE id=1').get(), { name: 'TMDB tv 123', overview: null });
  assert.equal((db.prepare('SELECT name FROM titles WHERE id=2').get() as {name:string}).name, 'Fresh name');
  assert.deepEqual(db.prepare('SELECT name,watched_at FROM episodes WHERE id=1').get(), { name: null, watched_at: old });
  assert.equal((db.prepare('SELECT name FROM episodes WHERE id=2').get() as {name:string}).name, 'Fresh episode');
  assert.equal((db.prepare('SELECT name FROM seasons WHERE id=2').get() as {name:null}).name, null);
  assert.deepEqual(db.prepare('SELECT status,user_rating,notes FROM user_state').get(), {status:'watching',user_rating:8,notes:'My own note'});
  for (const table of ['cast_members','availability','provider_checks','events','release_dates']) {
    assert.equal((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n, 0);
  }
  for (const table of ['my_services','suggestion_suppressions']) assert.equal((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n, 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
});
