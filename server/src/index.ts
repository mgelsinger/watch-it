import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './db.js';
import { titleRoutes } from './routes/titles.js';
import { systemRoutes } from './routes/system.js';
import { browseRoutes } from './routes/browse.js';
import { pickRoutes } from './routes/pick.js';
import { startCron } from './services/sync.js';
import { ZodError } from 'zod';
import { registerAuth } from './auth.js';

async function main(): Promise<void> {
  migrate();

  const app = Fastify({
    logger: { level: 'info' }, // stdout is the log system (docker logs)
    bodyLimit: 50 * 1024 * 1024, // library imports can be large
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid request', issues: err.issues });
    }
    app.log.error(err);
    return reply.code(err.statusCode && err.statusCode >= 400 ? err.statusCode : 500).send({ error: err.message });
  });

  registerAuth(app);

  await app.register(titleRoutes);
  await app.register(systemRoutes);
  await app.register(browseRoutes);
  await app.register(pickRoutes);

  // Serve the built frontend; SPA fallback for non-API routes.
  const webDist = config.webDist || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/img/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`web dist not found at ${webDist}; API-only mode (use vite dev server)`);
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
  startCron();
  app.log.info(`watch-it ready on http://localhost:${config.port}`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
