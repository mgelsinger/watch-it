import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, img } from '../api';
import type { BrowseGenre, PickCandidate, PickConstraints, PickResult, PickSessionState, TitleDetail } from '../types';

const DEFAULTS: PickConstraints = {
  time: 60,
  type: 'either',
  genres: [],
  my_services_only: false,
  include_rent_buy: false,
  exclude_library_titles: true,
};

const TIME_OPTIONS: { label: string; value: number | null }[] = [
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
  { label: '2h+', value: 150 },
  { label: 'No limit', value: null },
];

function normalizeSaved(raw: string | undefined): PickConstraints {
  try {
    const value = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    const savedType = value.type === 'episode' ? 'tv' : value.type;
    return {
      time: typeof value.time === 'number' || value.time === null ? value.time : DEFAULTS.time,
      type: savedType === 'tv' || savedType === 'movie' || savedType === 'either' ? savedType : DEFAULTS.type,
      genres: Array.isArray(value.genres) ? value.genres.filter((item): item is string => typeof item === 'string') : [],
      my_services_only: typeof value.my_services_only === 'boolean' ? value.my_services_only : DEFAULTS.my_services_only,
      include_rent_buy: typeof value.include_rent_buy === 'boolean' ? value.include_rent_buy : DEFAULTS.include_rent_buy,
      exclude_library_titles: typeof value.exclude_library_titles === 'boolean'
        ? value.exclude_library_titles
        : DEFAULTS.exclude_library_titles,
    };
  } catch {
    return DEFAULTS;
  }
}

function runtimeLine(candidate: PickCandidate): string {
  return `${candidate.runtime} min${candidate.runtime_estimated ? ' estimated' : ''}`;
}

function sourceLabel(candidate: PickCandidate): string {
  if (candidate.source === 'new_release') return 'New release';
  if (candidate.source === 'airing_now') return 'Airing now';
  return 'Popular now';
}

function saveConstraints(constraints: PickConstraints): void {
  void api('/api/settings', {
    method: 'PUT',
    json: { pick_constraints: JSON.stringify(constraints) },
  }).catch(() => {});
}

