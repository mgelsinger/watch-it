import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations');

test('migrations preserve active data while removing obsolete state', () => {
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
  db.prepare(`INSERT INTO my_services (provider_id, provider_name, logo_path) VALUES (8, 'Netflix', '/logo.jpg')`).run();
  db.prepare(`INSERT INTO events (title_id, type) VALUES (?, 'now_in_theaters')`).run(titleId);
  db.prepare(`INSERT INTO settings (key, value) VALUES ('theme', 'light')`).run();
  db.prepare(`UPDATE titles SET raw_tmdb = '{"unused":true}' WHERE id = ?`).run(titleId);

  db.exec(fs.readFileSync(path.join(migrations, '005_discovery_first_pick.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(migrations, '006_suggestion_shown_action.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(migrations, '007_saved_for_later.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(migrations, '008_auth_sessions.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(migrations, '009_remove_obsolete_state.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(migrations, '010_original_language.sql'), 'utf8'));
  assert.deepEqual(db.prepare('SELECT original_language FROM titles WHERE id = ?').get(titleId), { original_language: null });

  const log = db.prepare('SELECT title_id, tmdb_id, media_type, action FROM suggestion_log').get() as Record<string, unknown>;
  assert.deepEqual(log, { title_id: titleId, tmdb_id: 101, media_type: 'movie', action: 'skipped' });
  const suppression = db.prepare('SELECT media_type, tmdb_id FROM suggestion_suppressions').get() as Record<string, unknown>;
  assert.deepEqual(suppression, { media_type: 'movie', tmdb_id: 101 });
  assert.deepEqual(db.prepare('SELECT provider_id, enabled FROM my_services').get(), { provider_id: 8, enabled: 1 });
  const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;
  assert.equal(count("SELECT COUNT(*) AS count FROM events WHERE type = 'now_in_theaters'"), 0);
  assert.equal(count("SELECT COUNT(*) AS count FROM settings WHERE key = 'theme'"), 0);
  assert.equal(count("SELECT COUNT(*) AS count FROM pragma_table_info('titles') WHERE name = 'raw_tmdb'"), 0);
  assert.equal(count("SELECT COUNT(*) AS count FROM pragma_table_info('user_state') WHERE name = 'never_suggest'"), 0);
  assert.equal(count("SELECT COUNT(*) AS count FROM pragma_table_info('suggestion_log') WHERE name = 'episode_id'"), 0);
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
