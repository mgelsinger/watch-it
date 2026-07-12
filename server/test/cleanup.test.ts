import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { pruneDisposableData } from '../src/services/cleanup.js';

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
