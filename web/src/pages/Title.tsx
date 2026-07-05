import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, countdown, fmtDate, img, useApi } from '../api';
import type { Availability, CastMember, Cadence, Episode, Season, TitleDetail, UserStatus } from '../types';
import Scores from '../components/Scores';

const OFFER_LABEL: Record<string, string> = {
  flatrate: 'Stream', free: 'Free', ads: 'Free with ads', rent: 'Rent', buy: 'Buy',
};

function parseCadence(raw: string | null): Cadence | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Cadence;
  } catch {
    return null;
  }
}

function EpisodeRow({ ep, anchored, onToggle }: { ep: Episode; anchored?: boolean; onToggle: (ep: Episode, watched: boolean) => void }) {
  const future = !!ep.air_date && ep.air_date > new Date().toLocaleDateString('en-CA');
  return (
    <div id={`ep-${ep.id}`} className={`ep ${future ? 'future' : ''} ${anchored ? 'anchored' : ''}`}>
      <input
        type="checkbox"
        checked={!!ep.watched_at}
        disabled={future && !ep.watched_at}
        onChange={(e) => onToggle(ep, e.target.checked)}
        aria-label={`Mark episode ${ep.episode_number} watched`}
      />
      <span className="epnum">E{ep.episode_number}</span>
      <span className="epname" title={ep.overview ?? undefined}>{ep.name ?? `Episode ${ep.episode_number}`}</span>
      {ep.runtime != null && <span className="faint">{ep.runtime}m</span>}
      <span className="epdate">{fmtDate(ep.air_date)}</span>
    </div>
  );
}

function SeasonBlock({ season, defaultOpen, anchorEp, onToggleEp, onToggleSeason }: {
  season: Season;
  defaultOpen: boolean;
  anchorEp?: number | null;
  onToggleEp: (ep: Episode, watched: boolean) => void;
  onToggleSeason: (season: Season, watched: boolean) => void;
}) {
  const watched = season.episodes.filter((e) => e.watched_at).length;
  const aired = season.episodes.filter((e) => e.air_date && e.air_date <= new Date().toLocaleDateString('en-CA')).length;
  return (
    <details className="season" open={defaultOpen}>
      <summary>
        <strong>{season.name ?? `Season ${season.season_number}`}</strong>
        <span className="faint">{season.air_date ? `premiered ${fmtDate(season.air_date)}` : 'no air date yet'}</span>
        <span className="faint">· {watched}/{season.episodes.length} watched</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={(e) => {
            e.preventDefault();
            onToggleSeason(season, watched < aired);
          }}
        >
          {watched < aired ? 'Mark all watched' : 'Mark all unwatched'}
        </button>
      </summary>
      {season.episodes.map((ep) => (
        <EpisodeRow key={ep.id} ep={ep} anchored={ep.id === anchorEp} onToggle={onToggleEp} />
      ))}
    </details>
  );
}

