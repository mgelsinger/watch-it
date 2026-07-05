import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, useApi } from '../api';
import type { SearchResult, TitleDetail, UserStatus } from '../types';
import PosterCard from '../components/PosterCard';

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const navigate = useNavigate();
  const { data, loading, error, setData } = useApi<{ results: SearchResult[] }>(
    q ? `/api/search?q=${encodeURIComponent(q)}` : null,
  );
  const [addStatus, setAddStatus] = useState<UserStatus>('wishlist');
  const [adding, setAdding] = useState<number | null>(null);

  const add = async (r: SearchResult) => {
    setAdding(r.tmdb_id);
    try {
      const detail = await api<TitleDetail>('/api/titles', {
        json: { tmdb_id: r.tmdb_id, media_type: r.media_type, status: addStatus },
      });
      setData(data ? { results: data.results.map((x) => (x.tmdb_id === r.tmdb_id && x.media_type === r.media_type ? { ...x, library_id: detail.id } : x)) } : data);
      navigate(`/title/${detail.id}`);
    } finally {
      setAdding(null);
    }
  };

  return (
    <>
      <h1>Search{q ? `: “${q}”` : ''}</h1>
      <div className="toolbar">
        <span className="muted">Add as</span>
        <select value={addStatus} onChange={(e) => setAddStatus(e.target.value as UserStatus)}>
          <option value="wishlist">Wishlist</option>
          <option value="watching">Watching</option>
          <option value="watched">Watched</option>
        </select>
      </div>
      {loading && <p className="muted">Searching…</p>}
      {error && <p className="muted">Search failed: {error}</p>}
      {adding && <p className="muted">Adding… pulling metadata, seasons, cast and providers.</p>}
      {data && data.results.length === 0 && <div className="empty">No movies or shows matched “{q}”.</div>}
      <div className="grid">
        {data?.results.map((r) => (
          <PosterCard
            key={`${r.media_type}:${r.tmdb_id}`}
            linkId={r.library_id}
            name={r.name}
            year={r.year}
            posterPath={r.poster_path}
            sub={`${r.media_type === 'tv' ? 'TV' : 'Movie'}${r.year ? ` · ${r.year}` : ''}${r.library_id ? ' · in library' : ''}`}
            scores={{ tmdb: r.tmdb_rating }}
            onAdd={r.library_id ? undefined : () => void add(r)}
          />
        ))}
      </div>
    </>
  );
}
