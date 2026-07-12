import { createHash } from 'node:crypto';
import type { DB } from '../db.js';

type Row = Record<string, unknown>;

interface ProfileSeason {
  record: Row;
  episodes: Row[];
}

interface ProfileTitle {
  record: Row;
  state: Row | null;
  seasons: ProfileSeason[];
  cast: Row[];
  availability: Row[];
  events: Row[];
}

interface ProfileSuggestion {
  record: Row;
  title_identity?: { tmdb_id: number; media_type: 'movie' | 'tv' };
  episode_identity?: { tmdb_id: number; media_type: 'movie' | 'tv'; season_number: number; episode_number: number };
}

export interface BackupProfile {
  titles: ProfileTitle[];
  my_services: Row[];
  settings: Row[];
  suggestion_log: ProfileSuggestion[];
  suggestion_suppressions: Row[];
  release_dates: Row[];
  unlinked_events: Row[];
}

export interface BackupCounts {
  titles: number;
  movies: number;
  shows: number;
  watched_titles: number;
  watched_episodes: number;
  saved_for_later: number;
  watchlist: number;
  watching: number;
  never_suggest: number;
}

export interface BackupDocument {
  app: 'watch-it';
  format: 'profile-backup';
  version: 2;
  app_version: string;
  exported_at: string;
  counts: BackupCounts;
  checksum: { algorithm: 'sha256'; value: string };
  profile: BackupProfile;
}

export interface BackupPreview extends BackupCounts {
  exported_at: string;
  version: number;
  checksum_verified: boolean;
  legacy: boolean;
}

const APP_VERSION = '1.0.0';
const PROFILE_ARRAYS = [
  'titles',
  'my_services',
  'settings',
  'suggestion_log',
  'suggestion_suppressions',
  'release_dates',
  'unlinked_events',
] as const;

