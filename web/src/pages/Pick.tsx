import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, img } from '../api';
import type { BrowseGenre, PickCandidate, PickConstraints, PickResult } from '../types';

const DEFAULTS: PickConstraints = {
  time: 60,
  type: 'either',
  genres: [],
  my_services_only: true,
  include_rent_buy: false,
  unwatched_only: true,
  bingeable_only: false,
};

// 150 stands in for "2h+"; both it and null disable the budget server-side,
// but they stay distinct so the form reopens on the chip that was picked.
const TIME_OPTIONS: { label: string; value: number | null }[] = [
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
  { label: '2h+', value: 150 },
  { label: 'No limit', value: null },
];

function timeLabel(time: number | null): string {
  return TIME_OPTIONS.find((t) => t.value === time)?.label ?? `${time} min`;
}

function runtimeLine(c: PickCandidate, constraints: PickConstraints): string {
  const rt = `${c.runtime} min${c.runtime_estimated ? ' (est.)' : ''}`;
  const budget = constraints.time != null && constraints.time < 120 ? constraints.time : null;
  if (budget == null) return rt;
  if (c.fits_episodes && c.fits_episodes > 1) return `${rt} — fits ${c.fits_episodes} episodes in your ${budget} min`;
  return `${rt} — fits your ${budget === 60 ? 'hour' : `${budget} min`}`;
}

function saveConstraints(c: PickConstraints): void {
  void api('/api/settings', { method: 'PUT', json: { pick_constraints: JSON.stringify(c) } }).catch(() => {});
}

