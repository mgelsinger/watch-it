// Copies non-TS assets (SQL migrations) into dist after tsc.
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'src', 'migrations');
const dest = path.join(root, 'dist', 'migrations');
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copied migrations -> ${dest}`);