export default function Pick() {
  const navigate = useNavigate();
  const location = useLocation();
  const restored = (location.state as { pickSession?: PickSessionState } | null)?.pickSession;
  const [constraints, setConstraints] = useState<PickConstraints | null>(restored?.constraints ?? null);
  const [genres, setGenres] = useState<BrowseGenre[]>([]);
  const [stage, setStage] = useState<'form' | 'loop'>(restored ? 'loop' : 'form');
  const [result, setResult] = useState<PickResult | null>(restored?.result ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmNever, setConfirmNever] = useState(false);
  const shown = useRef<string[]>(restored?.shown ?? []);

  useEffect(() => {
    if (!restored) {
      void api<{ settings: Record<string, string> }>('/api/settings')
        .then((response) => {
          const saved = normalizeSaved(response.settings.pick_constraints);
          if (response.settings.pick_scope_default_v2 !== '1') {
            const upgraded = { ...saved, my_services_only: false, include_rent_buy: false };
            setConstraints(upgraded);
            void api('/api/settings', {
              method: 'PUT',
              json: {
                pick_constraints: JSON.stringify(upgraded),
                pick_scope_default_v2: '1',
              },
            }).catch(() => {});
          } else {
            setConstraints(saved);
          }
        })
        .catch(() => setConstraints(DEFAULTS));
    }
    void api<{ genres: BrowseGenre[] }>('/api/browse/genres')
      .then((response) => setGenres(response.genres))
      .catch(() => {});
  }, []);

  const fetchNext = async (nextConstraints: PickConstraints, exclude: string[]) => {
    setBusy(true);
    setError(null);
    setConfirmNever(false);
    try {
      const response = await api<PickResult>('/api/pick/next', {
        json: { constraints: nextConstraints, exclude },
      });
      setResult(response);
      if (response.candidate) shown.current = [...exclude, response.candidate.key];
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    if (!constraints) return;
    saveConstraints(constraints);
    shown.current = [];
    setResult(null);
    setNotice(null);
    setStage('loop');
    void fetchNext(constraints, []);
  };

  const loosen = (patch: Partial<PickConstraints>) => {
    if (!constraints) return;
    const next = { ...constraints, ...patch };
    setConstraints(next);
    saveConstraints(next);
    setNotice(null);
    void fetchNext(next, shown.current);
  };

  const log = (
    candidate: PickCandidate,
    action: 'accepted' | 'shuffled' | 'skipped',
    titleId: number | null = candidate.library_id,
  ) => api('/api/pick/log', {
    json: {
      tmdb_id: candidate.tmdb_id,
      media_type: candidate.media_type,
      title_id: titleId,
      action,
      constraints,
    },
  }).catch(() => {});

  const saveAndContinue = async (candidate: PickCandidate, status: 'saved' | 'wishlist' | 'watching' | 'watched') => {
    if (!constraints) return;
    setBusy(true);
    setError(null);
    try {
      let titleId = candidate.library_id;
      if (!titleId) {
        const title = await api<TitleDetail>('/api/titles', {
          json: { tmdb_id: candidate.tmdb_id, media_type: candidate.media_type, status },
        });
        titleId = title.id;
      }
      await api(`/api/titles/${titleId}/state`, {
        method: 'PATCH',
        json: status === 'watched' && candidate.media_type === 'movie'
          ? { status, watched: true }
          : { status },
      });
      await log(candidate, 'accepted', titleId);
      setNotice(
        status === 'saved'
          ? `${candidate.name} was saved for later.`
          : status === 'wishlist'
            ? `${candidate.name} was added to your Watchlist.`
            : status === 'watching'
              ? `${candidate.name} was added to Watching.`
              : `${candidate.name} was added to your watched history.`,
      );
      await fetchNext(constraints, shown.current);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const openDetails = async (candidate: PickCandidate) => {
    if (busy || !constraints) return;
    setBusy(true);
    setError(null);
    setNotice('Loading full details...');
    try {
      let titleId = candidate.library_id;
      if (!titleId) {
        const title = await api<TitleDetail>('/api/titles/preview', {
          json: { tmdb_id: candidate.tmdb_id, media_type: candidate.media_type },
        });
        titleId = title.id;
      }
      navigate(`/title/${titleId}`, {
        state: {
          fromPick: true,
          pickSession: {
            constraints,
            result,
            shown: shown.current,
          } satisfies PickSessionState,
        },
      });
    } catch (err) {
      setError((err as Error).message);
      setNotice(null);
      setBusy(false);
    }
  };

  const next = async (candidate: PickCandidate, action: 'shuffled' | 'skipped') => {
    if (!constraints) return;
    setNotice(null);
    void log(candidate, action);
    await fetchNext(constraints, shown.current);
  };

  const neverSuggest = async (candidate: PickCandidate) => {
    if (!constraints) return;
    setBusy(true);
    try {
      await api('/api/pick/suppress', {
        method: 'PUT',
        json: { tmdb_id: candidate.tmdb_id, media_type: candidate.media_type, suppressed: true },
      });
      await fetchNext(constraints, shown.current);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!constraints) return <p className="muted">Loading...</p>;
  const candidate = result?.candidate ?? null;

  return (
    <div className="pick-panel">
      <div className="pick-head">
        <h1 style={{ margin: 0 }}>Pick For Me Tonight</h1>
        <span style={{ flex: 1 }} />
        {stage === 'loop' && <button onClick={() => setStage('form')}>Adjust filters</button>}
        <button onClick={() => navigate('/')} aria-label="Close">Close</button>
      </div>

      {stage === 'form' && (
        <div className="pick-form">
          <div className="pick-field">
            <div className="pick-label">Time available</div>
            <div className="pick-chips">
              {TIME_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  className={`chip ${constraints.time === option.value ? 'on' : ''}`}
                  onClick={() => setConstraints({ ...constraints, time: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pick-field">
            <div className="pick-label">Type</div>
            <div className="pick-chips">
              {([['tv', 'TV show'], ['movie', 'Movie'], ['either', 'Either']] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={`chip ${constraints.type === value ? 'on' : ''}`}
                  onClick={() => setConstraints({ ...constraints, type: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="pick-field">
            <div className="pick-label">
              Mood
              {constraints.genres.length > 0 && (
                <button className="pick-clear" onClick={() => setConstraints({ ...constraints, genres: [] })}>clear</button>
              )}
            </div>
            <div className="pick-chips">
              {genres.map((genre) => (
                <button
                  key={genre.key}
                  className={`chip ${constraints.genres.includes(genre.key) ? 'on' : ''}`}
                  onClick={() => setConstraints({
                    ...constraints,
                    genres: constraints.genres.includes(genre.key)
                      ? constraints.genres.filter((key) => key !== genre.key)
                      : [...constraints.genres, genre.key],
                  })}
                >
                  {genre.name}
                </button>
              ))}
              {genres.length === 0 && <span className="muted">Genre list unavailable. Any mood will be used.</span>}
            </div>
          </div>

          <div className="pick-field pick-toggles">
            <label className="pill" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={constraints.my_services_only}
                onChange={(event) => setConstraints({
                  ...constraints,
                  my_services_only: event.target.checked,
                  include_rent_buy: event.target.checked ? constraints.include_rent_buy : false,
                })}
              />
              {' '}Only show services I already use
            </label>
            {!constraints.my_services_only && (
              <span className="faint pick-scope-note">Showing titles across all streaming services</span>
            )}
            {constraints.my_services_only && (
              <label className="pill" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={constraints.include_rent_buy}
                  onChange={(event) => setConstraints({ ...constraints, include_rent_buy: event.target.checked })}
                />
                {' '}Include rent/buy
              </label>
            )}
            <label className="pill" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={constraints.exclude_library_titles}
                onChange={(event) => setConstraints({
                  ...constraints,
                  exclude_library_titles: event.target.checked,
                })}
              />
              {' '}Exclude anything already saved, tracked, or watched
            </label>
          </div>

          <button className="primary pick-go" onClick={start}>Pick For Me</button>
        </div>
      )}

      {stage === 'loop' && (
        <div className="pick-loop">
          {busy && !candidate && <p className="muted">Finding something available now...</p>}
          {notice && <div className="pick-notice" role="status">{notice}</div>}
          {error && <div className="empty"><h3>Recommendations unavailable</h3><p>{error}</p></div>}

          {result?.empty && !error && (
            <div className="empty">
              <h3>Nothing fits</h3>
              <p>{result.empty.message}</p>
              <div className="pick-chips" style={{ justifyContent: 'center' }}>
                {result.empty.loosen.map((option) => (
                  <button key={option.label} className="primary" onClick={() => loosen(option.patch)}>{option.label}</button>
                ))}
                <button onClick={() => setStage('form')}>Adjust filters</button>
              </div>
            </div>
          )}

          {result?.exhausted && (
            <div className="empty">
              <h3>That is everything</h3>
              <p>You have seen all {result.pool_size} matching recommendations this session.</p>
              <div className="pick-chips" style={{ justifyContent: 'center' }}>
                <button className="primary" onClick={() => { shown.current = []; void fetchNext(constraints, []); }}>Start over</button>
                <button onClick={() => setStage('form')}>Adjust filters</button>
              </div>
            </div>
          )}

          {candidate && (
            <div className="pick-card pick-card-link">
              <button
                className="pick-details-hit"
                aria-label={`Open full details for ${candidate.name}`}
                title="Open full details. New titles are added to your Watchlist."
                disabled={busy}
                onClick={() => void openDetails(candidate)}
              />
              {candidate.poster_path
                ? <img className="pick-poster" src={img(candidate.poster_path, 'w500') ?? ''} alt="" />
                : <div className="pick-poster noposter">{candidate.name}</div>}
              <div className="pick-info">
                <div className="pick-badges">
                  <span className="typechip">{candidate.media_type === 'movie' ? 'Movie' : 'TV show'}</span>
                  <span className="flag">{sourceLabel(candidate)}</span>
                </div>
                <h2 className="pick-title">
                  {candidate.name} {candidate.year && <span className="muted">({candidate.year})</span>}
                </h2>
                <div className="muted">{runtimeLine(candidate)}</div>
                {candidate.reasons.length > 0 && <div className="pick-reasons">{candidate.reasons.join(' | ')}</div>}

                <div className="pick-providers" aria-label="Where to watch">
                  {candidate.providers.map((offer) => (
                    <div className="pick-provider" key={offer.provider_id}>
                      {offer.logo_path && <img src={img(offer.logo_path, 'w45') ?? ''} alt="" />}
                      <span>{offer.provider_name}</span>
                      {(offer.offer_type === 'rent' || offer.offer_type === 'buy') && <span className="faint">{offer.offer_type}</span>}
                    </div>
                  ))}
                </div>
                {candidate.rent_buy_only && <div className="faint">Rental or purchase only</div>}

                <div className="pick-actions">
                  <button disabled={busy} onClick={() => void saveAndContinue(candidate, 'saved')}>
                    Save for Later
                  </button>
                  <button className="primary" disabled={busy} onClick={() => void saveAndContinue(candidate, 'wishlist')}>
                    Add to Watchlist
                  </button>
                  <button disabled={busy} onClick={() => void saveAndContinue(candidate, 'watching')}>Start Watching</button>
                  <button disabled={busy} onClick={() => void saveAndContinue(candidate, 'watched')}>Already Watched</button>
                  <button disabled={busy} onClick={() => void next(candidate, 'shuffled')}>Shuffle</button>
                  <button disabled={busy} onClick={() => void next(candidate, 'skipped')}>Not Tonight</button>
                  {confirmNever ? (
                    <span className="pick-confirm">
                      Never suggest {candidate.name}?
                      <button disabled={busy} onClick={() => void neverSuggest(candidate)}>Yes, never</button>
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