export default function Pick() {
  const navigate = useNavigate();
  const [constraints, setConstraints] = useState<PickConstraints | null>(null); // null until last-used values load
  const [genres, setGenres] = useState<BrowseGenre[]>([]);
  const [stage, setStage] = useState<'form' | 'loop'>('form');
  const [result, setResult] = useState<PickResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmNever, setConfirmNever] = useState(false);
  const shown = useRef<number[]>([]);

  useEffect(() => {
    void api<{ settings: Record<string, string> }>('/api/settings')
      .then((r) => {
        let saved: Partial<PickConstraints> = {};
        try {
          saved = JSON.parse(r.settings.pick_constraints ?? '{}');
        } catch { /* corrupt/legacy value */ }
        setConstraints({ ...DEFAULTS, ...saved });
      })
      .catch(() => setConstraints(DEFAULTS));
    void api<{ genres: BrowseGenre[] }>('/api/browse/genres')
      .then((r) => setGenres(r.genres))
      .catch(() => {}); // offline with a cold cache: mood chips just unavailable
  }, []);

  const fetchNext = async (c: PickConstraints, exclude: number[]) => {
    setBusy(true);
    setConfirmNever(false);
    try {
      const r = await api<PickResult>('/api/pick/next', { json: { constraints: c, exclude } });
      setResult(r);
      if (r.candidate) shown.current = [...exclude, r.candidate.title_id];
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    if (!constraints) return;
    saveConstraints(constraints);
    shown.current = [];
    setStage('loop');
    void fetchNext(constraints, []);
  };

  const loosen = (patch: Partial<PickConstraints>) => {
    if (!constraints) return;
    const next = { ...constraints, ...patch };
    setConstraints(next);
    saveConstraints(next);
    void fetchNext(next, shown.current);
  };

  const log = (c: PickCandidate, action: 'accepted' | 'shuffled' | 'skipped') =>
    api('/api/pick/log', { json: { title_id: c.title_id, episode_id: c.episode_id, action, constraints } }).catch(() => {});

  const watchThis = async (c: PickCandidate) => {
    await log(c, 'accepted');
    navigate(`/title/${c.title_id}${c.episode_id ? `?ep=${c.episode_id}` : ''}`);
  };

  const next = async (c: PickCandidate, action: 'shuffled' | 'skipped') => {
    if (!constraints) return;
    void log(c, action);
    await fetchNext(constraints, shown.current);
  };

  const neverSuggest = async (c: PickCandidate) => {
    if (!constraints) return;
    await api(`/api/titles/${c.title_id}/state`, { method: 'PATCH', json: { never_suggest: true } });
    await fetchNext(constraints, shown.current);
  };

  if (!constraints) return <p className="muted">Loading…</p>;
  const c = constraints;
  const cand = result?.candidate ?? null;

  return (
    <div className="pick-panel">
      <div className="pick-head">
        <h1 style={{ margin: 0 }}>🎲 Pick For Me Tonight</h1>
        <span style={{ flex: 1 }} />
        {stage === 'loop' && <button onClick={() => setStage('form')}>Adjust filters</button>}
        <button onClick={() => navigate('/')} aria-label="Close">✕ Close</button>
      </div>

      {stage === 'form' && (
        <div className="pick-form">
          <div className="pick-field">
            <div className="pick-label">Time available</div>
            <div className="pick-chips">
              {TIME_OPTIONS.map((t) => (
                <button key={t.label} className={`chip ${c.time === t.value ? 'on' : ''}`}
                  onClick={() => setConstraints({ ...c, time: t.value })}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pick-field">
            <div className="pick-label">Type</div>
            <div className="pick-chips">
              {([['episode', 'Episode'], ['movie', 'Movie'], ['either', 'Either']] as const).map(([v, label]) => (
                <button key={v} className={`chip ${c.type === v ? 'on' : ''}`} onClick={() => setConstraints({ ...c, type: v })}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="pick-field">
            <div className="pick-label">Mood {c.genres.length > 0 && <button className="pick-clear" onClick={() => setConstraints({ ...c, genres: [] })}>clear</button>}</div>
            <div className="pick-chips">
              {genres.map((g) => (
                <button key={g.key} className={`chip ${c.genres.includes(g.key) ? 'on' : ''}`}
                  onClick={() => setConstraints({ ...c, genres: c.genres.includes(g.key) ? c.genres.filter((k) => k !== g.key) : [...c.genres, g.key] })}>
                  {g.name}
                </button>
              ))}
              {genres.length === 0 && <span className="muted">genre list unavailable — any mood</span>}
            </div>
          </div>

          <div className="pick-field pick-toggles">
            <label className="pill" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={c.my_services_only}
                onChange={(e) => setConstraints({ ...c, my_services_only: e.target.checked, include_rent_buy: e.target.checked ? c.include_rent_buy : false })} />
              {' '}On my services only
            </label>
            {c.my_services_only && (
              <label className="pill" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={c.include_rent_buy}
                  onChange={(e) => setConstraints({ ...c, include_rent_buy: e.target.checked })} />
                {' '}Include rent/buy
              </label>
            )}
            <label className="pill" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={c.unwatched_only}
                onChange={(e) => setConstraints({ ...c, unwatched_only: e.target.checked })} />
              {' '}Unwatched only
            </label>
            <label className="pill" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={c.bingeable_only}
                onChange={(e) => setConstraints({ ...c, bingeable_only: e.target.checked })} />
              {' '}Bingeable only
            </label>
          </div>

          <button className="primary pick-go" onClick={start}>Pick For Me</button>
        </div>
      )}

      {stage === 'loop' && (
        <div className="pick-loop">
          {busy && !result && <p className="muted">Picking…</p>}

          {result?.empty && (
            <div className="empty">
              <h3>Nothing fits</h3>
              <p>{result.empty.message}</p>
              <div className="pick-chips" style={{ justifyContent: 'center' }}>
                {result.empty.loosen.map((l) => (
                  <button key={l.label} className="primary" onClick={() => loosen(l.patch)}>{l.label}</button>
                ))}
                <button onClick={() => setStage('form')}>Adjust filters</button>
              </div>
            </div>
          )}

          {result?.exhausted && (
            <div className="empty">
              <h3>That’s everything</h3>
              <p>You’ve seen all {result.pool_size} candidates this session.</p>
              <div className="pick-chips" style={{ justifyContent: 'center' }}>
                <button className="primary" onClick={() => { shown.current = []; void fetchNext(c, []); }}>Start over</button>
                <button onClick={() => setStage('form')}>Adjust filters</button>
              </div>
            </div>
          )}

          {cand && (
            <div className="pick-card">
              {cand.poster_path
                ? <img className="pick-poster" src={img(cand.poster_path, 'w500') ?? ''} alt="" />
                : <div className="pick-poster noposter">{cand.name}</div>}
              <div className="pick-info">
                <div className="pick-badges">
                  <span className="typechip">{cand.media_type === 'movie' ? 'Movie' : 'Episode'}</span>
                  {cand.kind === 'rewatch' && <span className="flag" style={{ position: 'static' }}>Rewatch</span>}
                </div>
                <h2 className="pick-title">{cand.name} {cand.year && <span className="muted">({cand.year})</span>}</h2>
                {cand.media_type === 'tv' && cand.season_number != null && (
                  <div className="pick-ep">
                    S{cand.season_number}E{cand.episode_number}{cand.episode_name ? ` · ${cand.episode_name}` : ''}
                  </div>
                )}
                <div className="muted">{runtimeLine(cand, c)}</div>
                {cand.reasons.length > 0 && <div className="pick-reasons">{cand.reasons.join(' · ')}</div>}
                {cand.rent_buy_only && <div className="faint">Rental/purchase only on your services</div>}

                <div className="pick-actions">
                  <button className="primary" disabled={busy} onClick={() => void watchThis(cand)}>▶ Watch This</button>
                  <button disabled={busy} onClick={() => void next(cand, 'shuffled')}>🎲 Shuffle</button>
                  <button disabled={busy} onClick={() => void next(cand, 'skipped')}>Not Tonight</button>
                  {confirmNever ? (
                    <span className="pick-confirm">
                      Never suggest “{cand.name}”?
                      <button disabled={busy} onClick={() => void neverSuggest(cand)}>Yes, never</button>
                      <button disabled={busy} onClick={() => setConfirmNever(false)}>Cancel</button>
                    </span>
                  ) : (
                    <button disabled={busy} onClick={() => setConfirmNever(true)}>Never Suggest</button>
                  )}
                </div>
                <div className="faint" style={{ marginTop: 10 }}>
                  {result!.pool_size} candidate{result!.pool_size === 1 ? '' : 's'} match your filters
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
