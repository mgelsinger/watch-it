import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

fs.mkdirSync('artifacts', { recursive: true });
let failed = false;
for (const production of [true, false]) {
  // npm_execpath works with npm on both Windows and Linux, without a shell.
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', ...(production ? ['--omit=dev'] : []), '--json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(`artifacts/audit-${production ? 'production' : 'all'}.json`, result.stdout || '{}');
  const audit = JSON.parse(result.stdout || '{}');
  if (!audit.metadata || audit.error) throw new Error('Dependency audit unavailable; release checks cannot pass.');
  console.log(`${production ? 'Production' : 'All dependencies'}: ${JSON.stringify(audit.metadata.vulnerabilities)}`);
  if (audit.metadata.vulnerabilities.total) failed = true;
}
process.exitCode = failed ? 1 : 0;
