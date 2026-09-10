import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtDate, useApi } from '../api';
import type { BrowseCard, BrowseGenre, BrowseGridPage, TitleDetail } from '../types';
import FilterBar, { anyFilterActive, type BrowseState } from '../components/FilterBar';
import PosterCard from '../components/PosterCard';

// ---- URL <-> state (filters live in query params so views are bookmarkable) ----

function fromParams(sp: URLSearchParams): BrowseState {
  const pick = <T extends string>(key: string, allowed: readonly T[], dflt: T): T => {
    const v = sp.get(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
  };
  return {
    scope: pick('scope', ['discover', 'library'] as const, 'discover'),
    type: pick('type', ['movie', 'tv', 'both'] as const, 'both'),
    genres: (sp.get('genres') ?? '').split(',').filter(Boolean),
    watch: pick('watch', ['any', 'my', 'streaming', 'broadcast'] as const, 'any'),
    excludedProviders: [...new Set((sp.get('exclude_providers') ?? '').split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))],
    status: pick('status', ['returning', 'ended', 'canceled'] as const, '' as const),
    lib: pick('lib', ['not_added', 'saved', 'wishlist', 'watching', 'watched', 'dropped'] as const, '' as const),
    ymin: sp.get('ymin') ?? '',
    ymax: sp.get('ymax') ?? '',
    rating: pick('rating', ['6', '7', '8'] as const, '' as const),
    bingeable: sp.get('bingeable') === '1',
    preferEnglish: sp.get('prefer_english') === '1',
    includeAdaptations: sp.get('include_adaptations') === '1',
    sort: pick('sort', ['newest', 'rating', 'popular', 'az', 'added', 'watched'] as const, '' as const),
  };
}

function toParams(s: BrowseState): URLSearchParams {
  const sp = new URLSearchParams();
  if (s.scope !== 'discover') sp.set('scope', s.scope);
  if (s.type !== 'both') sp.set('type', s.type);
  if (s.genres.length) sp.set('genres', s.genres.join(','));
  if (s.watch !== 'any') sp.set('watch', s.watch);
  if (s.excludedProviders.length) sp.set('exclude_providers', s.excludedProviders.join(','));
  if (s.status) sp.set('status', s.status);
  if (s.lib) sp.set('lib', s.lib);
  if (s.ymin) sp.set('ymin', s.ymin);
  if (s.ymax) sp.set('ymax', s.ymax);
  if (s.rating) sp.set('rating', s.rating);
  if (s.bingeable) sp.set('bingeable', '1');
  if (s.preferEnglish) sp.set('prefer_english', '1');
  if (s.includeAdaptations) sp.set('include_adaptations', '1');
  if (s.sort) sp.set('sort', s.sort);
  return sp;
}

/** Server-side query string for /api/browse/discover and /api/browse/library. */
function apiQuery(s: BrowseState): string {
  const sp = new URLSearchParams();
  sp.set('type', s.type);
  if (s.genres.length) sp.set('genres', s.genres.join(','));
  if (s.watch !== 'any') sp.set('watch', s.watch);
  if (s.excludedProviders.length) sp.set('exclude_providers', s.excludedProviders.join(','));
  if (s.status) sp.set('status', s.status);
  if (s.lib) sp.set('library', s.lib);
  if (s.ymin) sp.set('year_min', s.ymin);
  if (s.ymax) sp.set('year_max', s.ymax);
  if (s.rating) sp.set('rating', s.rating);
  if (s.bingeable) sp.set('bingeable', '1');
  if (s.preferEnglish) sp.set('prefer_english', '1');
  if (s.includeAdaptations) sp.set('include_adaptations', '1');
  sp.set('sort', s.sort || (s.scope === 'library' ? 'added' : 'newest'));
  return sp.toString();
}

// ---- shared card + add-to-wishlist ----

function BrowseCardView({ c, onAdd }: { c: BrowseCard; onAdd: (c: BrowseCard) => void }) {
  return (
    <PosterCard
      linkId={c.library_id}
      name={c.name}
      year={c.year}
      posterPath={c.poster_path}
      sub={c.date && c.date.length > 4 ? fmtDate(c.date) : c.year != null ? String(c.year) : undefined}
      scores={{ tmdb: c.tmdb_rating }}
      typeBadge={c.media_type === 'movie' ? 'Movie' : 'TV'}
      statusBadge={c.user_status ?? undefined}
      offers={c.offers}
      availabilityCheck={c.availability_check}
      englishVersion={c.english_version}
      onAdd={c.library_id ? undefined : () => onAdd(c)}
    />
  );
}

function useAddToWishlist(patch: (c: BrowseCard) => void): (c: BrowseCard) => void {
  return useCallback(
    (c: BrowseCard) => {
      void api<TitleDetail>('/api/titles', { json: { tmdb_id: c.tmdb_id, media_type: c.media_type, status: 'wishlist' } })
        .then((d) => patch({ ...c, library_id: d.id, user_status: 'wishlist' }))
        .catch(() => {});
    },
    [patch],
  );
}

function patchList(list: BrowseCard[], c: BrowseCard): BrowseCard[] {
  return list.map((x) => (x.media_type === c.media_type && x.tmdb_id === c.tmdb_id ? c : x));
}

// ---- genre rows (Discover default view) ----

