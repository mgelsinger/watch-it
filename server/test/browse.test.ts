import test, { after, before, beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { cacheSet, getDb, migrate } from '../src/db.js';
import { discoverGrid, genreRow, getGenres, libraryGrid, type BrowseFilters } from '../src/services/browse.js';
import { addTitle, refreshTitle } from '../src/services/library.js';
import { pickNext } from '../src/services/pick.js';
import { runDaily } from '../src/services/sync.js';
import { englishVersion, knownEnglish } from '../src/services/englishVersions.js';
import { createBackup, restoreBackup } from '../src/services/backup.js';
import Fastify from 'fastify';
import { browseRoutes } from '../src/routes/browse.js';
import { pickRoutes } from '../src/routes/pick.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-it-browse-test-'));
const standardGenres = [
  { key: 'drama', name: 'Drama', movie_ids: [18], tv_ids: [18], names: ['Drama'] },
  { key: 'animation', name: 'Animation', movie_ids: [16], tv_ids: [16], names: ['Animation'] },
  { key: 'comedy', name: 'Comedy', movie_ids: [35], tv_ids: [35], names: ['Comedy'] },
];
const filters: BrowseFilters = {
  type: 'both', genres: [], watch: 'any', status: '', library: '', yearMin: null, yearMax: null,
  rating: null, bingeable: false, sort: 'popular',
};
const catalog = [
  { id: 1, media_type: 'tv', original_language: 'ko', genre_ids: [18], name: 'Korean drama' },
  { id: 2, media_type: 'tv', original_language: 'en', genre_ids: [18], name: 'English drama' },
  { id: 3, media_type: 'tv', original_language: 'ko', genre_ids: [10764], name: 'Korean reality' },
  { id: 4, media_type: 'movie', original_language: 'ko', genre_ids: [18], name: 'Korean movie' },
  { id: 5, media_type: 'tv', original_language: 'ja', genre_ids: [16], name: 'Anime series' },
  { id: 5, media_type: 'movie', original_language: 'ja', genre_ids: [16], name: 'Anime movie' },
  { id: 6, media_type: 'movie', original_language: 'en', genre_ids: [16], name: 'English animation' },
  { id: 7, media_type: 'tv', original_language: 'ja', genre_ids: [18], name: 'Japanese drama' },
  { id: 8, media_type: 'tv', original_language: 'en', genre_ids: [35], name: 'English comedy' },
] as const;

const versionFixtures = [
  { id: 93405, media_type: 'tv', original_language: 'ko', genre_ids: [18], name: 'Squid Game', first_air_date: '2021-09-17' },
  { id: 99966, media_type: 'tv', original_language: 'ko', genre_ids: [18], name: 'All of Us Are Dead', first_air_date: '2022-01-28' },
  { id: 30991, media_type: 'tv', original_language: 'ja', genre_ids: [16], name: 'Cowboy Bebop', first_air_date: '1998-04-03' },
  { id: 71712, media_type: 'tv', original_language: 'en', genre_ids: [18], name: 'The Good Doctor', first_air_date: '2017-09-25' },
  { id: 84469, media_type: 'tv', original_language: 'en', genre_ids: [18], name: 'Cowboy Bebop', first_air_date: '2021-11-19' },
  { id: 111110, media_type: 'tv', original_language: 'en', genre_ids: [18], name: 'ONE PIECE', first_air_date: '2023-08-31' },
  { id: 351460, media_type: 'movie', original_language: 'en', genre_ids: [18], name: 'Death Note', release_date: '2017-08-25' },
] as const;

before(() => {
  config.dataDir = dataDir;
  config.omdbKey = '';
  migrate();
});

beforeEach(() => {
  config.tmdbKey = 'test-key';
  getDb().exec('DELETE FROM titles; DELETE FROM api_cache; DELETE FROM discover_queries; DELETE FROM my_services; DELETE FROM settings; DELETE FROM suggestion_log; DELETE FROM suggestion_suppressions');
  cacheSet('tmdb_genres_merged', standardGenres);
});