export default function Title() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const anchorEp = Number(searchParams.get('ep')) || null; // Pick For Me lands on the suggested episode
  const { data, loading, error, setData, reload } = useApi<TitleDetail>(`/api/titles/${id}`);
  const [refreshing, setRefreshing] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!data || !anchorEp) return;
    document.getElementById(`ep-${anchorEp}`)?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, anchorEp]);

  // Lazily resolve IMDb ids for cast on first view.
  useEffect(() => {
    if (!data || !data.cast.some((c) => c.imdb_person_id === null)) return;
    let alive = true;
    void api<{ cast: CastMember[] }>(`/api/titles/${data.id}/cast-imdb`, { method: 'POST' })
      .then((res) => alive && setData({ ...data, cast: res.cast }))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.cast.length]);

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="muted">{error}</p>;
  if (!data) return null;

  const t = data;
  const genres: string[] = (() => {
    try { return JSON.parse(t.genres); } catch { return []; }
  })();
  const cadence = parseCadence(t.release_cadence);
  const activeOffers = t.availability.filter((a) => a.active);

  // initial_sync rows come from the title's first provider snapshot: their
  // first_seen is when tracking started, not when the title hit the service.
  // Only initial_sync = 0 rows are genuine, observed arrivals.
  const initialRows = t.availability.filter((a) => a.initial_sync);
  const historyRows = t.availability
    .flatMap((a) => {
      const rows: { date: string; text: string }[] = [];
      if (!a.initial_sync) rows.push({ date: a.first_seen, text: `Arrived on ${a.provider_name} (${OFFER_LABEL[a.offer_type]})` });
      if (!a.active) rows.push({ date: a.last_seen, text: `Left ${a.provider_name} (${OFFER_LABEL[a.offer_type]})` });
      return rows;
    });
  if (initialRows.length > 0) {
    const names = [...new Set(initialRows.map((a) => a.provider_name))];
    historyRows.push({
      date: initialRows.map((a) => a.first_seen).sort()[0],
      text: `Tracking started — already on ${names.join(', ')}`,
    });
  }
  historyRows.sort((a, b) => b.date.localeCompare(a.date));
  const timeline = historyRows.slice(0, 30);

  const digitalDate = t.media_type === 'movie' ? t.release_dates?.find((r) => r.type === 4)?.date ?? null : null;
  // One dated line per streaming provider; prefer observed-arrival rows since
  // those carry a date the app actually saw happen.
  const streamDates = [...activeOffers]
    .filter((a) => ['flatrate', 'free', 'ads'].includes(a.offer_type))
    .sort((a, b) => a.initial_sync - b.initial_sync)
    .filter((a, i, arr) => arr.findIndex((x) => x.provider_id === a.provider_id) === i);

  const patchState = async (body: Record<string, unknown>) => {
    setData(await api<TitleDetail>(`/api/titles/${t.id}/state`, { method: 'PATCH', json: body }));
  };

  const toggleEpisode = async (ep: Episode, watched: boolean) => {
    // optimistic update
    setData({
      ...t,
      seasons: t.seasons.map((s) => ({
        ...s,
        episodes: s.episodes.map((e) => (e.id === ep.id ? { ...e, watched_at: watched ? new Date().toISOString() : null } : e)),
      })),
    });
    await api(`/api/episodes/${ep.id}/watched`, { method: 'PATCH', json: { watched } });
  };

  const toggleSeason = async (season: Season, watched: boolean) => {
    await api(`/api/seasons/${season.id}/watched`, { method: 'PATCH', json: { watched } });
    reload();
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      setData(await api<TitleDetail>(`/api/titles/${t.id}/refresh`, { method: 'POST' }));
    } finally {
      setRefreshing(false);
    }
  };

  const groupedOffers = (['flatrate', 'free', 'ads', 'rent', 'buy'] as const)
    .map((type) => ({ type, offers: activeOffers.filter((a) => a.offer_type === type) }))
    .filter((g) => g.offers.length > 0);
  const onMyService = activeOffers.some(
    (a) => t.my_service_ids.includes(a.provider_id) && ['flatrate', 'free', 'ads'].includes(a.offer_type),
  );

  return (
    <>
      <div className="backdrop">
        {t.backdrop_path && <img className="bg" src={img(t.backdrop_path, 'w1280') ?? ''} alt="" />}
        <div className="overlay" style={t.backdrop_path ? undefined : { position: 'static' }}>
          {t.poster_path && <img className="poster" src={img(t.poster_path, 'w342') ?? ''} alt="" />}
          <div>
            <h1 style={{ margin: 0 }}>
              {t.name} {t.year && <span className="muted">({t.year})</span>}
            </h1>
            <div className="muted" style={{ margin: '6px 0' }}>
              {t.media_type === 'tv' ? 'TV series' : 'Movie'}
              {genres.length > 0 && <> · {genres.join(', ')}</>}
              {t.runtime != null && <> · {t.runtime} min{t.media_type === 'tv' ? '/ep' : ''}</>}
              {t.status_upstream && <> · {t.status_upstream}</>}
              {cadence && <> · <strong style={{ color: 'var(--accent)' }}>{cadence.detail}</strong></>}
            </div>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <select
                value={t.user_status ?? 'wishlist'}
                onChange={(e) => void patchState({ status: e.target.value as UserStatus })}
                aria-label="Watch status"
              >
                {['wishlist', 'watching', 'watched', 'paused', 'dropped'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {t.media_type === 'movie' && (
                <label className="pill" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!t.user_watched_at} onChange={(e) => void patchState({ watched: e.target.checked })} /> watched
                </label>
              )}
              <label className="pill" style={{ cursor: 'pointer' }} title="Exclude from Pick For Me suggestions">
                <input type="checkbox" checked={!!t.never_suggest} onChange={(e) => void patchState({ never_suggest: e.target.checked })} /> never suggest
              </label>
              <select
                value={t.user_rating ?? ''}
                onChange={(e) => void patchState({ user_rating: e.target.value ? Number(e.target.value) : null })}
                aria-label="My rating"
              >
                <option value="">my rating</option>
                {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => (
                  <option key={n} value={n}>{n}/10</option>
                ))}
              </select>
              <button onClick={() => void refresh()} disabled={refreshing}>
                <span className={refreshing ? 'spin' : ''}>⟳</span> Refresh
              </button>
              {t.imdb_id && (
                <a className="pill" href={`https://www.imdb.com/title/${t.imdb_id}/`} target="_blank" rel="noreferrer">
                  IMDb ↗
                </a>
              )}
            </div>
            <div className="faint" style={{ marginTop: 6 }}>
              metadata refreshed {t.metadata_refreshed_at ? fmtDate(t.metadata_refreshed_at) : 'never'}
            </div>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <div className="panel">
            <h3>Scores</h3>
            <Scores rt={t.rt_score} imdb={t.imdb_rating} mc={t.metacritic} tmdb={t.tmdb_rating} ratingsRefreshedAt={t.ratings_refreshed_at} />
          </div>

          {t.overview && (
            <div className="panel">
              <h3>Overview</h3>
              <p style={{ margin: 0 }}>{t.overview}</p>
            </div>
          )}

          {t.media_type === 'tv' && (
            <div className="panel">
              <h3>Seasons</h3>
              {(t.next_unwatched || t.next_airing) && (
                <p style={{ marginTop: 0 }}>
                  {t.next_unwatched && (
                    <>
                      <strong>Next up for you:</strong> S{t.next_unwatched.season_number}E{t.next_unwatched.episode_number}
                      {t.next_unwatched.name ? ` · ${t.next_unwatched.name}` : ''}
                      <br />
                    </>
                  )}
                  {t.next_airing && (
                    <>
                      <strong>Next airing:</strong> S{t.next_airing.season_number}E{t.next_airing.episode_number}
                      {t.next_airing.name ? ` · ${t.next_airing.name}` : ''} — {fmtDate(t.next_airing.air_date)} ({countdown(t.next_airing.air_date)})
                    </>
                  )}
                </p>
              )}
              {t.seasons
                .filter((s) => s.season_number > 0 || s.episodes.length > 0)
                .map((s) => (
                  <SeasonBlock
                    key={s.id}
                    season={s}
                    defaultOpen={
                      anchorEp
                        ? s.episodes.some((e) => e.id === anchorEp)
                        : t.next_unwatched ? s.episodes.some((e) => e.id === t.next_unwatched!.id) : false
                    }
                    anchorEp={anchorEp}
                    onToggleEp={(ep, w) => void toggleEpisode(ep, w)}
                    onToggleSeason={(se, w) => void toggleSeason(se, w)}
                  />
                ))}
            </div>
          )}

          <div className="panel">
            <h3>Cast</h3>
            {t.cast.length === 0 && <p className="muted" style={{ margin: 0 }}>No cast data.</p>}
            <div className="cast-grid">
              {t.cast.map((c) => {
                const hasImdb = c.imdb_person_id && c.imdb_person_id !== 'none';
                const inner = (
                  <>
                    {c.profile_path ? (
                      <img src={img(c.profile_path, 'w185') ?? ''} alt="" loading="lazy" />
                    ) : (
                      <div className="nophoto">👤</div>
                    )}
                    <div className="cname">{c.name}{hasImdb ? ' ↗' : ''}</div>
                    <div className="cchar">{c.character}</div>
                  </>
                );
                return hasImdb ? (
                  <a key={c.id} className="cast-card" href={`https://www.imdb.com/name/${c.imdb_person_id}/`} target="_blank" rel="noreferrer" title={`${c.name} on IMDb`}>
                    {inner}
                  </a>
                ) : (
                  <div key={c.id} className="cast-card">{inner}</div>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <h3>Where to Watch ({t.region})</h3>
            {groupedOffers.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {t.status_upstream === 'In Theaters'
                  ? 'In theaters — you’ll get a "now streaming" alert when a home offer appears.'
                  : 'No streaming offers reported.'}
              </p>
            )}
            {!onMyService && groupedOffers.length > 0 && (
              <p className="faint" style={{ marginTop: 0 }}>⚠ Not on your services — rental/purchase or another subscription needed.</p>
            )}
            {groupedOffers.map((g) => (
              <div key={g.type} style={{ marginBottom: 10 }}>
                <div className="faint" style={{ marginBottom: 4 }}>{OFFER_LABEL[g.type]}</div>
                <div className="providers">
                  {g.offers.map((a: Availability) => (
                    <span key={a.id} className={`provider ${t.my_service_ids.includes(a.provider_id) ? 'mine' : 'flagged'}`} title={t.my_service_ids.includes(a.provider_id) ? 'On your services' : 'Not one of your services'}>
                      {a.logo_path && <img src={img(a.logo_path, 'w92') ?? ''} alt="" />}
                      {a.provider_name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {(digitalDate || (t.media_type === 'tv' && t.premiere_date) || streamDates.length > 0) && (
              <div style={{ marginBottom: 8 }}>
                {t.media_type === 'movie' && digitalDate && <div>Digital release: {fmtDate(digitalDate)}</div>}
                {t.media_type === 'tv' && t.premiere_date && <div>Premiered: {fmtDate(t.premiere_date)}</div>}
                {streamDates.map((a) => (
                  <div key={a.provider_id} className="faint">
                    {a.initial_sync
                      ? `On ${a.provider_name} since at least ${fmtDate(a.first_seen)}`
                      : `Arrived on ${a.provider_name} ${fmtDate(a.first_seen)}`}
                  </div>
                ))}
              </div>
            )}
            <div className="faint">watch-provider data by JustWatch</div>
          </div>

          <div className="panel">
            <h3>Availability History</h3>
            {timeline.length === 0 && <p className="muted" style={{ margin: 0 }}>No availability seen yet.</p>}
            <div className="timeline">
              {timeline.map((h, i) => (
                <div className="tl-item" key={i}>
                  <span className="tl-date">{fmtDate(h.date)}</span>
                  <span>{h.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>Notes</h3>
            <textarea
              rows={4}
              style={{ width: '100%' }}
              placeholder="Private notes…"
              value={notesDraft ?? t.notes ?? ''}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={() => {
                if (notesDraft !== null && notesDraft !== (t.notes ?? '')) void patchState({ notes: notesDraft });
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
