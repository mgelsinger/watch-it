import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { getDb } from './db.js';
import {
  cookieValue,
  createSession,
  expiredSessionCookie,
  passwordMatches,
  removeExpiredSessions,
  revokeSession,
  sessionCookie,
  sessionIsValid,
} from './services/auth.js';

const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/status', '/api/auth/login']);
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failedLogins = new Map<string, number[]>();

function requestPath(url: string): string {
  return url.split('?', 1)[0];
}

function recentFailures(ip: string, now: number): number[] {
  const recent = (failedLogins.get(ip) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length) failedLogins.set(ip, recent);
  else failedLogins.delete(ip);
  return recent;
}

export function registerAuth(app: FastifyInstance): void {
  if (config.authPassword && config.authPassword.length < 12) {
    throw new Error('WATCH_IT_PASSWORD must contain at least 12 characters');
  }

  app.addHook('onRequest', async (req, reply) => {
    if (!config.authPassword || !req.url.startsWith('/api/') || req.method === 'OPTIONS') return;
    if (PUBLIC_API_PATHS.has(requestPath(req.url))) return;
    const authenticated = sessionIsValid(getDb(), cookieValue(req.headers.cookie));
    if (!authenticated) return reply.code(401).send({ error: 'login required' });
  });

  app.get('/api/auth/status', async (req) => {
    const enabled = Boolean(config.authPassword);
    const authenticated = !enabled || sessionIsValid(getDb(), cookieValue(req.headers.cookie));
    return { enabled, authenticated };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (!config.authPassword) return { enabled: false, authenticated: true };
    const now = Date.now();
    const failures = recentFailures(req.ip, now);
    if (failures.length >= MAX_FAILURES) {
      reply.header('retry-after', String(Math.ceil((WINDOW_MS - (now - failures[0])) / 1000)));
      return reply.code(429).send({ error: 'too many login attempts; try again later' });
    }

    const body = z.object({ password: z.string().min(1).max(1024) }).parse(req.body);
    if (!passwordMatches(config.authPassword, body.password)) {
      failedLogins.set(req.ip, [...failures, now]);
      return reply.code(401).send({ error: 'incorrect password' });
    }

    failedLogins.delete(req.ip);
    removeExpiredSessions(getDb());
    const session = createSession(getDb());
    reply.header('set-cookie', sessionCookie(session.token, config.authSecureCookie));
    return { enabled: true, authenticated: true, expires_at: session.expiresAt };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    revokeSession(getDb(), cookieValue(req.headers.cookie));
    reply.header('set-cookie', expiredSessionCookie(config.authSecureCookie));
    return { ok: true };
  });
}