after(() => {
  getDb().close();
  for (const file of fs.readdirSync(dataDir)) fs.unlinkSync(path.join(dataDir, file));
  fs.rmdirSync(dataDir);
});

function mockTmdb(t: TestContext, emptyDiscover = false, withDubs = false): URL[] {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.hostname === 'query.wikidata.org') return Response.json({ results: { bindings: [] } });
    if (url.pathname.startsWith('/3/discover/')) {
      const mediaType = url.pathname.split('/').at(-1);
      const genreIds = url.searchParams.get('with_genres')?.split('|').map(Number);
      const language = url.searchParams.get('with_original_language');
      const available = [...catalog, ...(withDubs ? versionFixtures.filter((item) => [93405, 99966].includes(item.id)) : [])];
      const results = emptyDiscover ? [] : available.filter((entry) =>
        entry.media_type === mediaType && (!language || entry.original_language === language) &&
        (!genreIds || entry.genre_ids.some((id) => genreIds.includes(id))),
      ).map((entry) => ({ ...entry, title: entry.name, popularity: 10, vote_average: 8 }));
      return Response.json({ results, page: Number(url.searchParams.get('page') ?? 1), total_pages: 3 });
    }
    if (url.pathname.endsWith('/watch/providers')) return Response.json({ results: {
      US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: null }] },
    } });
    const entry = [...catalog, ...versionFixtures].find((item) => url.pathname === `/3/${item.media_type}/${item.id}`);
    if (entry) return Response.json({
      ...entry, title: entry.name, genres: entry.genre_ids.map((id) => ({
        id, name: standardGenres.find((genre) => genre.tv_ids.includes(id))?.name ?? 'Reality',
      })),
      vote_count: 500, vote_average: 8, popularity: 10, episode_run_time: [45], runtime: 100,
      networks: [{ id: 2 }], status: 'Ended', seasons: [], 'watch/providers': { results: {} },
    });
    return Response.json({ error: `Unexpected test endpoint: ${url.pathname}` }, { status: 400 });
  });
  return requests;
}

function identities(items: { media_type: string; tmdb_id: number }[]): string[] {
  return items.map((item) => `${item.media_type}:${item.tmdb_id}`).sort();
}

test('a warm TMDB genre cache exposes the new options immediately without duplicates', async () => {
  const genres = await getGenres();
  assert.equal(genres.find((genre) => genre.key === 'korean-drama')?.name, 'Korean Dramas');
  assert.equal(genres.find((genre) => genre.key === 'anime')?.name, 'Anime');
  assert.equal(new Set(genres.map((genre) => genre.key)).size, genres.length);
  assert.equal((await getGenres()).length, genres.length);
});

test('Korean drama discovery matches Korean TV dramas and honors other filters and pagination', async (t) => {
  const requests = mockTmdb(t);
  const result = await discoverGrid({
    ...filters, genres: ['korean-drama'], watch: 'streaming', status: 'ended', yearMin: 2020, yearMax: 2025, rating: 7,
  }, 2);
  assert.deepEqual(identities(result.items), ['tv:1']);
  assert.equal(result.page, 2);
  assert.equal(result.total_pages, 3);
  const discover = requests.filter((url) => url.pathname.startsWith('/3/discover/'));
  assert.equal(discover.length, 1);
  const params = discover[0].searchParams;
  for (const [key, value] of Object.entries({
    with_original_language: 'ko', with_genres: '18', page: '2', watch_region: 'US',
    with_watch_monetization_types: 'flatrate|free|ads', with_status: '3',
    'first_air_date.gte': '2020-01-01', 'first_air_date.lte': '2025-12-31', 'vote_average.gte': '7',
  })) assert.equal(params.get(key), value, key);
});

test('anime discovery includes Japanese animated movies and TV shows', async (t) => {
  mockTmdb(t);
  assert.deepEqual(identities((await discoverGrid({ ...filters, genres: ['anime'] }, 1)).items), ['movie:5', 'tv:5']);
});

