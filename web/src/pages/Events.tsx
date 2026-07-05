import { Link } from 'react-router-dom';
import { api, img, useApi } from '../api';
import type { EventRow } from '../types';

const LABEL: Record<string, string> = {
  new_episode: 'New episode',
  season_premiere: 'Season premiere',
  arrived_on_service: 'Arrived on your service',
  left_service: 'Left your service',
  now_in_theaters: 'Now in theaters',
  now_streaming: 'Now streaming',
};

const ICON: Record<string, string> = {
  new_episode: '📺',
  season_premiere: '🎉',
  arrived_on_service: '📥',
  left_service: '📤',
  now_in_theaters: '🎬',
  now_streaming: '🏠',
};

function describe(ev: EventRow): string {
  let p: Record<string, unknown> = {};
  try {
    p = JSON.parse(ev.payload);
  } catch { /* ignore */ }
  const name = ev.title_name ?? (p.title_name as string) ?? '';
  switch (ev.type) {
    case 'new_episode':
    case 'season_premiere':
      return `${name} — S${p.season_number}E${p.episode_number}${p.episode_name ? ` · ${p.episode_name}` : ''} airs ${p.air_date ?? ''}`;
    case 'arrived_on_service':
      return `${name} arrived on ${p.provider_name}`;
    case 'left_service':
      return `${name} left ${p.provider_name}`;
    case 'now_in_theaters':
      return `${name} is now in theaters`;
    case 'now_streaming':
      return `${name} can now be watched at home (${p.provider_name ?? 'streaming'})`;
    default:
      return name;
  }
}

export default function Events({ onSeen }: { onSeen: () => void }) {
  const { data, loading, error, reload } = useApi<{ events: EventRow[]; unseen: number }>('/api/events');

  const markAll = async () => {
    await api('/api/events/seen', { json: { all: true } });
    onSeen();
    reload();
  };

  return (
    <>
      <h1>Events</h1>
      <div className="toolbar">
        <button onClick={() => void markAll()} disabled={!data || data.unseen === 0}>
          Mark all seen{data && data.unseen > 0 ? ` (${data.unseen})` : ''}
        </button>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="muted">{error}</p>}
      {data && data.events.length === 0 && (
        <div className="empty">
          <h3>No events yet</h3>
          <p>New episodes, arrivals and departures on your services, and theater-to-streaming alerts land here.</p>
        </div>
      )}
      {data?.events.map((ev) => (
        <div className={`event-item ${ev.seen ? '' : 'unseen'}`} key={ev.id}>
          <span style={{ fontSize: 20 }}>{ICON[ev.type] ?? '•'}</span>
          {ev.poster_path && <img className="thumb" src={img(ev.poster_path, 'w92') ?? ''} alt="" />}
          <div style={{ flex: 1 }}>
            <div>
              {ev.title_id ? <Link to={`/title/${ev.title_id}`} style={{ fontWeight: 600 }}>{describe(ev)}</Link> : describe(ev)}
            </div>
            <div className="faint">
              {LABEL[ev.type] ?? ev.type} · {new Date(ev.created_at).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
