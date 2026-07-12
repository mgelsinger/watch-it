import type { DB } from '../db.js';
import { getDb } from '../db.js';

const RETENTION_DAYS = 30;

export interface CleanupResult {
  preview_titles: number;
  api_cache_entries: number;
}

export function pruneDisposableData(db: DB = getDb(), now = new Date()): CleanupResult {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400_000).toISOString();
  const previewTitles = db.prepare(`
    DELETE FROM titles
    WHERE id IN (
      SELECT t.id FROM titles t
      LEFT JOIN user_state us ON us.title_id = t.id
      WHERE us.title_id IS NULL AND t.added_at < ?
    )
  `).run(cutoff);
  const cacheEntries = db.prepare('DELETE FROM api_cache WHERE fetched_at < ?').run(cutoff);
  return {
    preview_titles: previewTitles.changes,
    api_cache_entries: cacheEntries.changes,
  };
}
