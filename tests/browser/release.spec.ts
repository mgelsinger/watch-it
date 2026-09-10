import { test, expect, type Page } from '@playwright/test';

const genres = [{ key: 'anime', name: 'Anime', movie_ids: [16], tv_ids: [16], names: ['Animation'] }, { key: 'korean-drama', name: 'Korean Dramas', movie_ids: [], tv_ids: [18], names: ['Drama'] }];
const card = (id: number) => ({ tmdb_id: id, media_type: 'tv', name: `Fixture ${id}`, poster_path: null, year: 2024, date: '2024-01-01', library_id: null, offers: [] });

async function enter(page: Page) {
  await page.request.post('/api/auth/login', { data: { password: 'browser-fixture-password' } });
  await page.request.put('/api/settings', { data: { pick_constraints: '{}' } });
  await page.route('**/api/browse/genres', (route) => route.fulfill({ json: { genres } }));
  await page.route('**/api/providers', (route) => route.fulfill({ json: { region: 'US', providers: [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 283, provider_name: 'Crunchyroll' }, { provider_id: 1968, provider_name: 'Crunchyroll Amazon Channel' }] } }));
}

test('login, keyboard navigation, credits and profile restore', async ({ page }, testInfo) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Password').fill('browser-fixture-password');
  await page.getByLabel('Password').press('Enter');
  await expect(page.getByRole('heading', { name: 'About watch-it' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'TMDB', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('credits.png'), fullPage: true });
  const backup = await (await page.request.get('/api/backup/export')).json();
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.watchit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByRole('heading', { name: 'Backup ready to restore' })).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await expect(page.getByText(/Restore complete\./).first()).toBeVisible();
  const saved = await (await page.request.get('/api/backup/export')).json();
  expect(saved.profile.titles).toEqual(backup.profile.titles);
});

test('first-page errors stay idle until Retry and zero-page results stop', async ({ page }) => {
  await enter(page);
  let requests = 0;
  await page.route('**/api/browse/discover?**', (route) => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 502, json: { error: 'fixture outage' } }) : route.fulfill({ json: { items: [], page: 1, total_pages: 0, stale: false } });
  });
  await page.goto('/browse?genres=anime');
  await expect(page.getByRole('alert')).toContainText('fixture outage');
  await page.waitForTimeout(500);
  expect(requests).toBe(1);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('No results for this filter combination.')).toBeVisible();
  await page.waitForTimeout(300); expect(requests).toBe(2);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
});

test('later-page retry preserves cards, retries the same page and deduplicates titles', async ({ page }) => {
  await enter(page);
  const pages: number[] = []; let failed = false;
  await page.route('**/api/browse/discover?**', (route) => {
    const number = Number(new URL(route.request().url()).searchParams.get('page')); pages.push(number);
    if (number === 2 && !failed) { failed = true; return route.fulfill({ status: 502, json: { error: 'later page failed' } }); }
    return route.fulfill({ json: { items: number === 1 ? [card(1)] : [card(1), card(2)], page: number, total_pages: 2, stale: false } });
  });
  await page.goto('/browse?genres=anime');
  await expect(page.getByRole('alert')).toContainText('later page failed');
  await expect(page.getByRole('button', { name: 'Fixture 1', exact: true })).toHaveCount(1);
  await page.waitForTimeout(300); expect(pages).toEqual([1, 2]);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fixture 2', exact: true })).toBeVisible();
  expect(pages).toEqual([1, 2, 2]);
  await expect(page.getByRole('button', { name: 'Fixture 1', exact: true })).toHaveCount(1);
});

test('filtered-empty pages require Load more and obsolete responses cannot replace new filters', async ({ page }) => {
  await enter(page);
  let requests = 0;
  await page.route('**/api/browse/discover?**', async (route) => {
    const url = new URL(route.request().url()); requests++;
    if (url.searchParams.get('type') === 'movie') {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route.fulfill({ json: { items: [card(99)], page: 1, total_pages: 1, stale: false } }).catch(() => {});
    }
    const number = Number(url.searchParams.get('page'));
    return route.fulfill({ json: { items: number === 1 ? [] : [card(2)], page: number, total_pages: 2, stale: false } });
  });
  await page.goto('/browse?genres=anime');
  await expect(page.getByText('No matching titles on this page. More pages are available.')).toBeVisible();
  await page.waitForTimeout(300); expect(requests).toBe(1);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('button', { name: 'Fixture 2', exact: true })).toBeVisible();
  const started = page.waitForRequest((request) => request.url().includes('/browse/discover?') && request.url().includes('type=movie'));
  await page.getByLabel('Type', { exact: true }).selectOption('movie'); await started;
  await page.getByLabel('Type', { exact: true }).selectOption('tv');
  await page.waitForTimeout(600);
  await expect(page.getByRole('button', { name: 'Fixture 99', exact: true })).toHaveCount(0);
});

test('genres and source variants survive URL reload and Pick preference backups', async ({ page }) => {
  await enter(page);
  await page.route('**/api/browse/discover?**', (route) => route.fulfill({ json: { items: [], page: 1, total_pages: 0, stale: false } }));
  await page.goto('/browse?genres=anime');
  await page.locator('summary').filter({ hasText: 'Genres' }).click();
  await page.getByRole('button', { name: 'Korean Dramas', exact: true }).click();
  await expect(page).toHaveURL(/korean-drama/);
  await page.locator('summary').filter({ hasText: 'Exclude services' }).click();
  await page.getByLabel('Crunchyroll', { exact: true }).click();
  await expect(page.getByLabel('Crunchyroll', { exact: true })).toBeChecked();
  await page.getByLabel('Crunchyroll Amazon Channel', { exact: true }).click();
  await expect(page.getByLabel('Crunchyroll Amazon Channel', { exact: true })).toBeChecked();
  await expect(page).toHaveURL(/exclude_providers=283%2C1968/);
  await page.reload();
  await page.locator('summary').filter({ hasText: 'Exclude services' }).click();
  await expect(page.getByLabel('Crunchyroll Amazon Channel', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Clear exclusions' }).click();
  await expect(page).not.toHaveURL(/exclude_providers/);
  await page.route('**/api/pick/next', (route) => route.fulfill({ json: { candidate: null, pool_size: 0, exhausted: true } }));
  await page.goto('/pick');
  await page.locator('summary').filter({ hasText: 'Exclude services' }).click();
  await page.getByLabel('Crunchyroll', { exact: true }).click();
  await expect(page.getByLabel('Crunchyroll', { exact: true })).toBeChecked();
  await page.getByLabel('Crunchyroll Amazon Channel', { exact: true }).click();
  await expect(page.getByLabel('Crunchyroll Amazon Channel', { exact: true })).toBeChecked();
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: /Pick for me/i }).click(); await saved;
  const backup = await (await page.request.get('/api/backup/export')).json();
  expect(JSON.parse(backup.profile.settings.find((setting: { key: string }) => setting.key === 'pick_constraints').value).excluded_provider_ids).toEqual([283, 1968]);
});