function rows(db: DB, sql: string, ...params: unknown[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

function without(row: Row, ...keys: string[]): Row {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.has(key)));
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function mediaType(value: unknown): 'movie' | 'tv' | null {
  return value === 'movie' || value === 'tv' ? value : null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function checksum(profile: BackupProfile): string {
  return createHash('sha256').update(stableStringify(profile)).digest('hex');
}

function calculateCounts(profile: BackupProfile): BackupCounts {
  let movies = 0;
  let shows = 0;
  let watchedTitles = 0;
  let watchedEpisodes = 0;
  let savedForLater = 0;
  let watchlist = 0;
  let watching = 0;
  const neverSuggestIdentities = new Set(
    profile.suggestion_suppressions.map((item) => `${String(item.media_type)}:${String(item.tmdb_id)}`),
  );

  for (const title of profile.titles) {
    if (title.record.media_type === 'movie') movies += 1;
    if (title.record.media_type === 'tv') shows += 1;
    if (title.state?.status === 'watched') watchedTitles += 1;
    if (title.state?.status === 'saved') savedForLater += 1;
    if (title.state?.status === 'wishlist') watchlist += 1;
    if (title.state?.status === 'watching') watching += 1;
    if (title.state?.never_suggest === 1) {
      neverSuggestIdentities.add(`${String(title.record.media_type)}:${String(title.record.tmdb_id)}`);
    }
    for (const season of title.seasons) {
      watchedEpisodes += season.episodes.filter((episode) => Boolean(episode.watched_at)).length;
    }
  }

  return {
    titles: profile.titles.length,
    movies,
    shows,
    watched_titles: watchedTitles,
    watched_episodes: watchedEpisodes,
    saved_for_later: savedForLater,
    watchlist,
    watching,
    never_suggest: neverSuggestIdentities.size,
  };
}

export function buildBackupProfile(db: DB): BackupProfile {
  const titleRows = rows(db, 'SELECT * FROM titles ORDER BY id');
  const titleById = new Map<number, Row>();
  for (const title of titleRows) {
    const id = integer(title.id);
    if (id !== null) titleById.set(id, title);
  }

  const seasonRows = rows(db, 'SELECT * FROM seasons ORDER BY title_id, season_number');
  const seasonById = new Map<number, Row>();
  for (const season of seasonRows) {
    const id = integer(season.id);
    if (id !== null) seasonById.set(id, season);
  }

  const episodes = rows(db, 'SELECT * FROM episodes ORDER BY season_id, episode_number');
  const states = new Map(rows(db, 'SELECT * FROM user_state').map((row) => [integer(row.title_id), row]));
  const cast = rows(db, 'SELECT * FROM cast_members ORDER BY title_id, ord');
  const availability = rows(db, 'SELECT * FROM availability ORDER BY title_id, provider_id, offer_type');
  const events = rows(db, 'SELECT * FROM events ORDER BY created_at, id');

  const titles: ProfileTitle[] = titleRows.map((title) => {
    const titleId = integer(title.id);
    const titleSeasons = seasonRows.filter((season) => integer(season.title_id) === titleId).map((season) => {
      const seasonId = integer(season.id);
      return {
        record: without(season, 'id', 'title_id'),
        episodes: episodes
          .filter((episode) => integer(episode.season_id) === seasonId)
          .map((episode) => without(episode, 'id', 'season_id')),
      };
    });
    return {
      record: without(title, 'id'),
      state: states.get(titleId) ? without(states.get(titleId) as Row, 'title_id') : null,
      seasons: titleSeasons,
      cast: cast.filter((row) => integer(row.title_id) === titleId).map((row) => without(row, 'id', 'title_id')),
      availability: availability.filter((row) => integer(row.title_id) === titleId).map((row) => without(row, 'id', 'title_id')),
      events: events.filter((row) => integer(row.title_id) === titleId).map((row) => without(row, 'id', 'title_id')),
    };
  });

  const suggestionLog = rows(db, `
    SELECT sl.*, t.tmdb_id AS library_tmdb_id, t.media_type AS library_media_type,
           st.season_number, ep.episode_number
    FROM suggestion_log sl
    LEFT JOIN titles t ON t.id = sl.title_id
    LEFT JOIN episodes ep ON ep.id = sl.episode_id
    LEFT JOIN seasons st ON st.id = ep.season_id
    ORDER BY sl.id
  `).map((row): ProfileSuggestion => {
    const libraryTmdbId = integer(row.library_tmdb_id);
    const libraryMediaType = mediaType(row.library_media_type);
    const seasonNumber = integer(row.season_number);
    const episodeNumber = integer(row.episode_number);
    const record = without(
      row,
      'id', 'title_id', 'episode_id', 'library_tmdb_id', 'library_media_type', 'season_number', 'episode_number',
    );
    const suggestion: ProfileSuggestion = { record };
    if (libraryTmdbId !== null && libraryMediaType) {
      suggestion.title_identity = { tmdb_id: libraryTmdbId, media_type: libraryMediaType };
      if (seasonNumber !== null && episodeNumber !== null) {
        suggestion.episode_identity = {
          tmdb_id: libraryTmdbId,
          media_type: libraryMediaType,
          season_number: seasonNumber,
          episode_number: episodeNumber,
        };
      }
    }
    return suggestion;
  });

  return {
    titles,
    my_services: rows(db, 'SELECT * FROM my_services ORDER BY provider_id'),
    settings: rows(db, `SELECT * FROM settings WHERE key NOT IN ('omdb_used_date', 'omdb_used_count') ORDER BY key`),
    suggestion_log: suggestionLog,
    suggestion_suppressions: rows(db, 'SELECT * FROM suggestion_suppressions ORDER BY media_type, tmdb_id'),
    release_dates: rows(db, 'SELECT * FROM release_dates ORDER BY tmdb_id, region, type'),
    unlinked_events: events.filter((row) => row.title_id === null).map((row) => without(row, 'id', 'title_id')),
  };
}

export function createBackup(db: DB): BackupDocument {
  const profile = buildBackupProfile(db);
  return {
    app: 'watch-it',
    format: 'profile-backup',
    version: 2,
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    counts: calculateCounts(profile),
    checksum: { algorithm: 'sha256', value: checksum(profile) },
    profile,
  };
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === 'object' && !Array.isArray(row)) : [];
}

function legacyToProfile(body: Row): BackupProfile {
  const titleRows = asRows(body.titles);
  const stateRows = asRows(body.user_state);
  const seasonRows = asRows(body.seasons);
  const episodeRows = asRows(body.episodes);
  const castRows = asRows(body.cast_members);
  const availabilityRows = asRows(body.availability);
  const eventRows = asRows(body.events);
  const titleById = new Map(titleRows.map((row) => [integer(row.id), row]));
  const seasonById = new Map(seasonRows.map((row) => [integer(row.id), row]));

  const titles = titleRows.map((title): ProfileTitle => {
    const titleId = integer(title.id);
    return {
      record: without(title, 'id'),
      state: stateRows.find((row) => integer(row.title_id) === titleId)
        ? without(stateRows.find((row) => integer(row.title_id) === titleId) as Row, 'title_id')
        : null,
      seasons: seasonRows.filter((row) => integer(row.title_id) === titleId).map((season) => ({
        record: without(season, 'id', 'title_id'),
        episodes: episodeRows
          .filter((episode) => integer(episode.season_id) === integer(season.id))
          .map((episode) => without(episode, 'id', 'season_id')),
      })),
      cast: castRows.filter((row) => integer(row.title_id) === titleId).map((row) => without(row, 'id', 'title_id')),
      availability: availabilityRows.filter((row) => integer(row.title_id) === titleId).map((row) => without(row, 'id', 'title_id')),
      events: eventRows.filter((row) => integer(row.title_id) === titleId).map((row) => without(row, 'id', 'title_id')),
    };
  });

  const suggestionLog = asRows(body.suggestion_log).map((row): ProfileSuggestion => {
    const title = titleById.get(integer(row.title_id));
    const episode = episodeRows.find((item) => integer(item.id) === integer(row.episode_id));
    const season = episode ? seasonById.get(integer(episode.season_id)) : undefined;
    const tmdbId = title ? integer(title.tmdb_id) : null;
    const type = title ? mediaType(title.media_type) : null;
    const suggestion: ProfileSuggestion = { record: without(row, 'id', 'title_id', 'episode_id') };
    if (tmdbId !== null && type) {
      suggestion.title_identity = { tmdb_id: tmdbId, media_type: type };
      const seasonNumber = season ? integer(season.season_number) : null;
      const episodeNumber = episode ? integer(episode.episode_number) : null;
      if (seasonNumber !== null && episodeNumber !== null) {
        suggestion.episode_identity = { tmdb_id: tmdbId, media_type: type, season_number: seasonNumber, episode_number: episodeNumber };
      }
    }
    return suggestion;
  });

  return {
    titles,
    my_services: asRows(body.my_services).map((row) => without(row)),
    settings: asRows(body.settings).filter((row) => row.key !== 'omdb_used_date' && row.key !== 'omdb_used_count').map((row) => without(row)),
    suggestion_log: suggestionLog,
    suggestion_suppressions: asRows(body.suggestion_suppressions).map((row) => without(row)),
    release_dates: asRows(body.release_dates).map((row) => without(row)),
    unlinked_events: eventRows.filter((row) => row.title_id === null).map((row) => without(row, 'id', 'title_id')),
  };
}

function validateProfile(profile: unknown): asserts profile is BackupProfile {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('backup profile is missing');
  const candidate = profile as unknown as Row;
  for (const key of PROFILE_ARRAYS) {
    if (!Array.isArray(candidate[key])) throw new Error(`backup section ${key} is missing`);
  }
  for (const item of candidate.titles as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('backup contains an invalid title');
    const title = item as unknown as ProfileTitle;
    if (integer(title.record?.tmdb_id) === null || !mediaType(title.record?.media_type) || typeof title.record?.name !== 'string') {
      throw new Error('backup contains a title without a valid identity');
    }
    if (!Array.isArray(title.seasons) || !Array.isArray(title.cast) || !Array.isArray(title.availability) || !Array.isArray(title.events)) {
      throw new Error(`backup data for ${String(title.record.name)} is incomplete`);
    }
    for (const season of title.seasons) {
      if (!season?.record || integer(season.record.season_number) === null || !Array.isArray(season.episodes)) {
        throw new Error(`backup contains an invalid season for ${String(title.record.name)}`);
      }
    }
  }
}

export function inspectBackup(input: unknown): { document: BackupDocument; preview: BackupPreview } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('not a Watch It backup file');
  const body = input as Row;
  if (body.app !== 'watch-it') throw new Error('not a Watch It backup file');

  let document: BackupDocument;
  let legacy = false;
  let checksumVerified = false;
  if (body.format === 'profile-backup' && body.version === 2) {
    validateProfile(body.profile);
    const expected = (body.checksum as Row | undefined)?.value;
    const actual = checksum(body.profile);
    if (typeof expected !== 'string' || expected !== actual) throw new Error('backup checksum does not match; the file may be damaged');
    checksumVerified = true;
    document = body as unknown as BackupDocument;
  } else if (body.version === 1 && Array.isArray(body.titles)) {
    legacy = true;
    const profile = legacyToProfile(body);
    validateProfile(profile);
    document = {
      app: 'watch-it',
      format: 'profile-backup',
      version: 2,
      app_version: 'legacy',
      exported_at: typeof body.exported_at === 'string' ? body.exported_at : new Date(0).toISOString(),
      counts: calculateCounts(profile),
      checksum: { algorithm: 'sha256', value: checksum(profile) },
      profile,
    };
  } else {
    throw new Error('this backup version is not supported');
  }

  const counts = calculateCounts(document.profile);
  return {
    document: { ...document, counts },
    preview: {
      ...counts,
      exported_at: document.exported_at,
      version: legacy ? 1 : document.version,
      checksum_verified: checksumVerified,
      legacy,
    },
  };
}

