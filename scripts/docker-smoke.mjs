import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';

const image = process.argv[2];
if (!image) throw new Error('Usage: node scripts/docker-smoke.mjs <built-image>');
const prefix = `watch-it-test-${randomUUID().slice(0, 8)}`;
const volumes = [`${prefix}-fresh`, `${prefix}-upgrade`];
const containers = [];
const password = 'isolated-smoke-password';
async function fetchReady(url, options = {}) {
  const controller = new AbortController();
  // Keep readiness probes alive until their complete response or deadline.
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : body, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  } finally { clearTimeout(timer); }
}
function docker(args, input) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.error}`);
  return result.stdout.trim();
}
const helper = (volume, script, root = false) => docker(['run', '--rm', '-i', ...(root ? ['--user', '0'] : []), '--mount', `type=volume,src=${volume},dst=/data`, image, 'node', '--input-type=module'], script);
async function start(volume, suffix) {
  const name = `${prefix}-${suffix}`; containers.push(name);
  docker(['run', '-d', '--init', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--name', name, '-p', '127.0.0.1::8300', '--mount', `type=volume,src=${volume},dst=/data`, '-e', `WATCH_IT_PASSWORD=${password}`, image]);
  const port = docker(['port', name, '8300/tcp']).split(':').at(-1);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetchReady(`${base}/api/health`)).ok) return { name, base }; } catch { /* starting */ }
    await delay(250);
  }
  throw new Error(`Image did not become healthy: ${docker(['logs', name])}`);
}
async function login(base) {
  const response = await fetchReady(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
async function request(base, url, cookie, body, method = 'POST') {
  const response = await fetchReady(base + url, { method: body === undefined ? 'GET' : method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${url}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
function stop(name) {
  docker(['stop', '--time', '30', name]);
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', name]), '0', 'graceful shutdown');
}

try {
  for (const volume of volumes) docker(['volume', 'create', volume]);
  assert.equal(docker(['image', 'inspect', '--format', '{{.Config.User}}', image]), '1000:1000');
  const clean = await start(volumes[0], 'fresh');
  assert.equal((await fetchReady(clean.base + '/api/settings')).status, 401);
  assert.equal((await fetchReady(clean.base + '/about')).status, 200);
  assert.equal((await fetchReady(clean.base + '/tmdb-logo.svg')).status, 200);
  assert.equal(docker(['exec', clean.name, 'node', '-p', 'process.getuid()']), '1000');
  const cleanCookie = await login(clean.base);
  const initial = await request(clean.base, '/api/backup/export', cleanCookie);
  assert.equal(initial.profile.titles.length, 0);
  helper(volumes[0], `import fs from 'node:fs'; for (const name of ['/app/.env','/app/.git','/app/server/test','/app/node_modules/typescript','/app/web/src']) if(fs.existsSync(name)) throw new Error('Unexpected artifact: '+name);`);

  // Build an older, root-owned database using exactly the already-shipped SQL.
  helper(volumes[1], `
    import Database from 'better-sqlite3'; import fs from 'node:fs';
    const db = new Database('/data/watch-it.db');
    db.pragma('foreign_keys=ON'); db.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for(const name of fs.readdirSync('/app/server/dist/migrations').filter(name=>name.endsWith('.sql') && name < '010').sort()) {
      db.transaction(()=>{db.exec(fs.readFileSync('/app/server/dist/migrations/'+name,'utf8')); db.prepare('INSERT INTO migrations VALUES (?,?)').run(name,new Date().toISOString());})();
    }
    db.exec("INSERT INTO titles (id,tmdb_id,media_type,name) VALUES (1,123,'tv','Upgrade fixture'); INSERT INTO user_state (title_id,status,user_rating,notes) VALUES (1,'watching',8,'Preserve me'); INSERT INTO seasons (id,title_id,season_number) VALUES (1,1,1); INSERT INTO episodes (season_id,episode_number,watched_at) VALUES (1,1,'2026-01-01'); INSERT INTO my_services (provider_id,enabled) VALUES (8,1);; INSERT INTO suggestion_log (tmdb_id,media_type,action,constraints) VALUES (123,'tv','shown','{}');");
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('pick_constraints',JSON.stringify({excluded_provider_ids:[283,1968]}));
    db.close(); fs.chmodSync('/data',0o700); fs.chmodSync('/data/watch-it.db',0o600);
  `, true);
  docker(['run', '--rm', '--user', '0', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges:true', '--mount', `type=volume,src=${volumes[1]},dst=/data`, image, 'node', 'server/dist/maintenance.js', 'fix-permissions']);
  docker(['run', '--rm', '--mount', `type=volume,src=${volumes[1]},dst=/data`, image, 'node', 'server/dist/maintenance.js', 'snapshot']);
  const upgraded = await start(volumes[1], 'upgrade');
  const cookie = await login(upgraded.base);
  const backup = await request(upgraded.base, '/api/backup/export', cookie);
  assert.equal(backup.profile.titles[0].state.notes, 'Preserve me');
  assert.equal(backup.profile.titles[0].seasons[0].episodes[0].watched_at, '2026-01-01');
  assert.equal(backup.profile.titles[0].state.user_rating, 8);
  assert.equal(backup.profile.suggestion_log.length, 1);
  assert.deepEqual(JSON.parse(backup.profile.settings.find(s => s.key === 'pick_constraints').value).excluded_provider_ids, [283,1968]);
  for (const mode of ['merge','replace']) {
    await request(clean.base, '/api/backup/restore', cleanCookie, { mode, backup });
    const restored = await request(clean.base, '/api/backup/export', cleanCookie);
    assert.deepEqual(restored.profile, backup.profile);
  }
  // Exercise an active request during SIGTERM, then restart and check SQLite.
  const sync = request(upgraded.base, '/api/sync/run', cookie, {});
  await sync; stop(upgraded.name); stop(clean.name);
  helper(volumes[1], `import Database from 'better-sqlite3';const db=new Database('/data/watch-it.db');if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length)throw new Error('integrity');db.close();`);
  docker(['start', clean.name]);
  clean.base = `http://127.0.0.1:${docker(['port', clean.name, '8300/tcp']).split(':').at(-1)}`;
  for(let i=0;i<80;i++){try{if((await fetchReady(clean.base+'/api/health')).ok)break;}catch{}await delay(250);}
  const restarted = await request(clean.base, '/api/backup/export', await login(clean.base));
  assert.deepEqual(restarted.profile, backup.profile); stop(clean.name);
  const snapshot = helper(volumes[1], `import fs from 'node:fs';console.log(fs.readdirSync('/data/snapshots').find(name=>name.endsWith('.db')));`);
  docker(['run', '--rm', '--mount', `type=volume,src=${volumes[1]},dst=/data`, image, 'node', 'server/dist/maintenance.js', 'restore-snapshot', snapshot]);
  helper(volumes[1], `import Database from 'better-sqlite3';const db=new Database('/data/watch-it.db');if(db.prepare('SELECT count(*) AS n FROM migrations').get().n!==9)throw new Error('rollback schema');if(db.prepare('SELECT notes FROM user_state').get().notes!=='Preserve me')throw new Error('rollback data');db.close();`);
  const report = { image, image_id: docker(['image','inspect','--format','{{.Id}}', image]), checks: ['fresh-install','non-root','private-image-context','login','static-spa','upgrade-from-009','volume-ownership','snapshot','merge-restore','replace-restore','graceful-shutdown','restart','integrity','rollback'], passed: true };
  fs.mkdirSync('artifacts', { recursive: true }); fs.writeFileSync('artifacts/docker-smoke.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  // Only resources created under this invocation's random prefix are removed.
  for (const name of containers) docker(['rm', '-f', name]);
  for (const volume of volumes) docker(['volume', 'rm', volume]);
}
