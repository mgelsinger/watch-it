import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { createHttpClient } from '../src/http.js';
import { singleFlight } from '../src/singleFlight.js';

test('identical misses share transport work and retry bodies are released', async () => {
  let calls = 0, cancelled = 0;
  const client = createHttpClient({ minIntervalMs: 0, retryDelayMs: 1, fetch: async () => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 429 });
    await delay(10);
    return Response.json({ ok: true });
  } });
  const values = await Promise.all(Array.from({ length: 30 }, () => client.fetchJson('tmdb', 'https://example.test/shared')));
  assert.equal(calls, 2); assert.equal(cancelled, 1); assert.equal(values.length, 30);
  await client.close();
});

test('HTTP deadline covers slow headers, stalled bodies, queueing and Retry-After', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/headers') return;
    if (req.url === '/retry') { res.writeHead(429, { 'retry-after': '60' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.write('{');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const client = createHttpClient({ timeoutMs: 150, minIntervalMs: 0, concurrency: 1 });
  try {
    for (const url of ['/headers', '/body', '/retry']) {
      const start = Date.now();
      await assert.rejects(client.fetchJson('tmdb', `http://127.0.0.1:${port}${url}`), /timed out/);
      assert.ok(Date.now() - start < 1500);
    }
    const results = await Promise.allSettled(['/body', '/headers'].map((url) => client.fetchJson('tmdb', `http://127.0.0.1:${port}${url}`)));
    assert.ok(results.every((result) => result.status === 'rejected'));
  } finally {
    await client.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('streamed and declared oversized responses are rejected and cancelled', async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    const client = createHttpClient({ maxBytes: 4, minIntervalMs: 0, fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; },
    }), { headers: declared ? { 'content-length': '8' } : {} }) });
    await assert.rejects(client.fetchBytes('image', 'https://example.test/image'), /too large/);
    assert.equal(cancelled, true); await client.close();
  }
});

test('upstream capacity is bounded and shutdown cancels active and queued requests', async () => {
  let active = 0, peak = 0;
  const client = createHttpClient({ concurrency: 2, maxQueue: 2, minIntervalMs: 0, fetch: async (_url, init) => {
    active++; peak = Math.max(peak, active);
    try { await delay(1000, undefined, { signal: init?.signal ?? undefined }); return Response.json({}); }
    finally { active--; }
  } });
  const results = Promise.allSettled(Array.from({ length: 20 }, (_, i) => client.fetchJson('tmdb', `https://example.test/${i}`)));
  await delay(20); await client.close();
  const settled = await results;
  assert.ok(peak <= 2); assert.equal(active, 0);
  assert.ok(settled.every((result) => result.status === 'rejected'));
  assert.ok(settled.some((result) => result.status === 'rejected' && /queue full/.test(result.reason.message)));
});

test('cache refresh sharing includes post-fetch work and recovers after failure', async () => {
  let calls = 0;
  const work = () => singleFlight('fixture', async () => { calls++; await delay(10); return 'done'; });
  await Promise.all(Array.from({ length: 25 }, work)); assert.equal(calls, 1);
  await assert.rejects(singleFlight('fixture', async () => { throw new Error('failed'); }));
  assert.equal(await work(), 'done'); assert.equal(calls, 2);
});