function LazyGenreRow({ genre, onSeeAll }: { genre: BrowseGenre; onSeeAll: (key: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '400px' }, // start fetching a bit before the row scrolls in
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { data, error, reload, setData } = useApi<{ items: BrowseCard[]; stale: boolean }>(
    visible ? `/api/browse/row?genre=${encodeURIComponent(genre.key)}` : null,
  );
  const add = useAddToWishlist((c) => data && setData({ ...data, items: patchList(data.items, c) }));

  return (
    <section ref={ref} aria-label={genre.name}>
      <div className="row-head">
        <h2 className="row-title">{genre.name}</h2>
        <a className="seeall" href="#" onClick={(e) => { e.preventDefault(); onSeeAll(genre.key); }}>
          See all →
        </a>
      </div>
      {error ? <p role="alert">{error} <button onClick={reload}>Retry</button></p> : !data ? (
        <div className="row-placeholder" />
      ) : (
        <div className="poster-row">
          {data.items.map((c) => (
            <BrowseCardView key={`${c.media_type}:${c.tmdb_id}`} c={c} onAdd={add} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---- Discover grid: infinite scroll over TMDB pages ----

function DiscoverGrid({ query, refresh }: { query: string; refresh: () => void }) {
  const [items, setItems] = useState<BrowseCard[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error' | 'exhausted'>('idle');
  const [manual, setManual] = useState(false);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const initial = useRef(false);
  const loading = phase === 'loading';

  const loadNext = useCallback(async () => {
    const next = page + 1;
    if (request.current || next > totalPages) return;
    const controller = new AbortController();
    request.current = controller;
    setPhase('loading');
    setError(null);
    try {
      const r = await api<BrowseGridPage>(`/api/browse/discover?${query}&page=${next}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems((prev) => {
        const seen = new Set(prev.map((c) => `${c.media_type}:${c.tmdb_id}`));
        return [...prev, ...r.items.filter((c) => {
          const key = `${c.media_type}:${c.tmdb_id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })];
      });
      setPage(r.page);
      setTotalPages(r.total_pages);
      setStale((s) => s || r.stale);
      setNotice((previous) => r.notice ?? previous);
      setManual(r.items.length === 0);
      setPhase(r.page >= r.total_pages ? 'exhausted' : 'idle');
    } catch (e) {
      if (controller.signal.aborted) return;
      setError((e as Error).message);
      setPhase('error');
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [query, page, totalPages]);

  // The parent remounts this grid for each query. Cleanup also handles StrictMode.
  useEffect(() => {
    return () => {
      request.current?.abort();
      request.current = null;
      initial.current = false;
    };
  }, []);
  useEffect(() => {
    if (!initial.current) { initial.current = true; void loadNext(); }
  }, [loadNext]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || phase !== 'idle' || manual || page === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadNext();
      },
      { rootMargin: '600px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadNext, phase, manual, page]);

  const add = useAddToWishlist((c) => setItems((prev) => patchList(prev, c)));

  return (
    <>
      {stale && <div className="stale-note">TMDB is unreachable - showing cached results, which may be out of date.</div>}
      {notice && <p className="muted" role="status">{notice} <button onClick={refresh}>Refresh availability</button></p>}
      {error && <p role="alert">Could not load results: {error} <button onClick={() => void loadNext()}>Retry</button></p>}
      <div className="grid">
        {items.map((c) => (
          <BrowseCardView key={`${c.media_type}:${c.tmdb_id}`} c={c} onAdd={add} />
        ))}
      </div>
      {items.length === 0 && phase === 'exhausted' && <p className="muted">No results for this filter combination.</p>}
      {manual && phase === 'idle' && <p className="muted">No matching titles on this page. More pages are available.</p>}
      {phase === 'idle' && page > 0 && <button onClick={() => void loadNext()}>Load more</button>}
      {loading && <p className="muted">Loading…</p>}
      <div ref={sentinel} />
    </>
  );
}

// ---- Library grid: one local query, instant and offline ----

function LibraryGrid({ query }: { query: string }) {
  const { data, loading, error, setData } = useApi<{ items: BrowseCard[] }>(`/api/browse/library?${query}`);
  const add = useAddToWishlist((c) => data && setData({ ...data, items: patchList(data.items, c) }));
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="muted">{error}</p>;
  if (!data || data.items.length === 0) return <p className="muted">Nothing in your library matches these filters.</p>;
  return (
    <div className="grid">
      {data.items.map((c) => (
        <BrowseCardView key={`${c.media_type}:${c.tmdb_id}`} c={c} onAdd={add} />
      ))}
    </div>
  );
}

// ---- page ----

export default function Browse() {
  const [revision, setRevision] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const state = fromParams(searchParams);
  const genres = useApi<{ genres: BrowseGenre[] }>('/api/browse/genres');

  const update = (patch: Partial<BrowseState>) => {
    const next = { ...state, ...patch };
    // Drop options that don't exist in the new scope.
    if (next.scope === 'library') {
      if (next.watch === 'broadcast') next.watch = 'any';
      if (next.lib === 'not_added') next.lib = '';
    } else {
      next.bingeable = false;
      if (next.sort === 'added' || next.sort === 'watched') next.sort = '';
    }
    setSearchParams(toParams(next), { replace: true });
  };

  const gridActive = state.scope === 'library' || anyFilterActive(state);
  const query = apiQuery(state);

  return (
    <>
      <h1>Browse</h1>
      <FilterBar state={state} genres={genres.data?.genres ?? []} onChange={update} />
      {!gridActive ? (
        <>
          {genres.error && <p className="muted">Genre rows unavailable: {genres.error}</p>}
          {(genres.data?.genres ?? []).map((g) => (
            <LazyGenreRow key={g.key} genre={g} onSeeAll={(key) => update({ genres: [key] })} />
          ))}
        </>
      ) : state.scope === 'library' ? (
        <LibraryGrid query={query} />
      ) : (
        <DiscoverGrid key={`${query}:${revision}`} query={query} refresh={() => setRevision((value) => value + 1)} />
      )}
    </>
  );
}
