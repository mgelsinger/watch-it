import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../config.js';
import { dbPath, getDb } from '../db.js';
import { APP_VERSION } from '../version.js';
import { createBackup } from './backup.js';
import { expireProviderMetadata } from './retention.js';

/** Only app-created recovery files qualify. Never follow symlinks or recurse. */
export function pruneManagedRecoveryFiles(dataDir: string, backupDir?: string, now = Date.now()): void {
  const cutoff = now - 30 * 86400_000;
  const prune = (directory: string, pattern: RegExp) => {
    if (!fs.existsSync(directory)) return;
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return;
    for (const name of fs.readdirSync(directory)) {
      if (!pattern.test(name)) continue;
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) fs.unlinkSync(filename);
    }
  };
  prune(path.join(dataDir, 'snapshots'), /^pre-upgrade-[\dTZ-]+\.db$/);
  prune(path.join(dataDir, 'backups'), /^before-restore-[\dTZ-]+\.watchit\.json$/);
  if (backupDir) {
    try { prune(backupDir, /^scheduled-[\dTZ-]+\.watchit\.json$/); }
    catch { maintenanceState.backup_error = 'Backup cleanup failed. Check directory permissions.'; }
  }
  if (!fs.existsSync(dataDir) || fs.lstatSync(dataDir).isSymbolicLink()) return;
  for (const name of fs.readdirSync(dataDir)) {
    if (!/^before-rollback-\d+$/.test(name)) continue;
    const directory = path.join(dataDir, name);
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) continue;
    prune(directory, /^watch-it\.db(?:-wal|-shm)?$/);
    if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  }
}

export const maintenanceState = { last_backup_at: null as string | null, backup_error: null as string | null };

/** Only ordinary files directly inside the image cache's size directories qualify. */
export function pruneImages(dataDir: string, maxBytes: number, maxAgeDays: number, now = Date.now()): { deleted: number; bytes: number } {
  const root = path.join(dataDir, 'img');
  const candidates: Array<{ filename: string; size: number; mtime: number }> = [];
  if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) return { deleted: 0, bytes: 0 };
  for (const size of fs.readdirSync(root)) {
    if (!/^(w\d+|h\d+|original)$/.test(size)) continue;
    const directory = path.join(root, size);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    for (const name of fs.readdirSync(directory)) {
      if (!/^[A-Za-z0-9]+\.(jpg|png|svg)$/.test(name)) continue;
      const filename = path.join(directory, name);
      const entry = fs.lstatSync(filename);
      if (entry.isFile() && !entry.isSymbolicLink()) candidates.push({ filename, size: entry.size, mtime: entry.mtimeMs });
    }
  }
  candidates.sort((a, b) => a.mtime - b.mtime);
  let bytes = candidates.reduce((sum, file) => sum + file.size, 0), deleted = 0;
  for (const file of candidates) {
    if (bytes <= maxBytes && now - file.mtime <= maxAgeDays * 86400_000) continue;
    fs.unlinkSync(file.filename); bytes -= file.size; deleted++;
  }
  return { deleted, bytes };
}

export function scheduledBackup(directory: string, retention: number): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString();
  const filename = `scheduled-${stamp.replace(/[:.]/g, '-')}.watchit.json`;
  const temporary = path.join(directory, `${filename}.tmp`);
  const data = JSON.stringify(createBackup(getDb()));
  const space = fs.statfsSync(directory);
  if (space.bavail * space.bsize < Buffer.byteLength(data) * 2 + 1024 * 1024) throw new Error('Insufficient backup storage');
  fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, path.join(directory, filename));
  // Delete only files created by this scheduler, after a complete new backup exists.
  const prior = fs.readdirSync(directory).filter((name) => /^scheduled-[\dTZ-]+\.watchit\.json$/.test(name)).sort().reverse();
  for (const name of prior.slice(retention)) {
    const file = path.join(directory, name);
    if (fs.lstatSync(file).isFile()) fs.unlinkSync(file);
  }
  maintenanceState.last_backup_at = stamp;
  maintenanceState.backup_error = null;
}

export function runMaintenance(): void {
  expireProviderMetadata(getDb());
  pruneManagedRecoveryFiles(config.dataDir, config.backupDirectory);
  pruneImages(config.dataDir, config.imageCacheMb * 1024 * 1024, config.imageCacheDays);
  if (!config.backupDirectory) return;
  try { scheduledBackup(config.backupDirectory, config.backupRetention); }
  catch { maintenanceState.backup_error = 'Scheduled backup failed. Check directory permissions and free storage.'; }
}

export function diagnostics() {
  let databaseBytes = 0;
  try { databaseBytes = fs.statSync(dbPath()).size; } catch { /* first boot */ }
  return {
    version: APP_VERSION, platform: os.platform(), architecture: os.arch(), node: process.version,
    database_bytes: databaseBytes,
    api_cache_entries: (getDb().prepare('SELECT count(*) AS count FROM api_cache').get() as { count: number }).count,
    image_cache_limit_mb: config.imageCacheMb,
    scheduled_backups: Boolean(config.backupDirectory), ...maintenanceState,
  };
}
