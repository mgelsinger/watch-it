import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const image = process.argv[2];
if (!image) throw new Error('Supply the tested application image.');
const prefix = `watch-it-proxy-test-${randomUUID().slice(0,8)}`;
const network = prefix, app = `${prefix}-app`, proxy = `${prefix}-proxy`, volume = `${prefix}-data`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-proxy-'));
const subnet = `172.29.${Math.floor(Math.random()*240)}`;
const password = 'local-proxy-fixture-password';
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) throw new Error(result.stderr || `docker ${args[0]} failed`);
  return result.stdout.trim();
}
let port;
function request(url, body, cookie) {
  return new Promise((resolve, reject) => {
    // Only this isolated loopback test accepts Caddy's fixture CA.
    const req = httpsRequest({ hostname: '127.0.0.1', port, servername: 'localhost', rejectUnauthorized: false, path: url,
      method: body ? 'POST' : 'GET', headers: { host: 'localhost', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, (res) => {
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));
    });
    req.setTimeout(5000,()=>req.destroy(new Error('proxy request timed out')));req.on('error',reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const created = [];
try {
  docker(['network','create','--subnet',`${subnet}.0/24`, network]);created.push(['network','rm',network]);
  docker(['volume','create',volume]);created.push(['volume','rm',volume]);
  docker(['run','-d','--name',app,'--network',network,'--ip',`${subnet}.3`,'--network-alias','watch-it','--mount',`type=volume,src=${volume},dst=/data`,'-e',`WATCH_IT_PASSWORD=${password}`,'-e','WATCH_IT_SECURE_COOKIE=true','-e',`WATCH_IT_TRUSTED_PROXIES=${subnet}.2`,image]);created.push(['rm','-f',app]);
  const template = fs.readFileSync('deploy/Caddyfile','utf8').replace('{$WATCH_IT_DOMAIN}', 'https://localhost').replace('    request_body', '    tls internal\n    request_body');
  fs.writeFileSync(path.join(directory,'Caddyfile'),template);
  docker(['run','-d','--name',proxy,'--network',network,'--ip',`${subnet}.2`,'-p','127.0.0.1::443','--mount',`type=bind,src=${directory},dst=/etc/caddy,readonly`,'caddy:2.11.2-alpine']);created.push(['rm','-f',proxy]);
  port=docker(['port',proxy,'443/tcp']).split(':').at(-1);
  let ready=false;
  for(let i=0;i<60;i++){try{if((await request('/api/health')).status===200){ready=true;break;}}catch{}await delay(250);}
  assert.ok(ready,'TLS proxy becomes healthy');
  assert.equal((await request('/api/settings')).status,401);
  const login=await request('/api/auth/login',{password});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'][0];assert.match(cookie,/; Secure/);assert.match(cookie,/HttpOnly/);
  assert.equal((await request('/api/settings',undefined,cookie.split(';')[0])).status,200);
  for(let i=0;i<5;i++)assert.equal((await request('/api/auth/login',{password:'wrong'})).status,401);
  assert.equal((await request('/api/auth/login',{password:'wrong'})).status,429);
  assert.equal(docker(['port',app]),'','application has no published port in the proxy test');
  fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/proxy-smoke.json',JSON.stringify({image,checks:['local-TLS','private-upstream','secure-cookie','protected-routes','login-throttle'],passed:true},null,2)+'\n');
  console.log('Local HTTPS proxy, secure cookie and login throttle checks passed.');
} finally {
  for(const args of created.reverse())docker(args);
}
