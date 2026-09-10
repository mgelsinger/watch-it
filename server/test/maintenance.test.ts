import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { closeDb, migrate, getDb, setSetting } from '../src/db.js';
import { pruneImages, scheduledBackup, diagnostics } from '../src/services/maintenance.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-maintenance-'));
before(() => { config.dataDir = directory; migrate(); });
after(closeDb);

test('image eviction removes only ordinary cached images and preserves database, backups and links', () => {
  const images = path.join(directory, 'img', 'w342'); fs.mkdirSync(images, { recursive: true });
  const saved = path.join(directory, 'precious.watchit.json'); fs.writeFileSync(saved, 'private');
  fs.writeFileSync(path.join(images, 'old.jpg'), 'old-image');
  fs.utimesSync(path.join(images, 'old.jpg'), new Date(0), new Date(0));
  fs.writeFileSync(path.join(images, 'unrecognized.db'), 'keep');
  // Windows junction creation does not require symlink privileges.
  const backupDirectory = path.join(directory, 'backups'); fs.mkdirSync(backupDirectory);
  fs.writeFileSync(path.join(backupDirectory, 'photo.jpg'), 'keep-backup');
  fs.symlinkSync(backupDirectory, path.join(directory, 'img', 'w500'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(pruneImages(directory, 0, 1).deleted, 1);
  assert.equal(fs.readFileSync(saved, 'utf8'), 'private');
  assert.equal(fs.readFileSync(path.join(backupDirectory, 'photo.jpg'), 'utf8'), 'keep-backup');
  assert.equal(fs.readFileSync(path.join(images, 'unrecognized.db'), 'utf8'), 'keep');
  assert.equal(getDb().pragma('integrity_check', { simple: true }), 'ok');
});

test('scheduled backups retain completed copies and diagnostics omit personal data', () => {
  const backups = path.join(directory, 'scheduled');
  fs.mkdirSync(backups);
  fs.writeFileSync(path.join(backups, 'scheduled-2020-01-01T00-00-00Z.watchit.json'), 'older');
  fs.writeFileSync(path.join(backups, 'manual.watchit.json'), 'manual');
  setSetting('private_fixture_secret', 'never-share-this');
  scheduledBackup(backups, 1);
  const files = fs.readdirSync(backups);
  assert.equal(files.filter(name => name.startsWith('scheduled-')).length, 1);
  assert.ok(files.includes('manual.watchit.json'));
  const before = fs.readdirSync(backups);
  const blocked = path.join(directory, 'blocked'); fs.writeFileSync(blocked, 'not a directory');
  assert.throws(() => scheduledBackup(blocked, 1));
  assert.deepEqual(fs.readdirSync(backups), before);
  assert.ok(!JSON.stringify(diagnostics()).includes('never-share-this'));
  assert.ok(!JSON.stringify(diagnostics()).includes(directory));
});
