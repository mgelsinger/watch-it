import { useState } from 'react';
import { Link } from 'react-router-dom';
import { img, useApi } from '../api';

interface HistoryItem {
  kind: 'episode' | 'movie';
  title_id: number;
  title_name: string;
  poster_path: string | null;
  media_type: 'movie' | 'tv';
  season_number: number | null;
  episode_number: number | null;
  episode_name: string | null;
  runtime: number | null;
  watched_at: string;
}

interface Stats {
  episodes_total: number;
  episodes_this_month: number;
  movies_total: number;
  minutes_total: number;
}

export default function History() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState<string>('');
  const [type, setType] = useState<string>('');
  const qs = new URLSearchParams();
  if (year) qs.set('year', year);
  if (type) qs.set('type', type);
  const { data, loading, error } = useApi<{ items: HistoryItem[]; stats: Stats }>(`/api/history?${qs}`);

  const hours = data ? Math.round(data.stats.minutes_total / 60) : 0;

  return (
    <>
      <h1>History</h1>
      {data && (
        <p className="muted">
          {data.stats.episodes_this_month} episodes this month · {data.stats.episodes_total} episodes and{' '}
          {data.stats.movies_total} movies all-time · about {hours} hours watched.
        </p>
      )}
      <div className="toolbar">
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Filter year">
          <option value="">all years</option>
          {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter type">
          <option value="">movies & TV</option>
          <option value="tv">TV only</option>
          <option value="movie">movies only</option>
        </select>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="muted">{error}</p>}
      {data && data.items.length === 0 && (
        <div className="empty">
          <h3>No watch history yet</h3>
          <p>Mark episodes or movies watched and they’ll show up here.</p>
        </div>
      )}
      {data && data.items.length > 0 && (
        <table className="list-table">
          <thead>
            <tr>
              <th></th>
              <th>Title</th>
              <th>What</th>
              <th>Runtime</th>
              <th>Watched</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it, i) => (
              <tr key={i}>
                <td style={{ width: 40 }}>
                  {it.poster_path ? <img className="thumb" src={img(it.poster_path, 'w92') ?? ''} alt="" loading="lazy" /> : <span className="thumb" />}
                </td>
                <td>
                  <Link to={`/title/${it.title_id}`} style={{ fontWeight: 600 }}>{it.title_name}</Link>
                </td>
                <td className="muted">
                  {it.kind === 'episode'
                    ? `S${it.season_number}E${it.episode_number}${it.episode_name ? ` · ${it.episode_name}` : ''}`
                    : 'Movie'}
                </td>
                <td className="muted">{it.runtime != null ? `${it.runtime}m` : '—'}</td>
                <td className="muted">{new Date(it.watched_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
