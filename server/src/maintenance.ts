import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

process.umask(0o077);
const [command, argument] = process.argv.slice(2);
const target = path.join(config.dataDir, 'watch-it.db');

async function run(): Promise<void> {
  if (command === 'fix-permissions') {
    if (config.dataDir !== '/data' || process.getuid?.() !== 0) throw new Error('Run this command as root in a one-off container with only the installation volume mounted at /data.');
    const fix = (entry: string): void => {
      const stat = fs.lstatSync(entry);
      if (stat.isSymbolicLink()) return;
      fs.chownSync(entry, 1000, 1000);
      fs.chmodSync(entry, stat.isDirectory() ? 0o700 : 0o600);
      if (stat.isDirectory()) for (const name of fs.readdirSync(entry)) fix(path.join(entry, name));
    };
    fix('/data');
    console.log('Installation volume ownership updated to UID/GID 1000.');
    return;
  }
  if (command === 'snapshot') {
    const source = new Database(target, { readonly: true, fileMustExist: true });
    const directory = path.join(config.dataDir, 'snapshots');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filename = `pre-upgrade-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const destination = path.join(directory, filename);
    try { await source.backup(destination); console.log(`Snapshot saved: snapshots/${filename}`); }
    finally { source.close(); }
    return;
  }
  if (command === 'restore-snapshot') {
    if (!argument || path.basename(argument) !== argument || !/^pre-upgrade-[\dTZ-]+\.db$/.test(argument)) throw new Error('Provide a snapshot filename from the snapshots directory.');
    const source = new Database(path.join(config.dataDir, 'snapshots', argument), { readonly: true, fileMustExist: true });
    const staged = path.join(config.dataDir, 'restore-staged.db');
    if (fs.existsSync(staged)) throw new Error('A staged restore already exists. Inspect it before retrying.');
    try {
      if (source.pragma('integrity_check', { simple: true }) !== 'ok' || (source.pragma('foreign_key_check') as unknown[]).length) throw new Error('Snapshot failed integrity checks.');
      await source.backup(staged);
    } finally { source.close(); }
    // Operator must stop the app first. Preserve the previous database and WAL.
    const recovery = path.join(config.dataDir, `before-rollback-${Date.now()}`);
    fs.mkdirSync(recovery, { mode: 0o700 });
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(target + suffix)) fs.renameSync(target + suffix, path.join(recovery, 'watch-it.db' + suffix));
    }
    fs.renameSync(staged, target);
    console.log('Snapshot restored. The previous database is preserved in a before-rollback directory.');
    return;
  }
  throw new Error('Use snapshot, or restore-snapshot <filename> with the application stopped.');
}
run().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
