import { useState } from 'react';
import { useApi } from '../api';
import type { Card } from '../types';
import PosterCard from '../components/PosterCard';

const STATUSES = ['all', 'watching', 'wishlist', 'saved', 'watched', 'paused', 'dropped'] as const;
const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  all: 'All',
  watching: 'Watching',
  wishlist: 'Watchlist',
  saved: 'Saved for Later',
  watched: 'Watched',
  paused: 'Paused',
  dropped: 'Dropped',
};

export default function Library() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const { data, loading, error } = useApi<{ titles: Card[] }>(
    `/api/titles${status === 'all' ? '' : `?status=${status}`}`,
  );

  return (
    <>
      <h1>Library</h1>
      <div className="toolbar" role="tablist" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button key={s} className={`pill ${s === status ? 'on' : ''}`} onClick={() => setStatus(s)} role="tab" aria-selected={s === status}>
            {STATUS_LABELS[s]}
          </button>
        ))}
        {data && <span className="faint">{data.titles.length} titles</span>}
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="muted">{error}</p>}
      {data && data.titles.length === 0 && (
        <div className="empty">
          <h3>Nothing here yet</h3>
          <p>Use the search box above to add shows and movies.</p>
        </div>
      )}
      <div className="grid">
        {data?.titles.map((c) => (
          <PosterCard
            key={c.id}
            linkId={c.id}
            name={c.name}
            year={c.year}
            posterPath={c.poster_path}
            sub={`${c.media_type === 'tv' ? 'TV' : 'Movie'} · ${
              c.user_status === 'wishlist' ? 'Watchlist' : c.user_status === 'saved' ? 'Saved for Later' : c.user_status
            }`}
            scores={{ rt: c.rt_score, imdb: c.imdb_rating, mc: c.metacritic, tmdb: c.tmdb_rating }}
            offers={c.my_offers} availabilityCheck={c.availability_check}
          />
        ))}
      </div>
    </>
  );
}
