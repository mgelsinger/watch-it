import { useNavigate } from 'react-router-dom';
import { img } from '../api';
import { MiniScores } from './Scores';

export interface PosterCardProps {
  linkId?: number | null; // library title id to navigate to
  name: string;
  year?: number | null;
  posterPath?: string | null;
  sub?: string | null; // one-line context under the name
  flag?: string | null; // corner badge, e.g. "S2E4 tonight" (top-left)
  typeBadge?: string | null; // "Movie" / "TV" chip (top-left; don't combine with flag)
  statusBadge?: string | null; // library status chip (top-right; only when already added)
  scores?: { rt?: number | null; imdb?: number | null; mc?: number | null; tmdb?: number | null };
  offers?: { provider_name: string }[]; // where it streams on my services
  onAdd?: () => void; // shown for titles not yet in the library
}

export default function PosterCard(p: PosterCardProps) {
  const navigate = useNavigate();
  const poster = img(p.posterPath, 'w342');
  const open = () => {
    if (p.linkId) navigate(`/title/${p.linkId}`);
    else if (p.onAdd) p.onAdd();
  };

  return (
    <div
      className="card"
      data-card
      tabIndex={0}
      role="button"
      aria-label={p.name}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      {poster ? <img className="poster" src={poster} alt="" loading="lazy" /> : <div className="noposter">{p.name}</div>}
      {p.flag && <span className="flag">{p.flag}</span>}
      {!p.flag && p.typeBadge && <span className="typechip">{p.typeBadge}</span>}
      {p.statusBadge && <span className="statuschip">{p.statusBadge}</span>}
      {p.onAdd && !p.linkId && (
        <button
          className="addbtn primary"
          title="Add to library"
          onClick={(e) => {
            e.stopPropagation();
            p.onAdd!();
          }}
        >
          +
        </button>
      )}
      <div className="card-body">
        <div className="card-name">{p.name}</div>
        <div className="card-sub">{p.sub ?? p.year ?? ''}</div>
      </div>
      <div className="quick">
        <MiniScores rt={p.scores?.rt} imdb={p.scores?.imdb} mc={p.scores?.mc} tmdb={p.scores?.tmdb} />
        {p.offers && p.offers.length > 0 && (
          <div className="faint" style={{ marginTop: 4 }}>
            On {p.offers.map((o) => o.provider_name).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