test('mixed genres preserve OR matching and remove duplicate cards within each media type', async (t) => {
  mockTmdb(t);
  const result = await discoverGrid({ ...filters, genres: ['korean-drama', 'anime', 'animation', 'comedy'] }, 1);
  assert.deepEqual(identities(result.items), ['movie:5', 'movie:6', 'tv:1', 'tv:5', 'tv:8']);
});

test('Korean dramas with Movies selected return no matches without querying movie discovery', async (t) => {
  const requests = mockTmdb(t);
  const result = await discoverGrid({ ...filters, type: 'movie', genres: ['korean-drama'] }, 1);
  assert.deepEqual(result.items, []);
  assert.equal(result.total_pages, 0);
  assert.deepEqual(requests, []);
});

test('genre rows use the same category filters and cached rows preserve them', async (t) => {
  const requests = mockTmdb(t);
  assert.deepEqual(identities((await genreRow('korean-drama'))!.items), ['tv:1']);
  assert.deepEqual(identities((await genreRow('anime'))!.items), ['movie:5', 'tv:5']);
  const count = requests.length;
  assert.deepEqual(identities((await genreRow('anime'))!.items), ['movie:5', 'tv:5']);
  assert.equal(requests.length, count);
});

test('library categories match stored language, genre and media type even with a cold offline cache', async () => {
  for (const entry of catalog) {
    const titleId = getDb().prepare(`
      INSERT INTO titles (tmdb_id, media_type, name, original_language, genres) VALUES (?, ?, ?, ?, ?)
    `).run(entry.id, entry.media_type, entry.name, entry.original_language, JSON.stringify(
      entry.genre_ids.map((id) => standardGenres.find((genre) => genre.tv_ids.includes(id))?.name ?? 'Reality'),
    )).lastInsertRowid;
    getDb().prepare("INSERT INTO user_state (title_id, status) VALUES (?, 'wishlist')").run(titleId);
  }
  config.tmdbKey = '';
  getDb().exec('DELETE FROM api_cache');
  assert.deepEqual(identities(await libraryGrid({ ...filters, genres: ['korean-drama'] })), ['tv:1']);
  assert.deepEqual(identities(await libraryGrid({ ...filters, genres: ['anime'] })), ['movie:5', 'tv:5']);
  assert.deepEqual(identities(await libraryGrid({ ...filters, genres: ['korean-drama', 'anime', 'comedy'] })),
    ['movie:5', 'tv:1', 'tv:5', 'tv:8']);
  assert.deepEqual(await libraryGrid({ ...filters, type: 'movie', genres: ['korean-drama'] }), []);
});

test('Pick For Me applies category constraints to every discovery source', async (t) => {
  const requests = mockTmdb(t, true);
  await pickNext({
    time: 60, type: 'either', genres: ['korean-drama', 'anime'], my_services_only: false,
    include_rent_buy: false, exclude_library_titles: true,
  }, []);
  const discover = requests.filter((url) => url.pathname.startsWith('/3/discover/'));
  assert.equal(discover.length, 8);
  for (const url of discover) {
    const language = url.searchParams.get('with_original_language');
    assert.ok(language === 'ko' || language === 'ja');
    assert.equal(url.searchParams.get('with_genres'), language === 'ko' ? '18' : '16');
    if (language === 'ko') assert.equal(url.pathname, '/3/discover/tv');
    assert.equal(url.searchParams.get('with_runtime.lte'), '60');
    assert.equal(url.searchParams.get('watch_region'), 'US');
    assert.equal(url.searchParams.get('with_watch_providers'), null);
  }
});

test('adding and refreshing titles stores original language for library filtering', async (t) => {
  mockTmdb(t);
  for (const [tmdbId, mediaType, language] of [[1, 'tv', 'ko'], [5, 'movie', 'ja']] as const) {
    const titleId = await addTitle(tmdbId, mediaType);
    const stored = () => getDb().prepare('SELECT original_language FROM titles WHERE id = ?').get(titleId);
    assert.deepEqual(stored(), { original_language: language });
    getDb().prepare('UPDATE titles SET original_language = NULL WHERE id = ?').run(titleId);
    await refreshTitle(titleId);
    assert.deepEqual(stored(), { original_language: language });
  }
});

