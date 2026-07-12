import { Link } from 'react-router-dom';
import { api, countdown, fmtDate, useApi } from '../api';
import type { Card, DiscoveryCard, HomeData } from '../types';
import Row from '../components/Row';
import PosterCard from '../components/PosterCard';

function cardScores(c: Card) {
  return { rt: c.rt_score, imdb: c.imdb_rating, mc: c.metacritic, tmdb: c.tmdb_rating };
}

function discSub(c: DiscoveryCard): string | undefined {
  const parts: string[] = [];
  if (c.digital_date) parts.push(`Digital ${fmtDate(c.digital_date)}`);
  if (c.physical_date) parts.push(`Blu-ray ${fmtDate(c.physical_date)}`);
  if (parts.length === 0 && c.date) parts.push(fmtDate(c.date));
  return parts.join(' · ') || undefined;
}

export default function Home() {
  const { data, loading, error, reload } = useApi<HomeData>('/api/home');

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="muted">Home failed to load: {error}</p>;
  if (!data) return null;

  const totalTracked =
    data.continue_watching.length + data.wishlist_available.length + data.returning_soon.length +
    data.saved_for_later.length + data.recently_watched.length + data.new_tonight.length;

  const addToWishlist = async (c: DiscoveryCard) => {
    await api('/api/titles', { json: { tmdb_id: c.tmdb_id, media_type: c.media_type, status: 'wishlist' } });
    reload();
  };

  return (
    <>
      <Link to="/pick" className="pick-cta">
        Pick For Me Tonight
        <span className="pick-cta-sub">Fresh releases and current shows on your services, picked for tonight.</span>
      </Link>

      {totalTracked === 0 && (
        <div className="empty">
          <h3>Welcome to watch-it</h3>
          <p>
            Nothing tracked yet. Check your API keys in <Link to="/settings"><u>Settings</u></Link>, choose your
            streaming services, then get a recommendation here or search for a title to save.
          </p>
        </div>
      )}

      <Row title="Continue Watching" children={data.continue_watching.map((c) => (
        <PosterCard
          key={c.id}
          linkId={c.id}
          name={c.name}
          year={c.year}
          posterPath={c.poster_path}
          sub={`Next: S${c.next_season}E${c.next_episode}${c.next_episode_name ? ` · ${c.next_episode_name}` : ''}`}
          scores={cardScores(c)}
          offers={c.my_offers}
        />
      ))} />

      <Row title="New Tonight" children={data.new_tonight.map((c) => (
        <PosterCard
          key={c.id}
          linkId={c.id}
          name={c.name}
          year={c.year}
          posterPath={c.poster_path}
          flag={`S${c.tonight_season}E${c.tonight_episode} tonight`}
          scores={cardScores(c)}
          offers={c.my_offers}
        />
      ))} />

      <Row title="Returning Soon" children={data.returning_soon.map((c) => (
        <PosterCard
          key={c.id}
          linkId={c.id}
          name={c.name}
          year={c.year}
          posterPath={c.poster_path}
          sub={`S${c.next_season}E${c.next_episode} ${countdown(c.next_air_date)} (${fmtDate(c.next_air_date)})`}
          scores={cardScores(c)}
          offers={c.my_offers}
        />
      ))} />

      <Row title="Watchlist - Available Now" children={data.wishlist_available.map((c) => (
        <PosterCard
          key={c.id}
          linkId={c.id}
          name={c.name}
          year={c.year}
          posterPath={c.poster_path}
          sub={c.my_offers?.length ? `On ${c.my_offers.map((o) => o.provider_name).join(', ')}` : undefined}
          scores={cardScores(c)}
          offers={c.my_offers}
        />
      ))} />

      <Row title="Saved for Later" children={data.saved_for_later.map((c) => (
        <PosterCard
          key={c.id}
          linkId={c.id}
          name={c.name}
          year={c.year}
          posterPath={c.poster_path}
          scores={cardScores(c)}
          offers={c.my_offers}
        />
      ))} />

      <Row title="Now Streaming" children={data.now_streaming.map((c) => (
        <PosterCard key={c.id} linkId={c.id} name={c.name} year={c.year} posterPath={c.poster_path}
          scores={cardScores(c)} offers={c.my_offers} />
      ))} />

      <Row title="New on Your Services" children={data.new_on_services.map((c) => (
        <PosterCard
          key={`${c.media_type}:${c.tmdb_id}`}
          linkId={c.library_id}
          name={c.name}
          posterPath={c.poster_path}
          sub={c.date ? fmtDate(c.date) : undefined}
          flag={c.new_season ? 'New season' : undefined}
          scores={{ tmdb: c.tmdb_rating }}
          offers={c.offers}
          onAdd={c.library_id ? undefined : () => void addToWishlist(c)}
        />
      ))} />

      <Row title="New to Blu-ray & Digital" children={data.new_disc_digital.map((c) => (
        <PosterCard
          key={`${c.media_type}:${c.tmdb_id}`}
          linkId={c.library_id}
          name={c.name}
          posterPath={c.poster_path}
          sub={discSub(c)}
          scores={{ tmdb: c.tmdb_rating }}
          offers={c.offers}
          onAdd={c.library_id ? undefined : () => void addToWishlist(c)}
        />
      ))} />

      <Row title="Recently Watched" children={data.recently_watched.map((c) => (
        <PosterCard key={c.id} linkId={c.id} name={c.name} year={c.year} posterPath={c.poster_path}
          sub={c.watched_at ? `Watched ${fmtDate(c.watched_at)}` : undefined}
          scores={cardScores(c)} offers={c.my_offers} />
      ))} />
    </>
  );
}
