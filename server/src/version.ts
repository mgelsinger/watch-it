import fs from 'node:fs';

// Both src/ and dist/ are two levels below the authoritative root manifest.
export const APP_VERSION: string = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