test('daily sync backfills language for existing ended and dropped titles', async (t) => {
  mockTmdb(t, true);
  const titleId = getDb().prepare(`
    INSERT INTO titles (tmdb_id, media_type, name, status_upstream) VALUES (1, 'tv', 'Existing Korean drama', 'Ended')
  `).run().lastInsertRowid;
  getDb().prepare("INSERT INTO user_state (title_id, status) VALUES (?, 'dropped')").run(titleId);
  await runDaily();
  assert.deepEqual(getDb().prepare('SELECT original_language FROM titles WHERE id = ?').get(titleId), { original_language: 'ko' });
  assert.deepEqual(identities(await libraryGrid({ ...filters, genres: ['korean-drama'] })), ['tv:1']);
});

test('English audio preference retains original-language titles and prioritizes verified dubs without adding remakes', async (t) => {
  const requests = mockTmdb(t, false, true);
  const result = await discoverGrid({ ...filters, genres: ['korean-drama'], preferEnglish: true }, 1);
  assert.deepEqual(identities(result.items), ['tv:1', 'tv:93405', 'tv:99966']);
  assert.deepEqual(result.items.map((item) => item.english_version?.audio), ['dub', 'dub', 'unknown']);
  assert.equal(result.items.find((item) => item.tmdb_id === 93405)?.english_version?.audio_source, 'https://www.netflix.com/us/title/81040344');
  assert.ok(requests.filter((url) => url.pathname.startsWith('/3/discover/'))
    .every((url) => url.searchParams.get('with_original_language') === 'ko'));
});

test('adaptations are opt-in, category-specific and can include live-action anime movies', async (t) => {
  mockTmdb(t);
  const korean = await discoverGrid({ ...filters, genres: ['korean-drama'], includeAdaptations: true }, 1);
  assert.deepEqual(identities(korean.items), ['tv:1', 'tv:71712']);
  assert.equal(korean.items.find((item) => item.tmdb_id === 71712)?.english_version?.adaptation_of, 'Good Doctor (2013, Korea)');
  const anime = await discoverGrid({ ...filters, type: 'movie', genres: ['anime'], includeAdaptations: true }, 1);
  assert.deepEqual(identities(anime.items), ['movie:351460', 'movie:5']);
  assert.deepEqual(identities((await discoverGrid({ ...filters, type: 'movie', genres: ['anime'] }, 1)).items), ['movie:5']);
  const nextPage = await discoverGrid({ ...filters, genres: ['korean-drama'], includeAdaptations: true }, 2);
  assert.ok(nextPage.items.every((item) => item.tmdb_id !== 71712));
});

test('supplemental English versions respect year, rating, series status, networks and enabled services', async (t) => {
  mockTmdb(t);
  getDb().prepare('INSERT INTO my_services (provider_id, enabled) VALUES (9, 1)').run();
  getDb().prepare("INSERT INTO settings (key, value) VALUES ('broadcast_networks', '16')").run();
  const patches: Partial<BrowseFilters>[] = [
    { yearMin: 2020 }, { yearMax: 2010 }, { rating: 9 }, { status: 'returning' }, { watch: 'my' }, { watch: 'broadcast' },
  ];
  for (const patch of patches) {
    const result = await discoverGrid({ ...filters, genres: ['korean-drama'], includeAdaptations: true, ...patch }, 1);
    assert.ok(result.items.every((item) => item.tmdb_id !== 71712), JSON.stringify(patch));
  }
});

test('library preferences work offline and do not treat unrelated English dramas as adaptations', async () => {
  for (const [id, language] of [[1, 'ko'], [2, 'en'], [93405, 'ko'], [71712, 'en']] as const) {
    const titleId = getDb().prepare(`
      INSERT INTO titles (tmdb_id, media_type, name, original_language, genres, year)
      VALUES (?, 'tv', ?, ?, '["Drama"]', 2021)
    `).run(id, `Title ${id}`, language).lastInsertRowid;
    getDb().prepare("INSERT INTO user_state (title_id, status) VALUES (?, 'wishlist')").run(titleId);
  }
  config.tmdbKey = '';
  getDb().exec('DELETE FROM api_cache');
  const result = await libraryGrid({ ...filters, genres: ['korean-drama'], preferEnglish: true, includeAdaptations: true });
  assert.deepEqual(identities(result), ['tv:1', 'tv:71712', 'tv:93405']);
  assert.equal(result.at(-1)?.tmdb_id, 1);
  assert.deepEqual(identities(await libraryGrid({ ...filters, genres: ['korean-drama'] })), ['tv:1', 'tv:93405']);
});

