import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// This entry point is only used by tests and is excluded from the release image.
process.env.WATCH_IT_LOAD_ENV = 'false';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-browser-'));
process.env.TMDB_API_KEY = '';
process.env.OMDB_API_KEY = '';
process.env.WATCH_IT_PASSWORD = 'browser-fixture-password';
process.env.WEB_DIST = path.resolve('web/dist');
const { createApp } = await import('../server/dist/app.js');
const { getDb, closeDb } = await import('../server/dist/db.js');
const app = await createApp({ logger: false });
getDb().prepare("INSERT INTO titles (id, tmdb_id, media_type, name, original_language) VALUES (1, 123, 'tv', 'Saved fixture', 'ja')").run();
getDb().prepare("INSERT INTO user_state (title_id, status, notes) VALUES (1, 'saved', 'Private fixture note')").run();
await app.listen({ host: '127.0.0.1', port: 8317 });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); closeDb(); });
