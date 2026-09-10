import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { closeDb, getDb, setSetting } from '../src/db.js';
import { createApp } from '../src/app.js';
import { startCron, stopCron } from '../src/services/sync.js';
import cron from 'node-cron';
import { APP_VERSION } from '../src/version.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-install-test-'));
before(() => { config.dataDir = directory; config.authPassword = 'fixture-password-123'; config.tmdbKey = ''; config.omdbKey = ''; });
after(() => { closeDb(); /* Isolated test files stay in the host temporary directory. */ });

async function login(app: Awaited<ReturnType<typeof createApp>>) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: config.authPassword } });
  assert.equal(response.statusCode, 200);
  return String(response.headers['set-cookie']).split(';')[0];
}

test('every API route defaults to protected, with explicit health/login exceptions', async () => {
  const app = await createApp({ logger: false });
  app.get('/new-private-route', async () => ({ secret: true }));
  try {
    for (const [method, url] of [
      ['GET', '/api/settings'], ['PUT', '/api/settings'], ['GET', '/api/backup/export'],
      ['POST', '/api/backup/inspect'], ['POST', '/api/backup/restore'], ['POST', '/api/sync/run'],
      ['POST', '/api/titles'], ['PATCH', '/api/titles/1/state'], ['GET', '/api/home'], ['GET', '/new-private-route'],
    ] as const) assert.equal((await app.inject({ method, url })).statusCode, 401, url);
    for (const url of ['/api%2fsettings', '//api/settings', '/api/../api/settings', '/api/%73ettings', '/api%252fsettings']) {
      const response = await app.inject({ url });
      assert.ok([400, 401, 404].includes(response.statusCode), `${url}: ${response.statusCode}`);
      assert.ok(!response.body.includes('tmdb'));
    }
    const health = await app.inject('/api/health');
    assert.deepEqual(health.json(), { ok: true, version: APP_VERSION });
    const cookie = await login(app);
    assert.equal((await app.inject({ url: '/api/settings', headers: { cookie } })).statusCode, 200);
    const backup = await app.inject({ url: '/api/backup/export', headers: { cookie } });
    assert.equal(backup.json().app_version, APP_VERSION);
    assert.ok(!/password|session|token|auth_configuration/.test(backup.body));
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    assert.equal((await app.inject({ url: '/api/settings', headers: { cookie } })).statusCode, 401);
  } finally { await app.close(); }
});

test('credential rotation revokes sessions, and invalid settings/imports do not change data', async () => {
  let app = await createApp({ logger: false });
  const oldCookie = await login(app);
  await app.close();
  config.authPassword = 'rotated-fixture-password';
  app = await createApp({ logger: false });
  try {
    assert.equal((await app.inject({ url: '/api/settings', headers: { cookie: oldCookie } })).statusCode, 401);
    const cookie = await login(app);
    setSetting('region', 'US');
    const invalid = await app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { region: 'ZZ', schedule_country: 'CA' } });
    assert.equal(invalid.statusCode, 400);
    assert.equal((await app.inject({ url: '/api/settings', headers: { cookie } })).json().settings.region, 'US');
    const large = { padding: 'x'.repeat(70_000) };
    assert.equal((await app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: large })).statusCode, 413);
    assert.equal((await app.inject({ method: 'POST', url: '/api/backup/inspect', headers: { cookie }, payload: large })).statusCode, 400);
    const before = (await app.inject({ url: '/api/backup/export', headers: { cookie } })).json().profile;
    const restore = await app.inject({ method: 'POST', url: '/api/backup/restore', headers: { cookie }, payload: { mode: 'replace', backup: large } });
    assert.equal(restore.statusCode, 400);
    assert.deepEqual((await app.inject({ url: '/api/backup/export', headers: { cookie } })).json().profile, before);
    assert.equal(getDb().pragma('integrity_check', { simple: true }), 'ok');
  } finally { await app.close(); }
});

test('forwarded client addresses are ignored unless an exact proxy is trusted', async () => {
  for (const trusted of [false, true]) {
    config.trustedProxies = trusted ? ['127.0.0.1'] : [];
    const app = await createApp({ logger: false });
    try {
      for (let i = 0; i < 5; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.1' }, payload: { password: 'bad' } })).statusCode, 401);
      const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.1' }, payload: { password: 'bad' } });
      assert.equal(blocked.statusCode, 429); assert.ok(Number(blocked.headers['retry-after']) > 0);
      const other = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.2' }, payload: { password: 'bad' } });
      assert.equal(other.statusCode, trusted ? 401 : 429);
    } finally { await app.close(); }
  }
  config.trustedProxies = [];
});

test('cron jobs use the upgraded scheduler and are destroyed during shutdown', async () => {
  startCron(); assert.equal(cron.getTasks().size, 3);
  startCron(); assert.equal(cron.getTasks().size, 3);
  await stopCron(); assert.equal(cron.getTasks().size, 0);
});