test('Pick For Me prefers known English versions and retains unknown titles as a fallback', async (t) => {
  mockTmdb(t, false, true);
  const constraints = {
    time: 60, type: 'either' as const, genres: ['korean-drama'], my_services_only: false,
    include_rent_buy: false, exclude_library_titles: true, prefer_english: true, include_adaptations: true,
  };
  const first = await pickNext(constraints, []);
  assert.ok(knownEnglish(first.candidate?.english_version));
  assert.ok([93405, 99966, 71712].includes(first.candidate!.tmdb_id));
  const fallback = await pickNext(constraints, ['tv:93405', 'tv:99966', 'tv:71712']);
  assert.equal(fallback.candidate?.tmdb_id, 1);
  assert.equal(fallback.candidate?.english_version?.audio, 'unknown');
});

test('English preference never infers a dub from a translated title or from English subtitles', () => {
  assert.deepEqual(englishVersion('tv', 123456789, 'ko'), { audio: 'unknown' });
  assert.equal(englishVersion('tv', 123456789, 'en').audio, 'original');
  assert.equal(englishVersion('movie', 93405, 'ko').audio, 'unknown');
});

test('missing English-version details are reported without discarding ordinary results', async (t) => {
  const requests = mockTmdb(t);
  const upstream = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
    if (new URL(String(args[0])).pathname === '/3/tv/71712') return Response.json({}, { status: 404 });
    return upstream(...args);
  });
  const result = await discoverGrid({ ...filters, genres: ['korean-drama'], includeAdaptations: true }, 1);
  assert.deepEqual(identities(result.items), ['tv:1']);
  assert.match(result.notice ?? '', /incomplete/);
  assert.ok(requests.length > 0);
});

test('HTTP routes accept the new preferences and Pick preferences survive profile backup', async (t) => {
  mockTmdb(t);
  const app = Fastify();
  await app.register(browseRoutes);
  await app.register(pickRoutes);
  t.after(() => app.close());
  const browse = await app.inject('/api/browse/discover?genres=korean-drama&prefer_english=1&include_adaptations=1');
  assert.equal(browse.statusCode, 200);
  assert.ok(browse.json().items.some((item: { tmdb_id: number }) => item.tmdb_id === 71712));
  const constraints = { time: 60, type: 'tv', genres: ['korean-drama'], prefer_english: true, include_adaptations: true };
  const picked = await app.inject({ method: 'POST', url: '/api/pick/next', payload: { constraints } });
  assert.equal(picked.statusCode, 200);
  assert.ok(knownEnglish(picked.json().candidate?.english_version));
  getDb().prepare("INSERT INTO settings (key, value) VALUES ('pick_constraints', ?)").run(JSON.stringify(constraints));
  const backup = createBackup(getDb());
  getDb().exec("DELETE FROM settings WHERE key = 'pick_constraints'");
  restoreBackup(getDb(), backup, 'merge');
  const saved = getDb().prepare("SELECT value FROM settings WHERE key = 'pick_constraints'").get() as { value: string };
  assert.deepEqual(JSON.parse(saved.value), constraints);
});

