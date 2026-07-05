// Single HTTP client for all external calls: per-source rate limiting,
// retry with exponential backoff + jitter, and timeouts.

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaError';
  }
}

type SourceName = 'tmdb' | 'omdb' | 'tvmaze' | 'image';

interface SourceConfig {
  minIntervalMs: number;
  maxRetries: number;
  timeoutMs: number;
}

const SOURCES: Record<SourceName, SourceConfig> = {
  tmdb: { minIntervalMs: 30, maxRetries: 4, timeoutMs: 15_000 },
  omdb: { minIntervalMs: 300, maxRetries: 2, timeoutMs: 15_000 },
  tvmaze: { minIntervalMs: 550, maxRetries: 4, timeoutMs: 15_000 },
  image: { minIntervalMs: 20, maxRetries: 2, timeoutMs: 20_000 },
};

// Serialize requests per source so the min interval is respected even under concurrency.
const chains = new Map<SourceName, Promise<void>>();
const lastRequest = new Map<SourceName, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(source: SourceName): Promise<void> {
  const prev = chains.get(source) ?? Promise.resolve();
  let release!: () => void;
  chains.set(source, new Promise<void>((r) => (release = r)));
  await prev;
  const wait = (lastRequest.get(source) ?? 0) + SOURCES[source].minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest.set(source, Date.now());
  release();
}

async function rawFetch(source: SourceName, url: string): Promise<Response> {
  const cfg = SOURCES[source];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random());
      await sleep(backoff);
    }
    await throttle(source);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        if (retryAfter > 0 && retryAfter < 60) await sleep(retryAfter * 1000);
        lastErr = new HttpError(`${source} responded ${res.status}`, res.status);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err; // network error / timeout -> retry
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${source}: request failed`);
}

/** GET a JSON payload. Throws HttpError on non-2xx (after retries for 429/5xx). */
export async function fetchJson(source: SourceName, url: string): Promise<unknown> {
  const res = await rawFetch(source, url);
  const text = await res.text();
  if (!res.ok) throw new HttpError(`${source} responded ${res.status}`, res.status, text.slice(0, 500));
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`${source} returned non-JSON payload`, res.status, text.slice(0, 200));
  }
}

/** GET binary content (used by the local image cache). Returns null on 404. */
export async function fetchBytes(source: SourceName, url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const res = await rawFetch(source, url);
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(`${source} responded ${res.status}`, res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytes: buf, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
}
