import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createBackup, inspectBackup, restoreBackup } from '../src/services/backup.js';

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations');

function database(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const name of fs.readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrations, name), 'utf8'));
  }
  return db;
}

function addShow(db: Database.Database, watchedAt: string | null): number {
  const titleId = Number(db.prepare(`
    INSERT INTO titles (tmdb_id, media_type, imdb_id, name, year)
    VALUES (1399, 'tv', 'tt0944947', 'Game of Thrones', 2011)
  `).run().lastInsertRowid);
  db.prepare(`
    INSERT INTO user_state (title_id, status, notes, updated_at)
    VALUES (?, 'watching', 'Continue later', '2026-07-01T12:00:00Z')
  `).run(titleId);
  const seasonId = Number(db.prepare(`
    INSERT INTO seasons (title_id, season_number, name) VALUES (?, 1, 'Season 1')
  `).run(titleId).lastInsertRowid);
  db.prepare(`
    INSERT INTO episodes (season_id, episode_number, name, watched_at)
    VALUES (?, 1, 'Winter Is Coming', ?)
  `).run(seasonId, watchedAt);
  db.prepare(`
    INSERT INTO suggestion_suppressions (media_type, tmdb_id, created_at)
    VALUES ('tv', 1399, '2026-07-01T12:00:00Z')
  `).run();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('region', 'US')`).run();
  db.prepare(`INSERT INTO my_services (provider_id, enabled) VALUES (8, 1)`).run();
  return titleId;
}

test('profile backup is checksummed and preserves watched progress by stable identity', () => {
  const source = database();
  addShow(source, '2026-06-30T21:00:00Z');
  source.prepare(`INSERT INTO titles (tmdb_id, media_type, name) VALUES (603, 'movie', 'Untracked preview')`).run();

  const backup = createBackup(source);
  const inspected = inspectBackup(backup);
  assert.equal(inspected.preview.checksum_verified, true);
  assert.equal(inspected.preview.titles, 1);
  assert.equal(inspected.preview.shows, 1);
  assert.equal(inspected.preview.watched_episodes, 1);
  assert.equal(inspected.preview.never_suggest, 1);
  assert.equal(backup.profile.titles.some((title) => title.record.tmdb_id === 603), false);

  const target = database();
  restoreBackup(target, backup, 'merge');
  const restored = target.prepare(`
    SELECT t.tmdb_id, us.status, us.notes, e.watched_at
    FROM titles t
    JOIN user_state us ON us.title_id = t.id
    JOIN seasons s ON s.title_id = t.id
    JOIN episodes e ON e.season_id = s.id
  `).get() as Record<string, unknown>;
  assert.deepEqual(restored, {
    tmdb_id: 1399,
    status: 'watching',
    notes: 'Continue later',
    watched_at: '2026-06-30T21:00:00Z',
  });
  assert.equal((target.prepare('PRAGMA foreign_key_check').all()).length, 0);

  source.close();
  target.close();
});

test('merge restore does not clear newer watched data', () => {
  const source = database();
  addShow(source, null);
  const backup = createBackup(source);

  const target = database();
  const titleId = addShow(target, '2026-07-10T20:00:00Z');
  target.prepare(`
    UPDATE user_state SET status = 'watched', watched_at = '2026-07-10T21:00:00Z', updated_at = '2026-07-10T21:00:00Z'
    WHERE title_id = ?
  `).run(titleId);

  restoreBackup(target, backup, 'merge');
  const state = target.prepare('SELECT status, watched_at FROM user_state WHERE title_id = ?').get(titleId) as Record<string, unknown>;
  const episode = target.prepare(`
    SELECT e.watched_at FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE s.title_id = ?
  `).get(titleId) as Record<string, unknown>;
  assert.deepEqual(state, { status: 'watched', watched_at: '2026-07-10T21:00:00Z' });
  assert.deepEqual(episode, { watched_at: '2026-07-10T20:00:00Z' });

  source.close();
  target.close();
});

test('backup inspection rejects changed or truncated profile data', () => {
  const source = database();
  addShow(source, null);
  const backup = createBackup(source);
  const changed = structuredClone(backup);
  changed.profile.titles[0].record.name = 'Changed after export';
  assert.throws(() => inspectBackup(changed), /checksum does not match/);

  const truncated = structuredClone(backup) as unknown as Record<string, unknown>;
  const profile = truncated.profile as Record<string, unknown>;
  delete profile.titles;
  assert.throws(() => inspectBackup(truncated), /section titles is missing/);
  source.close();
});

test('replace restore removes titles that are not in the backup', () => {
  const source = database();
  addShow(source, null);
  const backup = createBackup(source);

  const target = database();
  target.prepare(`INSERT INTO titles (tmdb_id, media_type, name) VALUES (603, 'movie', 'The Matrix')`).run();
  restoreBackup(target, backup, 'replace');
  const titles = target.prepare('SELECT tmdb_id, media_type FROM titles ORDER BY id').all();
  assert.deepEqual(titles, [{ tmdb_id: 1399, media_type: 'tv' }]);
  target.close();
  source.close();
});

test('legacy version 1 exports can still be inspected and restored', () => {
  const legacy = {
    app: 'watch-it',
    version: 1,
    exported_at: '2026-01-01T00:00:00Z',
    titles: [{ id: 7, tmdb_id: 603, media_type: 'movie', name: 'The Matrix', year: 1999, genres: '[]' }],
    user_state: [{ title_id: 7, status: 'watched', watched_at: '2025-12-31T22:00:00Z', updated_at: '2025-12-31T22:00:00Z', never_suggest: 0 }],
    seasons: [],
    episodes: [],
    cast_members: [],
    availability: [],
    my_services: [],
    events: [],
    settings: [],
    suggestion_log: [],
    suggestion_suppressions: [],
  };
  const preview = inspectBackup(legacy).preview;
  assert.equal(preview.legacy, true);
  assert.equal(preview.movies, 1);

  const target = database();
  restoreBackup(target, legacy, 'merge');
  const restored = target.prepare(`
    SELECT t.name, us.status, us.watched_at FROM titles t JOIN user_state us ON us.title_id = t.id
  `).get();
  assert.deepEqual(restored, { name: 'The Matrix', status: 'watched', watched_at: '2025-12-31T22:00:00Z' });
  target.close();
});
