import { fmtDate } from '../api';

export function MiniScores({ rt, imdb, mc, tmdb }: { rt?: number | null; imdb?: number | null; mc?: number | null; tmdb?: number | null }) {
  const parts: string[] = [];
  if (rt != null) parts.push(`🍅 ${rt}%`);
  if (imdb != null) parts.push(`IMDb ${imdb}`);
  if (mc != null) parts.push(`MC ${mc}`);
  if (tmdb != null) parts.push(`TMDB ${tmdb.toFixed(1)}`);
  if (parts.length === 0) return null;
  return <div className="mini-scores">{parts.map((p) => <span key={p}>{p}</span>)}</div>;
}

/** Full score strip for the detail page, each labeled with source + refresh date. */
export default function Scores({
  rt, imdb, mc, tmdb, ratingsRefreshedAt,
}: {
  rt: number | null; imdb: number | null; mc: number | null; tmdb: number | null; ratingsRefreshedAt: string | null;
}) {
  const omdbNote = ratingsRefreshedAt ? `via OMDb, ${fmtDate(ratingsRefreshedAt)}` : 'via OMDb';
  return (
    <div className="scores">
      <div className={`score ${rt != null ? (rt >= 60 ? 'fresh' : 'rotten') : ''}`}>
        <div className="val">{rt != null ? `${rt >= 60 ? '🍅' : '🦠'} ${rt}%` : '—'}</div>
        <div className="src">Rotten Tomatoes</div>
        <div className="faint">{rt != null ? omdbNote : 'unavailable'}</div>
      </div>
      <div className="score">
        <div className="val">{imdb != null ? imdb.toFixed(1) : '—'}</div>
        <div className="src">IMDb</div>
        <div className="faint">{imdb != null ? omdbNote : 'unavailable'}</div>
      </div>
      <div className="score">
        <div className="val">{mc != null ? mc : '—'}</div>
        <div className="src">Metacritic</div>
        <div className="faint">{mc != null ? omdbNote : 'unavailable'}</div>
      </div>
      <div className="score">
        <div className="val">{tmdb != null ? tmdb.toFixed(1) : '—'}</div>
        <div className="src">TMDB</div>
        <div className="faint">community score</div>
      </div>
    </div>
  );
}
