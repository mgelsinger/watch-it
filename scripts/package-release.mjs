import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const smoke = JSON.parse(fs.readFileSync('artifacts/docker-smoke.json', 'utf8'));
if (!smoke.passed || !/^sha256:[a-f0-9]{64}$/.test(smoke.image_id)) throw new Error('A passing image smoke report is required.');
const tag = `watch-it:${version}`;
const archive = `artifacts/watch-it-${version}-linux-amd64.tar`;
for (const args of [['tag', smoke.image_id, tag], ['save', '--output', archive, tag]]) {
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Could not package the tested image');
}
const hash = createHash('sha256');
for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
fs.writeFileSync('artifacts/checksums.txt', `${hash.digest('hex')}  watch-it-${version}-linux-amd64.tar\n${smoke.image_id}  Docker image ID\n`);
