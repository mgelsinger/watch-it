import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db.js';

export const SESSION_COOKIE = 'watch_it_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Rotating or disabling the installation password revokes previous sessions. */
export function reconcileCredentials(db: DB, password: string): void {
  const prior = db.prepare('SELECT salt, password_digest FROM auth_configuration WHERE id = 1').get() as { salt: string; password_digest: string } | undefined;
  const salt = prior?.salt ?? randomBytes(32).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  if (prior?.password_digest === hash) return;
  db.transaction(() => {
    db.prepare('DELETE FROM auth_sessions').run();
    db.prepare('INSERT OR REPLACE INTO auth_configuration (id, salt, password_digest) VALUES (1, ?, ?)').run(salt, hash);
  })();
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function tokenHash(token: string): string {
  return digest(token).toString('hex');
}

export function passwordMatches(expected: string, provided: string): boolean {
  return timingSafeEqual(digest(expected), digest(provided));
}

export function cookieValue(header: string | undefined, name = SESSION_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : null;
  }
  return null;
}

export function createSession(db: DB, now = new Date()): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  db.prepare(`
    INSERT INTO auth_sessions (token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash(token), createdAt, expiresAt, createdAt);
  return { token, expiresAt };
}

export function sessionIsValid(db: DB, token: string | null, now = new Date()): boolean {
  if (!token) return false;
  const hash = tokenHash(token);
  const row = db.prepare('SELECT expires_at, last_seen_at FROM auth_sessions WHERE token_hash = ?').get(hash) as
    | { expires_at: string; last_seen_at: string }
    | undefined;
  if (!row) return false;
  if (Date.parse(row.expires_at) <= now.getTime()) {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hash);
    return false;
  }
  if (now.getTime() - Date.parse(row.last_seen_at) >= 6 * 60 * 60 * 1000) {
    db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?').run(now.toISOString(), hash);
  }
  return true;
}

export function revokeSession(db: DB, token: string | null): void {
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function removeExpiredSessions(db: DB, now = new Date()): void {
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now.toISOString());
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function expiredSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}
