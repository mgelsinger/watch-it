# watch-it

A single-user, locally hosted media tracker for TV shows and movies across streaming services,
broadcast TV, and theaters. It answers four questions instantly: **what should I watch, where is
it, what have I already watched, and when does the next thing arrive.**

- Netflix-style browsing, data-dense underneath (scores, air dates, cadence, availability history)
- All state in one SQLite file — backup = copy one file
- Dark mode by default, light-mode toggle
- No accounts, no telemetry, no scraping — official free APIs only (TMDB, OMDb, TVmaze)
- Works offline for everything already cached (including posters, via a local image cache)

## Quick start

1. Get a free [TMDB API key](https://www.themoviedb.org/settings/api) (required) and optionally a
   free [OMDb key](https://www.omdbapi.com/apikey.aspx) (enables Rotten Tomatoes / IMDb /
   Metacritic scores).
2. Configure:

   ```sh
   cp .env.example .env
   # edit .env and fill in TMDB_API_KEY (and OMDB_API_KEY if you have one)
   ```

3. Run:

   ```sh
   docker compose up -d
   ```

4. Open <http://localhost:8300>, check Settings → API keys, pick your streaming services, and add
   your first title via the search box.

Data lives on the named volume `watch-it-data` (SQLite at `/data/watch-it.db`) and survives
`docker compose down && docker compose up -d`. The container restarts automatically after reboots.

## Development

```sh
npm install
npm run dev:server   # Fastify API on :8300 (tsx watch)
npm run dev:web      # Vite dev server on :5173, proxies /api and /img
```

`npm run build` builds both workspaces; `node server/dist/index.js` then serves the built frontend
and the API from one process.

## Sync schedule

| Cadence | What |
|---|---|
| Hourly (:05) | Followed shows with episodes airing today/tomorrow; TVmaze schedule cache |
| Daily (04:00) | Metadata + seasons for non-ended titles; watch providers for everything (diffed into arrived/left events); theater lists |
| Weekly (Sun 04:30) | OMDb ratings refresh (oldest first, quota-aware); metadata for ended titles |

Manual refresh: the ⟳ button in the top bar (global) or on any title page. Sync history and errors
are visible in Settings → Sync health.

## Attribution

Metadata and images from [TMDB](https://www.themoviedb.org/) (this product uses the TMDB API but is
not endorsed or certified by TMDB). Watch-provider data by [JustWatch](https://www.justwatch.com/).
Ratings via [OMDb](https://www.omdbapi.com/); Rotten Tomatoes scores may lag the live site.
Broadcast schedule by [TVmaze](https://www.tvmaze.com/).
