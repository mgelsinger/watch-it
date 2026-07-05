export type MediaType = 'movie' | 'tv';
export type UserStatus = 'wishlist' | 'watching' | 'watched' | 'dropped' | 'paused';

export interface Cadence {
  type: 'weekly' | 'binge' | 'split' | 'irregular';
  detail: string;
}

export interface Card {
  id: number;
  tmdb_id: number;
  media_type: MediaType;
  imdb_id: string | null;
  name: string;
  year: number | null;
  poster_path: string | null;
  tmdb_rating: number | null;
  imdb_rating: number | null;
  rt_score: number | null;
  metacritic: number | null;
  status_upstream: string | null;
  release_cadence: string | null;
  user_status?: UserStatus;
  my_offers?: { provider_name: string; logo_path: string | null }[];
  // row-specific extras
  next_episode_id?: number;
  next_episode_name?: string | null;
  next_season?: number;
  next_episode?: number;
  next_air_date?: string | null;
  tonight_season?: number;
  tonight_episode?: number;
  watched_at?: string | null;
}

export interface TheaterCard {
  tmdb_id: number;
  media_type: 'movie';
  name: string;
  poster_path: string | null;
  release_date: string | null;
  tmdb_rating: number | null;
  overview: string | null;
  library_id: number | null;
}

export interface Episode {
  id: number;
  season_id: number;
  episode_number: number;
  name: string | null;
  air_date: string | null;
  runtime: number | null;
  overview: string | null;
  watched_at: string | null;
}

export interface Season {
  id: number;
  title_id: number;
  season_number: number;
  name: string | null;
  episode_count: number | null;
  air_date: string | null;
  poster_path: string | null;
  episodes: Episode[];
}

export interface CastMember {
  id: number;
  title_id: number;
  tmdb_person_id: number;
  imdb_person_id: string | null;
  name: string;
  character: string | null;
  ord: number;
  profile_path: string | null;
}

export interface Availability {
  id: number;
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  offer_type: 'flatrate' | 'rent' | 'buy' | 'free' | 'ads';
  region: string;
  first_seen: string;
  last_seen: string;
  active: number;
}

export interface EventRow {
  id: number;
  title_id: number | null;
  type: string;
  payload: string;
  created_at: string;
  seen: number;
  title_name?: string | null;
  poster_path?: string | null;
  media_type?: MediaType;
}

export interface NextEpisode {
  id: number;
  name: string | null;
  episode_number: number;
  season_number: number;
  air_date: string | null;
}

export interface TitleDetail extends Card {
  overview: string | null;
  backdrop_path: string | null;
  genres: string;
  runtime: number | null;
  added_at: string;
  ratings_refreshed_at: string | null;
  metadata_refreshed_at: string | null;
  user_rating: number | null;
  notes: string | null;
  user_watched_at: string | null;
  seasons: Season[];
  cast: CastMember[];
  availability: Availability[];
  events: EventRow[];
  my_service_ids: number[];
  next_unwatched: NextEpisode | null;
  next_airing: NextEpisode | null;
  region: string;
}

export interface SearchResult {
  tmdb_id: number;
  media_type: MediaType;
  name: string;
  year: number | null;
  poster_path: string | null;
  tmdb_rating: number | null;
  overview: string | null;
  library_id: number | null;
}

export interface HomeData {
  continue_watching: Card[];
  new_tonight: Card[];
  returning_soon: Card[];
  wishlist_available: Card[];
  now_streaming: Card[];
  in_theaters: TheaterCard[];
  coming_soon: TheaterCard[];
  recently_watched: Card[];
}

export interface ScheduleItem {
  airtime: string;
  airdate: string;
  episode_name: string | null;
  season: number | string | null;
  number: number | null;
  runtime: number | null;
  show_name: string;
  show_type: string | null;
  network: string;
  imdb_id: string | null;
  image: string | null;
  library_id: number | null;
}

export interface Provider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  enabled: boolean;
}

export interface SyncState {
  running: boolean;
  scope: string | null;
  done: number;
  total: number;
  startedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

export interface SyncLogRow {
  id: number;
  source: string;
  scope: string;
  started_at: string;
  finished_at: string | null;
  ok: number | null;
  error: string | null;
}
