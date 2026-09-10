import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync('release-config.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const problems = [];
if (!config.code_license || !fs.existsSync('LICENSE')) problems.push('Owner must select a code license and add its LICENSE text.');
if (!config.security_contact || !/^(https:\/\/|mailto:)/.test(config.security_contact)) problems.push('Owner must specify a working private security-report contact.');
if (config.distribution !== 'docker-archive') problems.push('Only the tested downloadable Docker archive is configured.');
if (process.env.GITHUB_REF_TYPE && (process.env.GITHUB_REF_TYPE !== 'tag' || process.env.GITHUB_REF_NAME !== `v${pkg.version}`)) problems.push('Run release from a version tag matching package.json.');
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log(`Release decisions verified for ${pkg.version}.`);
