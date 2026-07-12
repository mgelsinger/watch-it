import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  cookieValue,
  createSession,
  expiredSessionCookie,
  passwordMatches,
  revokeSession,
  sessionCookie,
  sessionIsValid,
} from '../src/services/auth.js';

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations');

function database(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const name of fs.readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrations, name), 'utf8'));
  }
  return db;
}

test('password comparison accepts only the configured value', () => {
  assert.equal(passwordMatches('a long private password', 'a long private password'), true);
  assert.equal(passwordMatches('a long private password', 'a different password'), false);
});

test('session tokens are random, stored as hashes, expire, and can be revoked', () => {
  const db = database();
  const now = new Date('2026-07-12T12:00:00Z');
  const first = createSession(db, now);
  const second = createSession(db, now);
  assert.notEqual(first.token, second.token);
  assert.equal(sessionIsValid(db, first.token, now), true);

  const stored = db.prepare('SELECT token_hash FROM auth_sessions ORDER BY rowid LIMIT 1').get() as { token_hash: string };
  assert.notEqual(stored.token_hash, first.token);
  assert.equal(stored.token_hash.length, 64);
  assert.equal(sessionIsValid(db, first.token, new Date('2026-09-01T12:00:00Z')), false);

  assert.equal(sessionIsValid(db, second.token, now), true);
  revokeSession(db, second.token);
  assert.equal(sessionIsValid(db, second.token, now), false);
  db.close();
});

test('session cookies use strict browser protections and parse safely', () => {
  const token = 'A'.repeat(43);
  const plain = sessionCookie(token, false);
  const secure = sessionCookie(token, true);
  assert.match(plain, /HttpOnly/);
  assert.match(plain, /SameSite=Strict/);
  assert.doesNotMatch(plain, /; Secure/);
  assert.match(secure, /; Secure/);
  assert.equal(cookieValue(`another=value; ${plain.split(';')[0]}`), token);
  assert.equal(cookieValue('watch_it_session=invalid value'), null);
  assert.match(expiredSessionCookie(true), /Max-Age=0/);
});
