// Real application screenshots with a disposable, curated sample library.
// This script never opens the user's running installation or its database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const envPath = path.join(root, '.env');
const local = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
const key = process.env.TMDB_API_KEY || local.TMDB_API_KEY;
if (!key) throw new Error('Set TMDB_API_KEY in the environment or .env before capturing screenshots.');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-screenshots-'));
Object.assign(process.env, {
  WATCH_IT_LOAD_ENV: 'false', DATA_DIR: dataDir, TMDB_API_KEY: key,
  OMDB_API_KEY: '', WATCH_IT_PASSWORD: '', WATCH_IT_SECURE_COOKIE: 'false',
  WATCH_IT_TRUSTED_PROXIES: '', BACKUP_DIR: '', WEB_DIST: path.join(root, 'web/dist'),
});
const { createApp } = await import('../server/dist/app.js');
const { getDb, closeDb, setSetting } = await import('../server/dist/db.js');
const app = await createApp({ logger: false });
let browser;
const output = path.join(root, 'docs/images');
fs.mkdirSync(output, { recursive: true });
const captureReport = { captured_at: new Date().toISOString(), data: 'Disposable sample library; live TMDB metadata and artwork.', screenshots: [] };
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function request(method, url, payload) {
    const response = await app.inject({ method, url, payload });
    if (response.statusCode >= 400) throw new Error(`Sample setup failed: ${method} ${url} (${response.statusCode})`);
    return response.json();
  }
  setSetting('region', 'US');
  const providers = await request('GET', '/api/providers');
  for (const id of [8, 350, 337]) {
    if (providers.providers.some((provider) => provider.provider_id === id)) {
      await request('PUT', '/api/my-services', { provider_id: id, enabled: true });
    }
  }
  const examples = [
    [95396, 'tv', 'watching'], [94605, 'tv', 'watching'],
    [12971, 'tv', 'wishlist'], [438631, 'movie', 'wishlist'],
    [329865, 'movie', 'saved'], [569094, 'movie', 'saved'],
    [1064213, 'movie', 'saved'], [508442, 'movie', 'watched'],
    [545611, 'movie', 'watched'], [1014505, 'movie', 'wishlist'],
    [120, 'movie', 'saved'], [4935, 'movie', 'wishlist'],
  ];
  let featuredId;
  for (const [tmdb_id, media_type, status] of examples) {
    await request('POST', '/api/titles', { tmdb_id, media_type, status });
    const row = getDb().prepare('SELECT id, name FROM titles WHERE tmdb_id = ? AND media_type = ?').get(tmdb_id, media_type);
    if (tmdb_id === 95396) featuredId = row.id;
    if (status === 'watching') {
      const episodes = getDb().prepare('SELECT e.id FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE s.title_id = ? AND s.season_number = 1 ORDER BY e.episode_number LIMIT 2').all(row.id);
      for (const episode of episodes) await request('PATCH', `/api/episodes/${episode.id}/watched`, { watched: true });
    }
    if (status === 'watched') await request('PATCH', `/api/titles/${row.id}/state`, { watched: true });
    console.log(`Sample title ready: ${row.name}`);
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  async function capture(name, route, ready) {
    if (route !== null) await page.goto(`${origin}${route}`);
    await ready();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll('img')].filter((img) => {
      const rect = img.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight;
    }).every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 30000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error(`Horizontal overflow in ${name}`);
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
    captureReport.screenshots.push({ file: `${name}.png`, route: route ?? '/pick', viewport: page.viewportSize() });
    console.log(`Captured ${name}.png`);
  }
  await capture('library', '/library', () => page.getByText('12 titles', { exact: true }).waitFor());
  await capture('browse', '/browse?genres=anime', () => page.locator('.grid img').first().waitFor({ timeout: 90000 }));
  await capture('title', `/title/${featuredId}`, () => page.getByRole('heading', { name: /^Severance/ }).waitFor());
  await capture('pick', '/pick', () => page.getByRole('button', { name: 'Pick For Me', exact: true }).waitFor());
  await page.getByRole('button', { name: 'No limit', exact: true }).click();
  await page.getByRole('button', { name: 'Movie', exact: true }).click();
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.getByRole('button', { name: 'Pick For Me', exact: true }).click();
  await capture('recommendation', null, () => page.locator('.pick-title').waitFor({ timeout: 120000 }));
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('mobile', '/library', () => page.getByText('12 titles', { exact: true }).waitFor());
  fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify(captureReport, null, 2) + '\n');
} finally {
  await browser?.close();
  await app.close();
  closeDb();
  // Only the fresh directory allocated above is removed, never DATA_DIR from .env.
  if (path.dirname(dataDir) === path.resolve(os.tmpdir()) && path.basename(dataDir).startsWith('watch-it-screenshots-')) fs.rmSync(dataDir, { recursive: true, force: true });
}
