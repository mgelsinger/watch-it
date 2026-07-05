import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api';
import type { SyncState } from './types';
import Home from './pages/Home';
import Search from './pages/Search';
import Library from './pages/Library';
import Title from './pages/Title';
import Schedule from './pages/Schedule';
import History from './pages/History';
import Events from './pages/Events';
import Settings from './pages/Settings';

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('watch-it-theme', theme);
    } catch { /* private mode */ }
    void api('/api/settings', { method: 'PUT', json: { theme } }).catch(() => {});
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export default function App() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [unseen, setUnseen] = useState(0);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [theme, toggleTheme] = useTheme();

  // Poll unseen events + sync state (fast while a sync runs).
  useEffect(() => {
    let timer: number;
    const poll = async () => {
      try {
        const ev = await api<{ unseen: number }>('/api/events?unseen=1');
        setUnseen(ev.unseen);
        const st = await api<{ state: SyncState }>('/api/sync/status');
        setSync(st.state);
        timer = window.setTimeout(poll, st.state.running ? 2500 : 60_000);
      } catch {
        timer = window.setTimeout(poll, 60_000);
      }
    };
    void poll();
    return () => window.clearTimeout(timer);
  }, []);

  const startSync = async () => {
    const res = await api<{ state: SyncState }>('/api/sync/run', { method: 'POST' });
    setSync({ ...res.state, running: true });
    window.setTimeout(async () => {
      const st = await api<{ state: SyncState }>('/api/sync/status');
      setSync(st.state);
    }, 2500);
  };

  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="logo">watch-it</NavLink>
        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/schedule">Schedule</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
        >
          <input
            type="search"
            placeholder="Search movies & TV…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
        </form>
        <div className="spacer" />
        <button
          className="iconbtn"
          onClick={startSync}
          disabled={!!sync?.running}
          title={
            sync?.running
              ? `Syncing… ${sync.done}/${sync.total || '?'}`
              : sync?.lastFinishedAt
                ? `Refresh all (last sync ${new Date(sync.lastFinishedAt).toLocaleString()})`
                : 'Refresh all'
          }
        >
          <span className={sync?.running ? 'spin' : ''}>⟳</span>
          {sync?.running && <span style={{ fontSize: 12, marginLeft: 6 }}>{sync.done}/{sync.total || '…'}</span>}
        </button>
        <NavLink to="/events" className="iconbtn" title="Events" aria-label={`Events, ${unseen} unseen`}>
          🔔{unseen > 0 && <span className="badge">{unseen > 99 ? '99+' : unseen}</span>}
        </NavLink>
        <button className="iconbtn" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <NavLink to="/settings" className="iconbtn" title="Settings">⚙️</NavLink>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/library" element={<Library />} />
          <Route path="/title/:id" element={<Title />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/history" element={<History />} />
          <Route path="/events" element={<Events onSeen={() => setUnseen(0)} />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      <footer className="attribution">
        Metadata and posters from{' '}
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDB</a>. This product uses the TMDB API
        but is not endorsed or certified by TMDB. Watch-provider data by{' '}
        <a href="https://www.justwatch.com/" target="_blank" rel="noreferrer">JustWatch</a>. Ratings via{' '}
        <a href="https://www.omdbapi.com/" target="_blank" rel="noreferrer">OMDb</a>. Broadcast schedule by{' '}
        <a href="https://www.tvmaze.com/" target="_blank" rel="noreferrer">TVmaze</a>.
      </footer>
    </>
  );
}
