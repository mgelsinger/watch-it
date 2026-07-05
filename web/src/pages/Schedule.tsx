import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtDate, useApi } from '../api';
import type { ScheduleItem, TitleDetail } from '../types';

function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

export default function Schedule() {
  const today = new Date().toLocaleDateString('en-CA');
  const [date, setDate] = useState(today);
  const navigate = useNavigate();
  const { data, loading, error, setData } = useApi<{ date: string; country: string; items: ScheduleItem[] }>(
    `/api/schedule?date=${date}`,
  );
  const [addingKey, setAddingKey] = useState<string | null>(null);

  const byNetwork = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const item of data?.items ?? []) {
      if (!map.has(item.network)) map.set(item.network, []);
      map.get(item.network)!.push(item);
    }
    for (const list of map.values()) list.sort((a, b) => a.airtime.localeCompare(b.airtime));
    // Networks with followed shows first, then alphabetical.
    return [...map.entries()].sort((a, b) => {
      const af = a[1].some((i) => i.library_id) ? 0 : 1;
      const bf = b[1].some((i) => i.library_id) ? 0 : 1;
      return af - bf || a[0].localeCompare(b[0]);
    });
  }, [data]);

  const addShow = async (item: ScheduleItem) => {
    const key = `${item.show_name}:${item.airtime}`;
    setAddingKey(key);
    try {
      const detail = await api<TitleDetail>('/api/titles/from-external', {
        json: { imdb_id: item.imdb_id, name: item.show_name },
      });
      setData(data ? { ...data, items: data.items.map((i) => (i.show_name === item.show_name ? { ...i, library_id: detail.id } : i)) } : data);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setAddingKey(null);
    }
  };

  return (
    <>
      <h1>Prime Time Schedule</h1>
      <div className="toolbar">
        <button onClick={() => setDate(shiftDate(date, -1))} disabled={date <= shiftDate(today, -7)}>← prev</button>
        <input type="date" value={date} min={shiftDate(today, -7)} max={shiftDate(today, 7)} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button onClick={() => setDate(shiftDate(date, 1))} disabled={date >= shiftDate(today, 7)}>next →</button>
        {date !== today && <button onClick={() => setDate(today)}>today</button>}
        <span className="muted">
          {fmtDate(date)} · {data?.country ?? ''} broadcast (TVmaze)
        </span>
      </div>
      {loading && <p className="muted">Loading schedule…</p>}
      {error && <p className="muted">{error}</p>}
      {data && data.items.length === 0 && <div className="empty">No broadcast schedule for this day.</div>}
      {byNetwork.map(([network, items]) => (
        <div className="schedule-net" key={network}>
          <h3>{network}</h3>
          {items.map((item, i) => {
            const key = `${item.show_name}:${item.airtime}`;
            return (
              <div className={`sched-item ${item.library_id ? 'followed' : ''}`} key={i}>
                <span className="time">{item.airtime || '—'}</span>
                {item.library_id ? (
                  <a
                    style={{ fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => navigate(`/title/${item.library_id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/title/${item.library_id}`)}
                    tabIndex={0}
                  >
                    {item.show_name}
                  </a>
                ) : (
                  <span>{item.show_name}</span>
                )}
                <span className="faint">
                  {item.season != null && item.number != null ? `S${item.season}E${item.number}` : ''}
                  {item.episode_name ? ` · ${item.episode_name}` : ''}
                </span>
                <span style={{ flex: 1 }} />
                {item.library_id ? (
                  <span className="pill on">following</span>
                ) : (
                  <button onClick={() => void addShow(item)} disabled={addingKey === key}>
                    {addingKey === key ? 'adding…' : '+ add'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
