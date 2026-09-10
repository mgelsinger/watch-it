import { setTimeout as delay } from 'node:timers/promises';

export class HttpError extends Error {
  constructor(message: string, public status: number, public body?: string) { super(message); this.name = 'HttpError'; }
}
export class QuotaError extends Error {
  constructor(message: string) { super(message); this.name = 'QuotaError'; }
}
type SourceName = 'tmdb' | 'omdb' | 'tvmaze' | 'image';
const SOURCES = {
  tmdb: { interval: 30, retries: 2, timeout: 20_000 },
  omdb: { interval: 300, retries: 2, timeout: 20_000 },
  tvmaze: { interval: 550, retries: 2, timeout: 20_000 },
  image: { interval: 20, retries: 1, timeout: 25_000 },
};

/** Bound sockets and waiting callers independently for each upstream. */
class SourceQueue {
  private active = 0;
  private nextStart = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending: Array<{ start: () => void }> = [];
  constructor(private interval: number, private concurrency: number, private maxQueue: number) {}
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.pending.length >= this.maxQueue) return Promise.reject(new HttpError('upstream queue full; try again shortly', 503));
    return new Promise((resolve, reject) => {
      const item = { start: () => {
        signal.removeEventListener('abort', abort);
        this.active++;
        resolve(() => { this.active--; this.pump(); });
      } };
      const abort = () => {
        this.pending = this.pending.filter((entry) => entry !== item);
        reject(signal.reason);
        this.pump();
      };
      signal.addEventListener('abort', abort, { once: true });
      this.pending.push(item);
      this.pump();
    });
  }
  private pump(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (!this.pending.length || this.active >= this.concurrency) return;
    const wait = this.nextStart - Date.now();
    if (wait > 0) { this.timer = setTimeout(() => this.pump(), wait); return; }
    this.nextStart = Date.now() + this.interval;
    this.pending.shift()!.start();
    this.pump();
  }
}

async function readBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new HttpError('upstream response is too large', 502);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new HttpError('upstream response is too large', 502);
      chunks.push(part.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Transport options allow deterministic tests without changing production limits. */
export function createHttpClient(options: {
  fetch?: typeof fetch; timeoutMs?: number; minIntervalMs?: number;
  retryDelayMs?: number; concurrency?: number; maxQueue?: number; maxBytes?: number;
} = {}) {
  const queues = new Map<SourceName, SourceQueue>();
  const controllers = new Set<AbortController>();
  const inFlight = new Map<string, Promise<{ response: Response; bytes: Buffer }>>();
  let closed = false;
  function request(source: SourceName, url: string, binary: boolean): Promise<{ response: Response; bytes: Buffer }> {
    const key = `${source}:${binary}:${url}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    if (closed) return Promise.reject(new HttpError('server is shutting down', 503));
    if (inFlight.size >= 256) return Promise.reject(new HttpError('upstream queue full; try again shortly', 503));
    const cfg = SOURCES[source];
    if (!queues.has(source)) queues.set(source, new SourceQueue(options.minIntervalMs ?? cfg.interval, options.concurrency ?? 5, options.maxQueue ?? 64));
    const queue = queues.get(source)!;
    const controller = new AbortController();
    controllers.add(controller);
    const { signal } = controller;
    // One deadline covers queueing, retries, headers, and the entire body.
    const timer = setTimeout(() => controller.abort(new HttpError(`${source} request timed out`, 504)), options.timeoutMs ?? cfg.timeout);
    const work = (async () => {
      let retryWait = 0;
      for (let attempt = 0; ; attempt++) {
        if (attempt) await delay(retryWait, undefined, { signal });
        const release = await queue.acquire(signal);
        try {
          const response = await (options.fetch ?? globalThis.fetch)(url, { signal, headers: { accept: binary ? 'image/*' : 'application/json' } });
          if (response.status === 429 || response.status >= 500) {
            await response.body?.cancel();
            const header = response.headers.get('retry-after');
            const seconds = header ? Number(header) : NaN;
            const after = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : 0;
            retryWait = Math.max(options.retryDelayMs ?? 500 * 2 ** attempt, Number.isFinite(after) ? after : 0);
            if (attempt < cfg.retries) continue;
            throw new HttpError(`${source} responded ${response.status}`, response.status);
          }
          if (!response.ok) {
            await response.body?.cancel();
            if (binary && response.status === 404) return { response, bytes: Buffer.alloc(0) };
            throw new HttpError(`${source} responded ${response.status}`, response.status);
          }
          const bytes = await readBody(response, options.maxBytes ?? (binary ? 12 : 8) * 1024 * 1024, signal);
          return { response, bytes };
        } catch (err) {
          if (signal.aborted) throw signal.reason;
          if (err instanceof HttpError || attempt >= cfg.retries) throw err instanceof HttpError ? err : new HttpError(`${source} network request failed`, 502);
          retryWait = options.retryDelayMs ?? 500 * 2 ** attempt;
        } finally { release(); }
      }
    })().catch((err: unknown) => { throw signal.aborted ? signal.reason : err; }).finally(() => {
      clearTimeout(timer);
      controllers.delete(controller);
      inFlight.delete(key);
    });
    inFlight.set(key, work);
    return work;
  }
  return {
    async fetchJson(source: SourceName, url: string): Promise<unknown> {
      const { bytes } = await request(source, url, false);
      try { return JSON.parse(bytes.toString('utf8')); }
      catch { throw new HttpError(`${source} returned non-JSON payload`, 502); }
    },
    async fetchBytes(source: SourceName, url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
      const { response, bytes } = await request(source, url, true);
      return response.status === 404 ? null : { bytes, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
    },
    async close(): Promise<void> {
      closed = true;
      for (const controller of controllers) controller.abort(new HttpError('server is shutting down', 503));
      await Promise.allSettled(inFlight.values());
    },
  };
}
const client = createHttpClient();
export const { fetchJson, fetchBytes, close: closeHttp } = client;
