import { getDb } from '../db.js';

export type EventType =
  | 'new_episode'
  | 'season_premiere'
  | 'arrived_on_service'
  | 'left_service'
  | 'now_in_theaters'
  | 'now_streaming';

export function emitEvent(titleId: number, type: EventType, payload: Record<string, unknown> = {}): void {
  getDb()
    .prepare('INSERT INTO events (title_id, type, payload) VALUES (?, ?, ?)')
    .run(titleId, type, JSON.stringify(payload));
}

/** True if an identical event (same title/type/dedupe key) already exists. */
export function eventExists(titleId: number, type: EventType, payloadLike?: string): boolean {
  const db = getDb();
  if (payloadLike) {
    return !!db
      .prepare("SELECT 1 FROM events WHERE title_id = ? AND type = ? AND payload LIKE ? LIMIT 1")
      .get(titleId, type, `%${payloadLike}%`);
  }
  return !!db.prepare('SELECT 1 FROM events WHERE title_id = ? AND type = ? LIMIT 1').get(titleId, type);
}
