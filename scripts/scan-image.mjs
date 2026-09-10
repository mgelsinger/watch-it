import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const image = process.argv[2];
if (!image) throw new Error('Supply the exact tested image tag.');
const directory = path.resolve('artifacts');
fs.mkdirSync(directory, { recursive: true });
function run(args) {
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Image scan command failed: ${args[0]}`);
}
run(['save', '--output', path.join(directory, 'image.tar'), image]);
run(['run', '--rm', '--mount', `type=bind,src=${directory},dst=/scan`, 'aquasec/trivy:0.74.0', 'image', '--input', '/scan/image.tar', '--scanners', 'vuln', '--format', 'json', '--output', '/scan/container-audit.json']);
const report = JSON.parse(fs.readFileSync(path.join(directory, 'container-audit.json'), 'utf8'));
const findings = (report.Results ?? []).flatMap((result) => (result.Vulnerabilities ?? []).map((finding) => ({ ...finding, target: result.Target })));
const blocking = findings.filter((finding) => ['HIGH','CRITICAL'].includes(finding.Severity));
const review = JSON.parse(fs.readFileSync('docs/platform-advisories.json', 'utf8'));
const expired = Date.now() >= Date.parse(review.review_by + 'T00:00:00Z');
const unreviewed = findings.filter((finding) => finding.Severity === 'MEDIUM' && (expired || !(review.medium[finding.PkgName] ?? []).includes(finding.VulnerabilityID)));
console.log(JSON.stringify({ total: findings.length, highOrCritical: blocking.map((finding) => ({ id: finding.VulnerabilityID, package: finding.PkgName, installed: finding.InstalledVersion, fixed: finding.FixedVersion ?? null, target: finding.target })) }, null, 2));
if (unreviewed.length) console.error('Medium findings require a new applicability review:', unreviewed.map((finding) => finding.VulnerabilityID).join(', '));
process.exitCode = blocking.length || unreviewed.length ? 1 : 0;
