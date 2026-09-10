const pending = new Map<string, Promise<unknown>>();

/** Share cache refreshes, including work after the HTTP response has arrived. */
export function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  if (pending.size >= 256) return Promise.reject(new Error('refresh queue full; try again shortly'));
  const promise = Promise.resolve().then(work).finally(() => { pending.delete(key); });
  pending.set(key, promise);
  return promise;
}

export async function drainRefreshes(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending.values()]);
}
