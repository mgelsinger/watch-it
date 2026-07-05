import { Link } from 'react-router-dom';
import { api, countdown, fmtDate, useApi } from '../api';
import type { Card, HomeData, TheaterCard } from '../types';
import Row from '../components/Row';
import PosterCard from '../components/PosterCard';

function cardScores(c: Card) {
  return { rt: c.rt_score, imdb: c.imdb_rating, mc: c.metacritic, tmdb: c.tmdb_rating };
}

export default function Home() {
  const { data, loading, error, reload } = useApi<HomeData>('/api/home');

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="muted">Home failed to load: {error}</p>;
  if (!data) return null;

  const totalTracked =
    data.continue_watching.length + data.wishlist_available.length + data.returning_soon.length +
    data.recently_watched.length + data.new_tonight.length;

  const addTheaterMovie = async (m: TheaterCard) => {
    await api('/api/titles', { json: { tmdb_id: m.tmdb_id, media_type: 'movie', status: 'wishlist' } });
    reload();
  };

  return (
    <>
      {totalTracked === 0 && (
        <div className="empty">
          <h3>Welcome to watch-it</h3>
          <p>
            Nothing tracked yet. Start by checking your API keys in <Link to="/settings"><u>Settings</u></Link>, pick
            your streaming services there, then use the search box above to add your first show or movie.
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

      <Row title="Wishlist — Available Now" children={data.wishlist_available.map((c) => (
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

      <Row title="Now Streaming" children={data.now_streaming.map((c) => (
        <PosterCard key={c.id} linkId={c.id} name={c.name} year={c.year} posterPath={c.poster_path}
          scores={cardScores(c)} offers={c.my_offers} />
      ))} />

      <Row title="In Theaters" empty={undefined} children={data.in_theaters.map((m) => (
        <PosterCard
          key={m.tmdb_id}
          linkId={m.library_id}
          name={m.name}
          posterPath={m.poster_path}
          sub={m.release_date ? fmtDate(m.release_date) : undefined}
          scores={{ tmdb: m.tmdb_rating }}
          onAdd={m.library_id ? undefined : () => void addTheaterMovie(m)}
        />
      ))} />

      <Row title="Coming to Theaters" children={data.coming_soon.map((m) => (
        <PosterCard
          key={m.tmdb_id}
          linkId={m.library_id}
          name={m.name}
          posterPath={m.poster_path}
          sub={m.release_date ? fmtDate(m.release_date) : undefined}
          scores={{ tmdb: m.tmdb_rating }}
          onAdd={m.library_id ? undefined : () => void addTheaterMovie(m)}
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
