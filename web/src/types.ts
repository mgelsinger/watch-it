export type MediaType = 'movie' | 'tv';
export type UserStatus = 'saved' | 'wishlist' | 'watching' | 'watched' | 'dropped' | 'paused';

export interface WatchOffer {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  offer_type: 'flatrate' | 'rent' | 'buy' | 'free' | 'ads';
}

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
  my_offers?: WatchOffer[];
  availability_check?: AvailabilityCheck;
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

export interface DiscoveryCard {
  tmdb_id: number;
  media_type: MediaType;
  name: string;
  poster_path: string | null;
  date: string | null; // release date (movie) or premiere date (tv/new season)
  tmdb_rating: number | null;
  overview: string | null;
  library_id: number | null;
  new_season?: boolean;
  digital_date?: string | null;
  physical_date?: string | null;
  offers?: WatchOffer[];
  availability_check?: AvailabilityCheck;
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
  /** 1 = row from the title's first provider snapshot: first_seen is when
   *  tracking started, NOT when the title arrived on the service. */
  initial_sync: number;
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
  english_version?: EnglishVersion;
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
  /** 1 = excluded from Pick For Me suggestions. */
  never_suggest: number | null;
  seasons: Season[];
  cast: CastMember[];
  availability: Availability[];
  availability_check?: AvailabilityCheck;
  watch_url?: string | null;
  events: EventRow[];
  my_service_ids: number[];
  next_unwatched: NextEpisode | null;
  next_airing: NextEpisode | null;
  region: string;
  /** Regional release dates (movies): type 4 = Digital, 5 = Physical. */
  release_dates: { type: number; date: string }[];
  /** Earliest real-season air date (tv). */
  premiere_date: string | null;
}

export interface BrowseCard {
  english_version?: EnglishVersion;
  tmdb_id: number;
  media_type: MediaType;
  name: string;
  year: number | null;
  date: string | null;
  poster_path: string | null;
  tmdb_rating: number | null;
  popularity: number | null;
  overview: string | null;
  library_id: number | null;
  user_status: UserStatus | null;
  offers?: WatchOffer[];
  availability_check?: AvailabilityCheck;
}

export interface BrowseGenre {
  key: string;
  name: string;
  description?: string;
  movie_ids: number[];
  tv_ids: number[];
  names: string[];
}

export interface BrowseGridPage {
  notice?: string;
  items: BrowseCard[];
  page: number;
  total_pages: number;
  stale: boolean;
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
  saved_for_later: Card[];
  now_streaming: Card[];
  new_on_services: DiscoveryCard[];
  new_disc_digital: DiscoveryCard[];
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

// ---- Pick For Me ----

export interface PickConstraints {
  excluded_provider_ids?: number[];
  prefer_english?: boolean;
  include_adaptations?: boolean;
  /** Minutes; null or >= 120 ("2h+" / "No limit") disables the budget filter. */
  time: number | null;
  type: 'tv' | 'movie' | 'either';
  genres: string[]; // merged genre keys (mood chips)
  my_services_only: boolean;
  include_rent_buy: boolean;
  exclude_library_titles: boolean;
}

export interface PickCandidate {
  english_version?: EnglishVersion;
  key: string;
  tmdb_id: number;
  library_id: number | null;
  media_type: MediaType;
  name: string;
  year: number | null;
  poster_path: string | null;
  source: 'new_release' | 'airing_now' | 'popular';
  runtime: number;
  runtime_estimated: boolean;
  providers: WatchOffer[];
  availability_check?: AvailabilityCheck;
  watch_url?: string | null;
  rent_buy_only: boolean;
  reasons: string[];
}

export interface PickLoosen {
  label: string;
  patch: Partial<PickConstraints>;
}

export interface PickResult {
  notice?: string;
  candidate: PickCandidate | null;
  pool_size: number;
  exhausted?: boolean;
  empty?: { message: string; loosen: PickLoosen[] };
}

export interface PickSessionState {
  constraints: PickConstraints;
  result: PickResult | null;
  shown: string[];
}

export interface EnglishVersion {
  audio: 'original' | 'dub' | 'unknown';
  audio_source?: string;
  adaptation_of?: string;
  adaptation_source?: string;
  checked_at?: string;
  audio_provider?: string;
  audio_region?: string;
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

export interface AvailabilityCheck {
  status: 'fresh' | 'stale' | 'unavailable';
  region: string;
  checked_at: string | null;
}
