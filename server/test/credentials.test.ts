import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { closeDb } from '../src/db.js';
import { getCredential } from '../src/services/credentials.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-key-test-'));
const key = 'a'.repeat(32);
before(() => { config.dataDir = directory; config.authPassword = 'fixture-password-keys'; config.tmdbKey = ''; config.omdbKey = ''; });
after(closeDb);

test('key setup verifies before saving, survives restart, stays out of exports, and can be removed', async (t) => {
  const calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input)); calls.push(url);
    return url.searchParams.get('api_key') === key ? Response.json({ images: {} }) : new Response('do not reflect provider content', { status: 401 });
  });
  let app = await createApp({ logger: false });
  const login = async () => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: config.authPassword } })).headers['set-cookie']).split(';')[0];
  let headers = { cookie: await login(), 'x-watch-it-settings': '1' };
  const write = (value: string, customHeaders = headers) => app.inject({ method: 'PUT', url: '/api/settings/keys/tmdb', headers: customHeaders, payload: { key: value } });
  try {
    assert.equal((await write(key, { cookie: '', 'x-watch-it-settings': '1' })).statusCode, 401);
    assert.equal((await write(key, { ...headers, 'x-watch-it-settings': '' })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/settings/keys/tmdb', headers: { ...headers, 'sec-fetch-site': 'cross-site' }, payload: { key } })).statusCode, 403);
    assert.equal((await write('eyJ-access-token')).statusCode, 400);
    assert.equal(calls.length, 0);
    assert.deepEqual((await write(key)).json(), { ok: true, configured: true });
    assert.equal(getCredential('tmdb'), key);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, 'credentials.json')).mode & 0o777, 0o600);
    const rejected = await write('b'.repeat(32));
    assert.equal(rejected.statusCode, 400);
    assert.match(rejected.body, /TMDB rejected/);
    assert.ok(!rejected.body.includes('do not reflect'));
    assert.equal(getCredential('tmdb'), key, 'invalid replacement preserves working key');
    const backup = await app.inject({ url: '/api/backup/export', headers });
    for (const url of ['/api/settings', '/api/diagnostics', '/api/backup/export']) {
      const res = await app.inject({ url, headers });
      assert.equal(res.statusCode, 200); assert.ok(!res.body.includes(key), url);
    }
    await app.close();
    closeDb();
    app = await createApp({ logger: false });
    headers = { ...headers, cookie: await login() };
    assert.equal((await app.inject({ url: '/api/settings', headers })).json().keys.tmdb, true);
    const restored = await app.inject({ method: 'POST', url: '/api/backup/restore', headers, payload: { mode: 'replace', backup: backup.json() } });
    assert.equal(restored.statusCode, 200); assert.equal(getCredential('tmdb'), key);
    config.tmdbKey = 'environment-key';
    assert.equal(getCredential('tmdb'), 'environment-key');
    assert.equal((await write(key)).statusCode, 409);
    assert.equal((await app.inject({ url: '/api/settings', headers })).json().managed_keys.tmdb, true);
    config.tmdbKey = '';
    assert.equal((await write('')).statusCode, 200);
    assert.equal(getCredential('tmdb'), '');
    assert.equal((await app.inject({ url: '/api/settings', headers })).json().keys.tmdb, false);
    assert.ok(calls.every((url) => url.hostname === 'api.themoviedb.org'));
  } finally { config.tmdbKey = ''; await app.close(); }
});

test('OMDb application-level rejection is actionable and never saved as a working key', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ Response: 'False', Error: 'Invalid API key!' }));
  const app = await createApp({ logger: false });
  try {
    const cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: config.authPassword } })).headers['set-cookie']).split(';')[0];
    const response = await app.inject({ method: 'PUT', url: '/api/settings/keys/omdb', headers: { cookie, 'x-watch-it-settings': '1' }, payload: { key: 'abcd1234' } });
    assert.equal(response.statusCode, 400); assert.match(response.body, /activation email/);
    assert.equal(getCredential('omdb'), '');
  } finally { await app.close(); }
});
