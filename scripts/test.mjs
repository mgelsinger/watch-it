import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = readdirSync(path.join(root, 'server/test')).filter((file) => file.endsWith('.test.ts')).map((file) => `server/test/${file}`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  cwd: root, stdio: 'inherit', env: { ...process.env, WATCH_IT_LOAD_ENV: 'false', TMDB_API_KEY: '', OMDB_API_KEY: '', WATCH_IT_PASSWORD: '' },
});
process.exit(result.status ?? 1);
