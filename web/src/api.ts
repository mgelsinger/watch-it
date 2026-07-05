import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const opts: RequestInit = { ...init };
  if (init?.json !== undefined) {
    opts.method = init.method ?? 'POST';
    opts.headers = { 'content-type': 'application/json', ...init.headers };
    opts.body = JSON.stringify(init.json);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export function useApi<T>(path: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (d: T | null) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}

/** Local image-cache URL for a TMDB image path ("/abc.jpg"). */
export function img(path: string | null | undefined, size = 'w342'): string | null {
  if (!path) return null;
  return `/img/${size}${path}`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(`${d.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const target = new Date(`${d.slice(0, 10)}T12:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  return Math.round((target - Date.now()) / 86400_000);
}

export function countdown(d: string | null | undefined): string {
  const n = daysUntil(d);
  if (n === null) return '';
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n < 30) return `in ${n} days`;
  if (n < 60) return 'in about a month';
  return `in ${Math.round(n / 30)} months`;
}
