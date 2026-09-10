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
  reconcileCredentials,
} from './services/auth.js';

declare module 'fastify' { interface FastifyContextConfig { public?: boolean } }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export function registerAuth(app: FastifyInstance): void {
  const failedLogins = new Map<string, number[]>();
  let globalFailures: number[] = [];
  if (config.authPassword && config.authPassword.length < 12) {
    throw new Error('WATCH_IT_PASSWORD must contain at least 12 characters');
  }
  reconcileCredentials(getDb(), config.authPassword);

  app.addHook('onRequest', async (req, reply) => {
    // Reject ambiguous path spellings before routing or static-file resolution.
    const pathname = req.url.split('?', 1)[0];
    if (/%|\\|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname)) return reply.code(400).send({ error: 'invalid path' });
    if (!config.authPassword || req.routeOptions.config.public === true) return;
    const authenticated = sessionIsValid(getDb(), cookieValue(req.headers.cookie));
    if (!authenticated) return reply.code(401).send({ error: 'login required' });
  });

  app.get('/api/auth/status', { config: { public: true } }, async (req) => {
    const enabled = Boolean(config.authPassword);
    const authenticated = !enabled || sessionIsValid(getDb(), cookieValue(req.headers.cookie));
    return { enabled, authenticated };
  });

  app.post('/api/auth/login', { config: { public: true }, bodyLimit: 2048 }, async (req, reply) => {
    if (!config.authPassword) return { enabled: false, authenticated: true };
    const now = Date.now();
    for (const [ip, times] of failedLogins) {
      const recent = times.filter((time) => now - time < WINDOW_MS);
      if (recent.length) failedLogins.set(ip, recent); else failedLogins.delete(ip);
    }
    globalFailures = globalFailures.filter((time) => now - time < WINDOW_MS);
    const failures = failedLogins.get(req.ip) ?? [];
    if (failures.length >= MAX_FAILURES || globalFailures.length >= 100 || (failedLogins.size >= 1024 && !failedLogins.has(req.ip))) {
      reply.header('retry-after', String(Math.max(1, Math.ceil((WINDOW_MS - (now - (failures[0] ?? globalFailures[0] ?? now))) / 1000))));
      return reply.code(429).send({ error: 'too many login attempts; try again later' });
    }

    const body = z.object({ password: z.string().min(1).max(1024) }).parse(req.body);
    if (!passwordMatches(config.authPassword, body.password)) {
      failedLogins.set(req.ip, [...failures, now]);
      globalFailures.push(now);
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
