import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb } from './db.js';
import { closeHttp } from './http.js';
import { drainRefreshes } from './singleFlight.js';
import { startCron, stopCron } from './services/sync.js';

process.umask(0o077);

async function main(): Promise<void> {
  const app = await createApp();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    app.log.info('stopping scheduled work and closing the installation');
    const deadline = setTimeout(() => { app.log.error('shutdown deadline exceeded'); process.exit(1); }, 25_000);
    try {
      await stopCron();
      const closed = app.close();
      await closeHttp();
      await drainRefreshes();
      await closed;
      closeDb();
      clearTimeout(deadline);
    } catch {
      app.log.error('shutdown failed');
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  await app.listen({ port: config.port, host: config.host });
  startCron();
  app.log.info('watch-it is ready');
}

main().catch(() => { console.error('Startup failed. Check configuration and data-directory permissions.'); closeDb(); process.exit(1); });
