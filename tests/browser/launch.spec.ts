import { test, expect } from '@playwright/test';

test('sample demo works without login, network calls, or access to the installation library', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/demo/');
  await expect(page.getByRole('heading', { name: 'Find your next watch and keep your place.' })).toBeVisible();
  await expect(page.getByText('Sample content only.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View sample watch options' }).click();
  await expect(page.getByRole('heading', { name: 'Sample watch options (US)' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to Watchlist', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText('added to the sample library');
  await page.getByRole('button', { name: 'E3', exact: true }).click();
  await expect(page.locator('#progress')).toContainText('3 of 6');
  await page.getByLabel('Netflix', { exact: true }).uncheck();
  await page.getByLabel('Apple TV', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Pick For Me', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No sample titles fit' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.locator('#progress')).toContainText('2 of 6');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests.every((url) => new URL(url).pathname === '/demo/')).toBe(true);
});

test('first-use key fields, 45-minute pick, preview, watch options, save, and episode progress', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { password: 'browser-fixture-password' } });
  // Restore a clean profile between desktop and mobile without touching credentials.
  const backup = await (await page.request.get('/api/backup/export')).json();
  const headers = { 'x-watch-it-settings': '1' };
  await page.request.put('/api/settings/keys/tmdb', { headers, data: { key: '' } });
  const existing = await (await page.request.get('/api/titles')).json();
  for (const title of existing.titles) if (title.tmdb_id === 42) await page.request.delete(`/api/titles/${title.id}`);
  await page.request.put('/api/settings', { data: { pick_constraints: '{}' } });
  await page.goto('/settings');
  await expect(page.getByText(/Start here: paste your TMDB/)).toBeVisible();
  await page.getByLabel('TMDB API key', { exact: true }).fill('wrong-token');
  await page.getByRole('button', { name: 'Verify and save TMDB key' }).click();
  await expect(page.getByRole('alert')).toContainText('32-character');
  await page.getByLabel('TMDB API key', { exact: true }).fill('a'.repeat(32));
  await page.getByRole('button', { name: 'Verify and save TMDB key' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'TMDB API key verified and saved. It works immediately.' })).toBeVisible();
  await expect(page.getByLabel('TMDB API key', { exact: true })).toHaveValue('');
  await page.getByLabel('Watch-provider region').selectOption('US');
  await page.getByRole('link', { name: 'Pick For Me', exact: true }).click();
  await page.getByRole('button', { name: '45 min', exact: true }).click();
  await page.getByRole('button', { name: 'TV show', exact: true }).click();
  await page.getByRole('button', { name: 'Light / comedy', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Choose your streaming services' }).click();
  if (!await page.getByLabel('Use Netflix', { exact: true }).isChecked()) await page.getByLabel('Use Netflix', { exact: true }).click();
  await expect(page.getByLabel('Use Netflix', { exact: true })).toBeChecked();
  await page.getByLabel('Only show services I already use').check();
  await page.getByRole('button', { name: 'Pick For Me', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Launch fixture' })).toBeVisible();
  await expect(page.getByText('24 min listed episode runtime within your 45 min limit')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Watch options on TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org/tv/42/watch?locale=US');
  await page.getByRole('button', { name: 'Open full details for Launch fixture' }).click();
  const beforeSave = await (await page.request.get('/api/titles')).json();
  expect(beforeSave.titles.some((title: { tmdb_id: number }) => title.tmdb_id === 42)).toBe(false);
  await page.getByRole('button', { name: /Back to.*Pick/i }).click();
  await page.getByRole('button', { name: 'Add to Watchlist', exact: true }).click();
  await expect(page.getByText('Launch fixture was added to your Watchlist.')).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Launch fixture', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Launch fixture' })).toBeVisible();
  const detailUrl = new URL(page.url()).pathname;
  const detail = await (await page.request.get(`/api${detailUrl.replace('/title/', '/titles/')}`)).json();
  const progressSaved = page.waitForResponse((response) => response.url().includes('/api/episodes/') && response.request().method() === 'PATCH');
  await page.getByLabel('Mark episode 1 watched', { exact: true }).check();
  await progressSaved;
  await page.reload();
  await expect(page.getByText(/1\/3 watched/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const exported = await (await page.request.get('/api/backup/export')).text();
  expect(exported).not.toContain('a'.repeat(32));
  expect(detail.id).toBeTruthy();
  await page.request.post('/api/backup/restore', { data: { mode: 'replace', backup } });
  await page.request.put('/api/settings/keys/tmdb', { headers, data: { key: '' } });
});

test('recommendation failures support retry and empty results offer explicit changes', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { password: 'browser-fixture-password' } });
  let calls = 0;
  await page.route('**/api/pick/next', (route) => {
    calls++;
    return calls === 1 ? route.fulfill({ status: 503, json: { error: 'Add your TMDB API key in Settings > API keys.' } })
      : route.fulfill({ json: { candidate: null, pool_size: 0, empty: { message: 'No titles had a known runtime within your limit.', loosen: [{ label: 'No time limit', patch: { time: null } }] } } });
  });
  await page.goto('/pick');
  await page.getByRole('button', { name: 'Pick For Me', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('TMDB API key');
  await page.getByRole('button', { name: 'Retry recommendation' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing fits' })).toBeVisible();
  await page.getByRole('button', { name: 'No time limit' }).click();
  expect(calls).toBe(3);
});

test('missing mood choices preserve saved filters and can be retried; service search explains no matches', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { password: 'browser-fixture-password' } });
  await page.request.put('/api/settings', { data: { pick_constraints: JSON.stringify({ genres: ['comedy'] }) } });
  let genreCalls = 0;
  await page.route('**/api/browse/genres', (route) => ++genreCalls === 1
    ? route.fulfill({ status: 502, json: { error: 'Provider temporarily unavailable.' } })
    : route.fulfill({ json: { genres: [{ key: 'comedy', name: 'Comedy' }] } }));
  await page.route('**/api/providers', (route) => route.fulfill({ json: { region: 'US', providers: [{ provider_id: 8, provider_name: 'Netflix', enabled: true }] } }));
  await page.goto('/pick');
  await expect(page.getByRole('alert')).toContainText('Provider temporarily unavailable');
  await expect(page.getByText(/Saved mood filters still apply: comedy/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry mood choices' }).click();
  await expect(page.getByRole('button', { name: 'Light / comedy' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Saved mood filters still apply/)).toHaveCount(0);
  await page.locator('summary').filter({ hasText: 'Choose your streaming services' }).click();
  await page.getByLabel('Find your streaming service').fill('no matching service');
  await expect(page.getByRole('status')).toContainText('No services match this search in US');
  await page.getByRole('button', { name: 'Clear service search' }).click();
  await expect(page.getByLabel('Use Netflix', { exact: true })).toBeChecked();
  await page.request.put('/api/settings', { data: { pick_constraints: '{}' } });
});
