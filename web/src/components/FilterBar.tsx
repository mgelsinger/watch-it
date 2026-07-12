import type { BrowseGenre } from '../types';

export interface BrowseState {
  scope: 'discover' | 'library';
  type: 'movie' | 'tv' | 'both';
  genres: string[];
  watch: 'any' | 'my' | 'streaming' | 'broadcast';
  status: '' | 'returning' | 'ended' | 'canceled';
  lib: '' | 'not_added' | 'saved' | 'wishlist' | 'watching' | 'watched' | 'dropped';
  ymin: string;
  ymax: string;
  rating: '' | '6' | '7' | '8';
  bingeable: boolean;
  sort: '' | 'newest' | 'rating' | 'popular' | 'az' | 'added' | 'watched';
}

export const DEFAULT_STATE: BrowseState = {
  scope: 'discover', type: 'both', genres: [], watch: 'any', status: '', lib: '',
  ymin: '', ymax: '', rating: '', bingeable: false, sort: '',
};

export function anyFilterActive(s: BrowseState): boolean {
  return s.type !== 'both' || s.genres.length > 0 || s.watch !== 'any' || s.status !== '' ||
    s.lib !== '' || s.ymin !== '' || s.ymax !== '' || s.rating !== '' || s.bingeable || s.sort !== '';
}

/**
 * Shared filter/sort bar for Browse (and, later, the Home "See all" grids).
 * Scope-dependent options: Broadcast TV and "Not added" only make sense in
 * Discover; Bingeable and the added/watched sorts only in Library.
 */
export default function FilterBar({ state, genres, onChange }: {
  state: BrowseState;
  genres: BrowseGenre[];
  onChange: (patch: Partial<BrowseState>) => void;
}) {
  const s = state;
  const isLib = s.scope === 'library';
  const toggleGenre = (key: string) =>
    onChange({ genres: s.genres.includes(key) ? s.genres.filter((g) => g !== key) : [...s.genres, key] });

  return (
    <div className="filterbar">
      <div className="scope-toggle" role="group" aria-label="Browse scope">
        <button className={isLib ? '' : 'on'} onClick={() => onChange({ scope: 'discover' })}>Discover</button>
        <button className={isLib ? 'on' : ''} onClick={() => onChange({ scope: 'library' })}>My Library</button>
      </div>

      <select value={s.type} onChange={(e) => onChange({ type: e.target.value as BrowseState['type'] })} aria-label="Type">
        <option value="both">Movies & TV</option>
        <option value="movie">Movies</option>
        <option value="tv">TV</option>
      </select>

      <details className="genre-dd">
        <summary>Genres{s.genres.length > 0 ? ` (${s.genres.length})` : ''}</summary>
        <div className="genre-panel">
          {genres.map((g) => (
            <button key={g.key} className={`chip ${s.genres.includes(g.key) ? 'on' : ''}`} onClick={() => toggleGenre(g.key)}>
              {g.name}
            </button>
          ))}
          {genres.length === 0 && <span className="muted">genre list unavailable</span>}
        </div>
      </details>

      <select value={s.watch} onChange={(e) => onChange({ watch: e.target.value as BrowseState['watch'] })} aria-label="Where to watch">
        <option value="any">Anywhere</option>
        <option value="my">On My Services</option>
        <option value="streaming">Any Streaming</option>
        {!isLib && <option value="broadcast">Broadcast TV</option>}
      </select>

      <select value={s.status} onChange={(e) => onChange({ status: e.target.value as BrowseState['status'] })} aria-label="Series status">
        <option value="">Any status</option>
        <option value="returning">Airing / Returning</option>
        <option value="ended">Completed</option>
        <option value="canceled">Canceled</option>
      </select>

      {/* Bingeable needs per-episode air dates — only computable for tracked shows. */}
      {isLib && (
        <label className="pill" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={s.bingeable} onChange={(e) => onChange({ bingeable: e.target.checked })} /> Bingeable season
        </label>
      )}

      <select value={s.lib} onChange={(e) => onChange({ lib: e.target.value as BrowseState['lib'] })} aria-label="Library status">
        <option value="">Any library status</option>
        {!isLib && <option value="not_added">Not added</option>}
        <option value="saved">Saved for Later</option>
        <option value="wishlist">Watchlist</option>
        <option value="watching">Watching</option>
        <option value="watched">Watched</option>
        <option value="dropped">Dropped</option>
      </select>

      <span className="faint">Year</span>
      <input type="number" placeholder="from" min={1900} max={2100} value={s.ymin}
        onChange={(e) => onChange({ ymin: e.target.value })} aria-label="Year from" />
      <input type="number" placeholder="to" min={1900} max={2100} value={s.ymax}
        onChange={(e) => onChange({ ymax: e.target.value })} aria-label="Year to" />

      <select value={s.rating} onChange={(e) => onChange({ rating: e.target.value as BrowseState['rating'] })} aria-label="Minimum rating">
        <option value="">Any rating</option>
        <option value="6">6+</option>
        <option value="7">7+</option>
        <option value="8">8+</option>
      </select>

      <select value={s.sort} onChange={(e) => onChange({ sort: e.target.value as BrowseState['sort'] })} aria-label="Sort">
        <option value="">Sort{isLib ? ': Recently Added' : anyFilterActive(s) ? ': Newest' : ': default'}</option>
        <option value="newest">Newest</option>
        <option value="rating">Highest Rated</option>
        <option value="popular">Most Popular</option>
        <option value="az">A–Z</option>
        {isLib && <option value="added">Recently Added</option>}
        {isLib && <option value="watched">Recently Watched</option>}
      </select>

      {anyFilterActive(s) && (
        <button onClick={() => onChange({ ...DEFAULT_STATE, scope: s.scope })}>✕ Clear</button>
      )}
    </div>
  );
}
