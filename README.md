# watch-it

watch-it is a single-user, locally hosted tracker and discovery app for TV shows and movies across streaming services, broadcast TV, digital releases, and physical releases.

It helps answer four questions:

- What should I watch?
- Where can I watch it?
- What have I already watched?
- When is the next episode, season, or release arriving?

## Features

- Netflix-style Home, Browse, and recommendation rows
- Discovery-first recommendations from recent releases, currently airing TV, and popular titles
- Regional streaming availability with provider names and logos
- Ratings from TMDB and optional IMDb, Rotten Tomatoes, and Metacritic data through OMDb
- TV seasons, episodes, air dates, runtimes, cast, and release cadence
- Continue Watching, Watchlist availability, upcoming episodes, and viewing history
- Saved for Later bookmarks that do not trigger Watchlist or Continue Watching notifications
- Availability history and arrived or left service events
- Local poster cache for previously viewed images
- Dark and light themes
- One SQLite database, no accounts, no telemetry, and no scraping

## Pick For Me Tonight

Pick For Me does not require an existing Library. It searches current TMDB discovery data and regional watch-provider availability.

Recommendations combine:

- Movies and new series released within the last 30 days
- TV shows with recently airing episodes
- Popular and well-rated titles currently available to watch

All streaming services are searched by default. You can optionally restrict recommendations to the services enabled in Settings.

Available filters include:

- Time available
- Movie, TV show, or either
- Mood and genre
- All services or only your services
- Subscription streaming only or rent and buy offers
- Exclude anything already saved, tracked, or watched

The same title will not be suggested again for seven days after it is displayed.

Each recommendation provides explicit actions:

- Save for Later: bookmark it without notifications
- Add to Watchlist: plan to watch it soon and receive availability updates
- Start Watching: add it to active viewing and Continue Watching
- Already Watched: add it to viewing history
- Shuffle or Not Tonight: move to another recommendation
- Never Suggest: permanently suppress the title from Pick For Me

Selecting the poster or summary opens a read-only detail preview. Previewing a title does not add it to the Library. The detail page provides the same explicit tracking choices and a button to return to the current Pick session.

## Title Details and More Like This

Title pages include:

- Overview, scores, cast, runtime, and genres
- Streaming, free, ad-supported, rental, and purchase offers
- Seasons, episodes, air dates, and watched controls for tracked TV shows
- Availability dates and availability history
- Personal rating and notes for tracked titles
- Watchlist, Watching, Watched, Paused, Dropped, and Saved for Later statuses
- Remove from Watchlist and Remove from Saved for Later actions

The More Like This button loads a responsive carousel of similar titles. The carousel shows the number of cards that fit the browser width and provides previous and next controls. Opening a similar title also uses read-only preview mode and does not add it to the Library.

## Quick Start

1. Get a free [TMDB API key](https://www.themoviedb.org/settings/api). TMDB is required for metadata, posters, discovery, and provider availability.
2. Optionally get a free [OMDb API key](https://www.omdbapi.com/apikey.aspx) for IMDb, Rotten Tomatoes, and Metacritic scores.
3. Copy the example configuration and add the keys:

   ```sh
   cp .env.example .env
   ```

4. Start the app:

   ```sh
   docker compose up -d --build
   ```

5. Open <http://localhost:8300>.

Choosing your streaming services in Settings is optional. Enabled services are prioritized and can be used as a Pick For Me or Browse filter.

Stop the app with:

```sh
docker compose down
```

## Data and Backups

Application data lives in the named Docker volume `watch-it-data`. The SQLite database is stored at `/data/watch-it.db` inside the container.

The data survives container rebuilds and `docker compose down`. A complete backup can be made by copying the SQLite database while the server is stopped. JSON export and import are also available from Settings.

## Development

Install dependencies:

```sh
npm install
```

Run the API and web app in separate terminals:

```sh
npm run dev:server
npm run dev:web
```

- Fastify API: <http://localhost:8300>
- Vite development server: <http://localhost:5173>

Validation commands:

```sh
npm test
npm run typecheck
npm run build
```

The production build serves the compiled web app and API from one Node process.

## Sync Schedule

| Cadence | Work |
|---|---|
| Hourly at :05 | Refresh followed shows airing today or tomorrow and update the TVmaze schedule cache |
| Daily at 04:00 | Refresh active metadata, watch-provider availability, discovery lists, and Browse caches |
| Weekly on Sunday at 04:30 | Refresh OMDb ratings and metadata for ended titles |

Manual refresh and sync health are available in Settings.

## Data Sources and Attribution

- Metadata and images: [TMDB](https://www.themoviedb.org/)
- Watch-provider availability: [JustWatch](https://www.justwatch.com/) through TMDB
- Optional ratings: [OMDb](https://www.omdbapi.com/)
- Broadcast schedule: [TVmaze](https://www.tvmaze.com/)

This product uses the TMDB API but is not endorsed or certified by TMDB. Provider results describe regional availability and do not provide direct Netflix or other service deep links.
