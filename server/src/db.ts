import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, nowIso } from './config.js';

export type DB = Database.Database;

let db: DB | null = null;

export function dbPath(): string {
  return path.join(config.dataDir, 'watch-it.db');
}

export function getDb(): DB {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(dbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrate(): void {
  const d = getDb();
  d.exec(`CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  const applied = new Set(
    (d.prepare('SELECT name FROM migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const run = d.transaction(() => {
      d.exec(sql);
      d.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(file, nowIso());
    });
    run();
    console.log(`[db] applied migration ${file}`);
  }
}

// ---- settings helpers ----

const SETTING_DEFAULTS: Record<string, string> = {
  region: 'US',
  schedule_country: 'US',
  // TMDB network ids for the Browse "Broadcast TV" filter:
  // ABC=2, NBC=6, CBS=16, Fox=19, The CW=71. Editable in Settings.
  broadcast_networks: '2|6|16|19|71',
};

export function getSetting(key: string, fallback?: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback ?? SETTING_DEFAULTS[key] ?? '';
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function allSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ---- api_cache helpers (raw payloads with fetched_at, per spec) ----

export function cacheGet(key: string, maxAgeMs: number): { payload: unknown; fetchedAt: string; fresh: boolean } | null {
  const row = getDb().prepare('SELECT payload, fetched_at FROM api_cache WHERE key = ?').get(key) as
    | { payload: string; fetched_at: string }
    | undefined;
  if (!row) return null;
  const age = Date.now() - Date.parse(row.fetched_at);
  return { payload: JSON.parse(row.payload), fetchedAt: row.fetched_at, fresh: age < maxAgeMs };
}

export function cacheSet(key: string, payload: unknown): void {
  getDb()
    .prepare('INSERT INTO api_cache (key, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at')
    .run(key, JSON.stringify(payload), nowIso());
}