function tableColumns(db: DB, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name));
}

function compatibleRow(db: DB, table: string, row: Row): Row {
  const columns = tableColumns(db, table);
  return Object.fromEntries(Object.entries(row).filter(([key, value]) => columns.has(key) && value !== undefined));
}

function upsert(db: DB, table: string, source: Row, keys: string[]): void {
  const row = compatibleRow(db, table, source);
  const columns = Object.keys(row);
  if (columns.length === 0 || keys.some((key) => !(key in row))) throw new Error(`backup is missing required ${table} fields`);
  const updates = columns.filter((column) => !keys.includes(column));
  const conflict = updates.length
    ? `DO UPDATE SET ${updates.map((column) => `${column} = excluded.${column}`).join(', ')}`
    : 'DO NOTHING';
  db.prepare(`
    INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
    ON CONFLICT (${keys.join(', ')}) ${conflict}
  `).run(...columns.map((column) => row[column]));
}

function insert(db: DB, table: string, source: Row): number {
  const row = compatibleRow(db, table, source);
  const columns = Object.keys(row);
  if (columns.length === 0) throw new Error(`backup contains an empty ${table} row`);
  const result = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map((column) => row[column]));
  return Number(result.lastInsertRowid);
}

function findTitleId(db: DB, tmdbId: number, type: 'movie' | 'tv'): number | null {
  const row = db.prepare('SELECT id FROM titles WHERE tmdb_id = ? AND media_type = ?').get(tmdbId, type) as { id: number } | undefined;
  return row?.id ?? null;
}