// Arbitrary identities exercise discovery beyond every known dub/remake entry.
function mockPagedGenres(t: TestContext): URL[] {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(url.hostname, 'api.themoviedb.org', 'genre searches use the shared discovery source');
    if (url.pathname.endsWith('/watch/providers')) return Response.json({ results: {
      US: { flatrate: [
        { provider_id: 8, provider_name: 'Netflix', logo_path: null },
        { provider_id: 15, provider_name: 'Hulu', logo_path: null },
        { provider_id: 283, provider_name: 'Crunchyroll', logo_path: null },
      ] },
    } });
    assert.ok(url.pathname.startsWith('/3/discover/'));
    const language = url.searchParams.get('with_original_language');
    assert.ok(language === 'ko' || language === 'ja');
    assert.equal(url.searchParams.get('with_genres'), language === 'ko' ? '18' : '16');
    const movie = url.pathname.endsWith('/movie');
    if (language === 'ko') assert.equal(movie, false);
    const page = Number(url.searchParams.get('page') ?? 1);
    const offset = 1000000 + page * 1000 + (language === 'ja' ? 500 : 0) + (movie ? 10000 : 0);
    const results = Array.from({ length: 20 }, (_, i) => ({
      id: offset + i, title: 'Genre result ' + i, name: 'Genre result ' + i,
      original_language: language, genre_ids: [language === 'ko' ? 18 : 16],
      popularity: 100 - i, vote_average: 8,
    }));
    return Response.json({ results, page, total_pages: 12 });
  });
  return requests;
}

test('genre HTTP searches keep full pages across services, including unknown audio, beyond any supplemental list', async (t) => {
  const requests = mockPagedGenres(t);
  const app = Fastify();
  await app.register(browseRoutes);
  t.after(() => app.close());
  for (const [genre, perPage] of [['korean-drama', 20], ['anime', 40]] as const) {
    const seen = new Set<string>();
    for (const page of [1, 2]) {
      const response = await app.inject('/api/browse/discover?genres=' + genre + '&prefer_english=1&page=' + page);
      assert.equal(response.statusCode, 200);
      const result = response.json();
      assert.equal(result.items.length, perPage);
      assert.equal(result.total_pages, 12);
      assert.equal(result.page, page);
      for (const item of result.items) {
        const key = item.media_type + ':' + item.tmdb_id;
        assert.equal(seen.has(key), false, 'later pages contain additional titles');
        seen.add(key);
        assert.equal(item.english_version.audio, 'unknown');
        assert.deepEqual(item.offers.map((offer: { provider_id: number }) => offer.provider_id).sort((a: number, b: number) => a - b), [8, 15, 283]);
      }
    }
    assert.equal(seen.size, perPage * 2);
  }
  assert.ok(requests.filter((url) => url.pathname.startsWith('/3/discover/'))
    .every((url) => !url.searchParams.has('with_watch_providers')));
});

test('genre service restrictions use the selected services without adding Netflix, including with English preferred', async (t) => {
  const requests = mockPagedGenres(t);
  getDb().prepare('INSERT INTO my_services (provider_id, enabled) VALUES (15, 1), (283, 1), (8, 0)').run();
  const result = await discoverGrid({ ...filters, genres: ['korean-drama', 'anime'], watch: 'my', preferEnglish: true }, 1);
  assert.equal(result.items.length, 60);
  assert.ok(result.items.every((item) => item.offers?.length === 2 && item.offers.every((offer) => [15, 283].includes(offer.provider_id))));
  const queries = requests.filter((url) => url.pathname.startsWith('/3/discover/'));
  assert.equal(queries.length, 3);
  for (const query of queries) assert.deepEqual(query.searchParams.get('with_watch_providers')?.split('|').sort(), ['15', '283']);
});

test('Pick genre searches honor only the enabled services when requested', async (t) => {
  const requests = mockTmdb(t, true);
  getDb().prepare('INSERT INTO my_services (provider_id, enabled) VALUES (15, 1), (283, 1), (8, 0)').run();
  await pickNext({
    time: 60, type: 'either', genres: ['korean-drama', 'anime'], my_services_only: true,
    include_rent_buy: false, exclude_library_titles: true, prefer_english: true,
  }, []);
  const queries = requests.filter((url) => url.pathname.startsWith('/3/discover/'));
  assert.equal(queries.length, 8);
  for (const query of queries) assert.deepEqual(query.searchParams.get('with_watch_providers')?.split('|').sort(), ['15', '283']);
});
