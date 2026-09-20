// Opt-in live journey, only against the disposable server launched by test-setup.py.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = new URL(process.argv[2]);
if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || !origin.port || origin.port === '8300') throw new Error('Use an isolated setup-test port.');
const local = fs.existsSync('.env') ? dotenv.parse(fs.readFileSync('.env')) : {};
const key = process.env.TMDB_API_KEY || local.TMDB_API_KEY;
if (!key) throw new Error('A TMDB key is required for this opt-in live setup check.');
const browser = await chromium.launch({ headless: true });
let stage = 'open fresh installation';
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.setDefaultTimeout(90000);
  await page.goto(`${origin}settings`);
  await page.getByText(/Start here: paste your TMDB/).waitFor();
  await page.getByLabel('TMDB API key', { exact: true }).fill(key);
  stage = 'verify TMDB key';
  await page.getByRole('button', { name: 'Verify and save TMDB key' }).click();
  await page.getByText('TMDB API key verified and saved. It works immediately.').waitFor();
  assert.equal(await page.getByLabel('TMDB API key', { exact: true }).inputValue(), '');
  await page.getByLabel('Watch-provider region').selectOption('US');
  stage = 'choose services and preferences';
  await page.getByRole('link', { name: 'Pick For Me', exact: true }).click();
  await page.getByRole('button', { name: '45 min', exact: true }).click();
  await page.getByRole('button', { name: 'TV show', exact: true }).click();
  await page.getByRole('button', { name: 'Light / comedy', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Choose your streaming services' }).click();
  for (const service of ['Netflix', 'Apple TV', 'Disney Plus']) {
    const checkbox = page.getByLabel(`Use ${service}`, { exact: true });
    await checkbox.click();
    await page.waitForFunction((label) => document.querySelector(`input[aria-label="${label}"]`)?.checked, `Use ${service}`);
  }
  const response = page.waitForResponse((res) => res.url().endsWith('/api/pick/next'));
  stage = 'request recommendation';
  await page.getByRole('button', { name: 'Pick For Me', exact: true }).click();
  const result = await (await response).json();
  assert.ok(result.candidate, 'The live 45-minute comedy journey should return a recommendation.');
  assert.ok(result.candidate.runtime > 0 && result.candidate.runtime <= 45 && !result.candidate.runtime_estimated);
  assert.ok(result.candidate.providers.every((offer) => [8, 350, 337].includes(offer.provider_id)));
  const watchLink = page.getByRole('link', { name: 'Watch options on TMDB' });
  stage = 'check watch-options destination';
  assert.match(await watchLink.getAttribute('href'), /^https:\/\/www\.themoviedb\.org\/tv\/\d+.*\/watch/);
  // Verify the destination without a browser trace that could retain submitted keys.
  const watchOptions = await page.request.get(await watchLink.getAttribute('href'));
  assert.ok(watchOptions.ok(), `Watch-options page returned ${watchOptions.status()}`);
  await page.getByRole('button', { name: `Open full details for ${result.candidate.name}` }).click();
  stage = 'preview then save';
  await page.locator('.detail-back').waitFor();
  assert.deepEqual((await (await page.request.get(`${origin}api/titles`)).json()).titles, []);
  await page.getByRole('button', { name: /Back to Pick/ }).click();
  await page.getByRole('button', { name: 'Add to Watchlist', exact: true }).click();
  await page.getByText(`${result.candidate.name} was added to your Watchlist.`).waitFor();
  const library = await (await page.request.get(`${origin}api/titles`)).json();
  assert.equal(library.titles.length, 1);
  await page.goto(`${origin}title/${library.titles[0].id}`);
  stage = 'mark episode and verify persistence';
  const firstSeason = page.locator('.season').filter({ has: page.getByText('Season 1', { exact: true }) });
  if (!await firstSeason.getAttribute('open').then((value) => value !== null)) await firstSeason.locator('summary').click();
  const progress = page.waitForResponse((res) => res.url().includes('/api/episodes/') && res.request().method() === 'PATCH');
  await firstSeason.getByRole('checkbox').first().check();
  await progress;
  await page.reload();
  assert.match(await firstSeason.locator('summary').innerText(), /1\/\d+ watched/);
  const exported = await (await page.request.get(`${origin}api/backup/export`)).text();
  stage = 'export personal profile';
  assert.ok(!exported.includes(key));
  const profile = JSON.parse(exported);
  assert.equal(profile.version, 3);
  assert.equal(profile.profile.titles[0].record.name, `TMDB tv ${result.candidate.tmdb_id}`);
  const restored = await page.request.post(`${origin}api/backup/restore`, { data: { backup: profile, mode: 'replace' } });
  stage = 'restore and rehydrate';
  assert.ok(restored.ok());
  const restoredLibrary = await (await page.request.get(`${origin}api/titles`)).json();
  const restoredId = restoredLibrary.titles[0].id;
  const refresh = await page.request.post(`${origin}api/titles/${restoredId}/refresh`);
  assert.ok(refresh.ok());
  await page.goto(`${origin}title/${restoredId}`);
  await page.locator('h1').waitFor();
  assert.ok((await page.locator('h1').innerText()).includes(result.candidate.name));
  assert.match(await firstSeason.locator('summary').innerText(), /1\/\d+ watched/);
  await page.goto(`${origin}demo/`);
  stage = 'check sample isolation';
  await page.getByRole('button', { name: 'Add to Watchlist', exact: true }).click();
  assert.equal((await (await page.request.get(`${origin}api/titles`)).json()).titles.length, 1);
  const report = { passed: true, captured_at: new Date().toISOString(), title: result.candidate.name, runtime: result.candidate.runtime,
    checks: ['blank-key-first-run', 'key-field-live-verification', 'key-field-cleared', 'region-and-services', '45-minute-comedy', 'watch-options-http', 'preview-without-saving', 'watchlist-save', 'episode-persistence', 'personal-only-export', 'export-omits-key', 'restore-and-rehydrate-preserves-progress', 'demo-isolation'] };
  fs.writeFileSync(path.resolve('artifacts/setup-journey.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch {
  // Playwright action errors can contain a filled value; never print them for a real key.
  throw new Error(`Live setup journey failed at: ${stage}. Detailed browser errors are withheld to protect the API key.`);
} finally { await browser.close(); }