function restoreState(db: DB, titleId: number, state: Row, mode: 'merge' | 'replace'): void {
  const incoming = compatibleRow(db, 'user_state', { ...state, title_id: titleId });
  const current = db.prepare('SELECT * FROM user_state WHERE title_id = ?').get(titleId) as Row | undefined;
  if (!current || mode === 'replace') {
    upsert(db, 'user_state', incoming, ['title_id']);
    return;
  }
  const currentDate = typeof current.updated_at === 'string' ? current.updated_at : '';
  const incomingDate = typeof incoming.updated_at === 'string' ? incoming.updated_at : '';
  const neverSuggest = current.never_suggest === 1 || incoming.never_suggest === 1 ? 1 : 0;
  const watchedAt = current.watched_at || incoming.watched_at || null;
  if (incomingDate >= currentDate) {
    upsert(db, 'user_state', { ...incoming, watched_at: watchedAt, never_suggest: neverSuggest }, ['title_id']);
  } else if (neverSuggest !== current.never_suggest || watchedAt !== current.watched_at) {
    db.prepare('UPDATE user_state SET never_suggest = ?, watched_at = ? WHERE title_id = ?').run(neverSuggest, watchedAt, titleId);
  }
}

export function restoreBackup(db: DB, input: unknown, mode: 'merge' | 'replace'): BackupPreview {
  const { document, preview } = inspectBackup(input);
  const profile = document.profile;
  const run = db.transaction(() => {
    if (mode === 'replace') {
      for (const table of [
        'suggestion_suppressions', 'suggestion_log', 'release_dates', 'events', 'settings', 'my_services',
        'availability', 'cast_members', 'episodes', 'seasons', 'user_state', 'titles',
      ]) db.prepare(`DELETE FROM ${table}`).run();
    }

    for (const item of profile.titles) {
      const tmdbId = integer(item.record.tmdb_id) as number;
      const type = mediaType(item.record.media_type) as 'movie' | 'tv';
      upsert(db, 'titles', item.record, ['tmdb_id', 'media_type']);
      const titleId = findTitleId(db, tmdbId, type);
      if (titleId === null) throw new Error(`could not restore ${String(item.record.name)}`);
      if (item.state) restoreState(db, titleId, item.state, mode);

      for (const season of item.seasons) {
        upsert(db, 'seasons', { ...season.record, title_id: titleId }, ['title_id', 'season_number']);
        const seasonId = (db.prepare('SELECT id FROM seasons WHERE title_id = ? AND season_number = ?')
          .get(titleId, season.record.season_number) as { id: number }).id;
        for (const episode of season.episodes) {
          const current = mode === 'merge'
            ? db.prepare('SELECT watched_at FROM episodes WHERE season_id = ? AND episode_number = ?')
              .get(seasonId, episode.episode_number) as { watched_at: unknown } | undefined
            : undefined;
          const watchedAt = current?.watched_at || episode.watched_at || null;
          upsert(db, 'episodes', { ...episode, watched_at: watchedAt, season_id: seasonId }, ['season_id', 'episode_number']);
        }
      }

      for (const member of item.cast) upsert(db, 'cast_members', { ...member, title_id: titleId }, ['title_id', 'tmdb_person_id', 'character']);
      for (const offer of item.availability) upsert(db, 'availability', { ...offer, title_id: titleId }, ['title_id', 'provider_id', 'offer_type', 'region']);
      for (const event of item.events) {
        const existing = mode === 'merge' && db.prepare(`
          SELECT 1 FROM events WHERE title_id = ? AND type = ? AND payload = ? AND created_at = ?
        `).get(titleId, event.type, event.payload, event.created_at);
        if (!existing) insert(db, 'events', { ...event, title_id: titleId });
      }
    }

    for (const service of profile.my_services) upsert(db, 'my_services', service, ['provider_id']);
    for (const setting of profile.settings) upsert(db, 'settings', setting, ['key']);
    for (const date of profile.release_dates) upsert(db, 'release_dates', date, ['tmdb_id', 'region', 'type']);
    for (const suppression of profile.suggestion_suppressions) upsert(db, 'suggestion_suppressions', suppression, ['media_type', 'tmdb_id']);

    for (const suggestion of profile.suggestion_log) {
      const record = { ...suggestion.record };
      const identity = suggestion.title_identity;
      const episodeIdentity = suggestion.episode_identity;
      const titleId = identity ? findTitleId(db, identity.tmdb_id, identity.media_type) : null;
      let episodeId: number | null = null;
      if (episodeIdentity && titleId !== null) {
        const episode = db.prepare(`
          SELECT ep.id FROM episodes ep JOIN seasons s ON s.id = ep.season_id
          WHERE s.title_id = ? AND s.season_number = ? AND ep.episode_number = ?
        `).get(titleId, episodeIdentity.season_number, episodeIdentity.episode_number) as { id: number } | undefined;
        episodeId = episode?.id ?? null;
      }
      const exists = mode === 'merge' && db.prepare(`
        SELECT 1 FROM suggestion_log
        WHERE tmdb_id = ? AND media_type = ? AND action = ? AND constraints = ? AND created_at = ?
      `).get(record.tmdb_id, record.media_type, record.action, record.constraints, record.created_at);
      if (!exists) insert(db, 'suggestion_log', { ...record, title_id: titleId, episode_id: episodeId });
    }

    for (const event of profile.unlinked_events) {
      const existing = mode === 'merge' && db.prepare(`
        SELECT 1 FROM events WHERE title_id IS NULL AND type = ? AND payload = ? AND created_at = ?
      `).get(event.type, event.payload, event.created_at);
      if (!existing) insert(db, 'events', { ...event, title_id: null });
    }

    const foreignKeyProblems = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyProblems.length) throw new Error('restored data did not pass the database relationship check');
  });
  run();
  return preview;
}
