import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate, getDb } from './db.js';
import { expireProviderMetadata } from './services/retention.js';
import { pruneImages, pruneManagedRecoveryFiles } from './services/maintenance.js';
import { HttpError } from './http.js';
import { titleRoutes } from './routes/titles.js';
import { systemRoutes } from './routes/system.js';
import { browseRoutes } from './routes/browse.js';
import { pickRoutes } from './routes/pick.js';
import { ZodError } from 'zod';
import { registerAuth } from './auth.js';

export async function createApp(options: { logger?: boolean } = {}) {
  migrate();
  expireProviderMetadata(getDb());
  pruneImages(config.dataDir, config.imageCacheMb * 1024 * 1024, config.imageCacheDays);
  pruneManagedRecoveryFiles(config.dataDir, config.backupDirectory);

  const app = Fastify({
    logger: options.logger === false ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'], serializers: { req: (req) => ({ method: req.method, url: req.url?.split('?')[0] }) } },
    bodyLimit: 64 * 1024,
    trustProxy: config.trustedProxies.length ? config.trustedProxies : false,
    requestTimeout: 30_000,
    connectionTimeout: 10_000,
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid request', issues: err.issues });
    }
    const status = err instanceof HttpError ? (err.status === 429 ? 503 : err.status) : err.statusCode ?? 500;
    app.log.error({ name: err.name, status }, 'request failed');
    return reply.code(status >= 400 && status <= 599 ? status : 500).send({ error: status < 500 || err instanceof HttpError ? err.message : 'Request failed. Check installation logs and try again.' });
  });

  registerAuth(app);

  await app.register(titleRoutes);
  await app.register(systemRoutes);
  await app.register(browseRoutes);
  await app.register(pickRoutes);

  // Serve the built frontend; SPA fallback for non-API routes.
  const webDist = config.webDist || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, serve: false });
    app.get<{ Params: { '*': string } }>('/*', { config: { public: true } }, async (req, reply) => {
      const relative = req.params['*'];
      if (relative === 'demo' || relative === 'demo/') return reply.sendFile('demo/index.html');
      if (/^(api|img)(\/|$)/.test(relative)) return reply.code(404).send({ error: 'not found' });
      const resolved = path.resolve(webDist, relative);
      const within = resolved.startsWith(path.resolve(webDist) + path.sep);
      if (within && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return reply.sendFile(relative);
      if (path.extname(relative)) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`web dist not found at ${webDist}; API-only mode (use vite dev server)`);
  }

  return app;
}
