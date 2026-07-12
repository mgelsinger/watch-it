import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations');

test('discovery migration preserves suggestion history and seeded suppressions', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const name of [
    '001_init.sql',
    '002_release_dates_and_initial_sync.sql',
    '003_browse.sql',
    '004_pick.sql',
  ]) {
    db.exec(fs.readFileSync(path.join(migrations, name), 'utf8'));
  }

  const titleId = Number(db.prepare(`
    INSERT INTO titles (tmdb_id, media_type, name) VALUES (101, 'movie', 'Existing title')
  `).run().lastInsertRowid);
  db.prepare(`INSERT INTO user_state (title_id, status, never_suggest) VALUES (?, 'wishlist', 1)`).run(titleId);
  db.prepare(`INSERT INTO suggestion_log (title_id, action, constraints) VALUES (?, 'skipped', '{}')`).run(titleId);

  db.exec(fs.readFileSync(path.join(migrations, '005_discovery_first_pick.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(migrations, '006_suggestion_shown_action.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(migrations, '007_saved_for_later.sql'), 'utf8'));

  const log = db.prepare('SELECT title_id, tmdb_id, media_type, action FROM suggestion_log').get() as Record<string, unknown>;
  assert.deepEqual(log, { title_id: titleId, tmdb_id: 101, media_type: 'movie', action: 'skipped' });
  const suppression = db.prepare('SELECT media_type, tmdb_id FROM suggestion_suppressions').get() as Record<string, unknown>;
  assert.deepEqual(suppression, { media_type: 'movie', tmdb_id: 101 });
  assert.doesNotThrow(() => {
    db.prepare(`
      INSERT INTO suggestion_log (tmdb_id, media_type, action, constraints) VALUES (202, 'tv', 'shown', '{}')
    `).run();
  });
  assert.doesNotThrow(() => {
    db.prepare("UPDATE user_state SET status = 'saved' WHERE title_id = ?").run(titleId);
  });
  db.close();
});
