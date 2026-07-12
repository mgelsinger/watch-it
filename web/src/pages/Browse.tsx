import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtDate, useApi } from '../api';
import type { BrowseCard, BrowseGenre, BrowseGridPage, TitleDetail } from '../types';
import FilterBar, { DEFAULT_STATE, anyFilterActive, type BrowseState } from '../components/FilterBar';
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
    status: pick('status', ['returning', 'ended', 'canceled'] as const, '' as const),
    lib: pick('lib', ['not_added', 'saved', 'wishlist', 'watching', 'watched', 'dropped'] as const, '' as const),
    ymin: sp.get('ymin') ?? '',
    ymax: sp.get('ymax') ?? '',
    rating: pick('rating', ['6', '7', '8'] as const, '' as const),
    bingeable: sp.get('bingeable') === '1',
    sort: pick('sort', ['newest', 'rating', 'popular', 'az', 'added', 'watched'] as const, '' as const),
  };
}

function toParams(s: BrowseState): URLSearchParams {
  const sp = new URLSearchParams();
  if (s.scope !== 'discover') sp.set('scope', s.scope);
  if (s.type !== 'both') sp.set('type', s.type);
  if (s.genres.length) sp.set('genres', s.genres.join(','));
  if (s.watch !== 'any') sp.set('watch', s.watch);
  if (s.status) sp.set('status', s.status);
  if (s.lib) sp.set('lib', s.lib);
  if (s.ymin) sp.set('ymin', s.ymin);
  if (s.ymax) sp.set('ymax', s.ymax);
  if (s.rating) sp.set('rating', s.rating);
  if (s.bingeable) sp.set('bingeable', '1');
  if (s.sort) sp.set('sort', s.sort);
  return sp;
}

/** Server-side query string for /api/browse/discover and /api/browse/library. */
function apiQuery(s: BrowseState): string {
  const sp = new URLSearchParams();
  sp.set('type', s.type);
  if (s.genres.length) sp.set('genres', s.genres.join(','));
  if (s.watch !== 'any') sp.set('watch', s.watch);
  if (s.status) sp.set('status', s.status);
  if (s.lib) sp.set('library', s.lib);
  if (s.ymin) sp.set('year_min', s.ymin);
  if (s.ymax) sp.set('year_max', s.ymax);
  if (s.rating) sp.set('rating', s.rating);
  if (s.bingeable) sp.set('bingeable', '1');
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

  const { data, setData } = useApi<{ items: BrowseCard[]; stale: boolean }>(
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
      {!data ? (
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

function DiscoverGrid({ query }: { query: string }) {
  const [items, setItems] = useState<BrowseCard[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setItems([]);
    setPage(0);
    setTotalPages(1);
    setStale(false);
    setError(null);
  }, [query]);

  const loadNext = useCallback(async () => {
    const next = page + 1;
    if (loading || next > totalPages) return;
    setLoading(true);
    try {
      const r = await api<BrowseGridPage>(`/api/browse/discover?${query}&page=${next}`);
      setItems((prev) => {
        const seen = new Set(prev.map((c) => `${c.media_type}:${c.tmdb_id}`));
        return [...prev, ...r.items.filter((c) => !seen.has(`${c.media_type}:${c.tmdb_id}`))];
      });
      setPage(r.page);
      setTotalPages(r.total_pages || 1);
      setStale((s) => s || r.stale);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, page, totalPages, loading]);

  useEffect(() => {
    if (page === 0 && !loading) void loadNext();
  }, [page, loading, loadNext]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadNext();
      },
      { rootMargin: '600px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadNext]);

  const add = useAddToWishlist((c) => setItems((prev) => patchList(prev, c)));

  return (
    <>
      {stale && <div className="stale-note">TMDB is unreachable - showing cached results, which may be out of date.</div>}
      {error && items.length === 0 && <p className="muted">{error}</p>}
      <div className="grid">
        {items.map((c) => (
          <BrowseCardView key={`${c.media_type}:${c.tmdb_id}`} c={c} onAdd={add} />
        ))}
      </div>
      {items.length === 0 && !loading && !error && <p className="muted">No results for this filter combination.</p>}
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
        <DiscoverGrid query={query} />
      )}
    </>
  );
}
