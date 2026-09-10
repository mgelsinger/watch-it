# watch-it

**Find your next watch. Remember where you left off.**

watch-it brings movie and TV discovery, streaming availability, and your viewing history into one place. Browse across services, get a recommendation for tonight, and keep track of shows without juggling separate watchlists.

You run it yourself. One installation, one personal library, one SQLite database. No hosted account or telemetry. watch-it helps you find and track titles; playback happens on your streaming service.

[Install](#install) · [Catalog and filters](#catalog-and-filters) · [Backups and updates](#backups-and-updates) · [Development](#development)

## What you can do

- **Pick something for tonight.** Get recommendations by mood, genre, available time, and services. Save a title for later, shuffle, or tell the app never to suggest it again.
- **Browse across services.** Explore movies, TV, Korean dramas, and anime. Search broadly, use only your subscriptions, or exclude particular sources.
- **See where to watch.** Check regional subscription, free, rental, and purchase offers, then open watch options. Availability checks show when information is dated or incomplete.
- **Keep your place.** Track watched episodes, continue watching, and see upcoming air dates. Keep a Watchlist, a quieter Saved for Later list, ratings, and personal notes.
- **Explore a title.** Find cast, scores, seasons, release dates, and similar shows or movies. Opening a preview does not add it to your library.
- **Keep your data.** Export and restore your profile, enable scheduled backups, and move your installation between machines.

## Install

You need **Docker with Compose** and a [TMDB API v3 key](https://www.themoviedb.org/settings/api). The tested container platform is Linux x86-64, including Docker Desktop on Windows using Linux containers. ARM builds are not yet verified.

**Already running watch-it?** Follow the [upgrade instructions](docs/OPERATIONS.md#upgrade-an-existing-installation) first. Older installations need a volume ownership update and a pre-upgrade snapshot.

1. Clone the repository:

   ```sh
   git clone https://github.com/mgelsinger/watch-it.git
   cd watch-it
   ```

2. Copy `.env.example` to `.env`:

   ```sh
   cp .env.example .env
   ```

   In PowerShell, use `Copy-Item .env.example .env`.

3. Edit `.env` and set `TMDB_API_KEY`. An [OMDb key](https://www.omdbapi.com/apikey.aspx) is optional and adds IMDb, Rotten Tomatoes, and Metacritic scores where available.

4. Build and start:

   ```sh
   docker compose up -d --build
   ```

Open **<http://localhost:8300>**. In **Settings**, test your key, choose your region, and optionally select your streaming services. You can start discovering titles with an empty library.

The app binds to localhost by default and runs as a non-root user. For access from other devices, see [LAN and HTTPS setup](docs/OPERATIONS.md). An optional installation password is configured with `WATCH_IT_PASSWORD`; use at least 12 characters. Require a password and HTTPS before exposing the app to untrusted networks.

## Catalog and filters

### Korean dramas, anime, and English versions

Choose **Korean Dramas** or **Anime** under Genres in Browse, or Mood in Pick For Me. Korean Dramas matches Korean-language TV dramas; Anime matches Japanese-language animated movies and TV. Searches use TMDB's matching catalog with pagination across services, including Netflix, Crunchyroll, and other providers represented in your region.

Two optional controls help when you want an English version:

| Option | What it does |
|---|---|
| **English audio preferred** | Prioritizes English-original titles and dubs with recorded evidence. Titles with unknown audio remain eligible. Browse prioritizes within each loaded batch. |
| **Include American remakes/adaptations** | Adds specifically linked English-language adaptations of Korean dramas or anime, including live-action adaptations, while respecting the other filters. |

Genre discovery is independent of the smaller audio-evidence and adaptation lists. Those lists supplement results; they do not define the genre catalog. Audio labels include dated sources where available. Confirm the English track, season, and episode on the service you use.

### Leave out services you do not want

Use **Exclude services** in Browse or Pick For Me. Search for a source and check it to exclude it. Channel variants, such as Crunchyroll Amazon Channel, are separate choices.

A title still qualifies if an included service carries it. Excluding Crunchyroll, for example, does not remove a show that is also available on Netflix. Exclusions also work alongside your selected subscriptions. **Clear exclusions** brings those sources back.

Browse keeps filters in its URL so you can bookmark a search. Pick For Me remembers preferences when you request a recommendation and includes them in profile backups.

**Coverage has limits.** Availability depends on your region and upstream data, and may be cached or incomplete. watch-it does not scrape streaming apps or guarantee every title, service, dub, or adaptation. Watch options lead to TMDB's regional watch page, where you can follow available service links.

## Backups and updates

Your library lives in the Docker data volume, with SQLite at `/data/watch-it.db`. It survives container rebuilds and `docker compose down`.

In **Settings**, export a `.watchit.json` profile to a location you control. It includes your library, watched progress, ratings, notes, service preferences, and recommendation history. Credentials and login sessions are excluded. Restore supports merge or replace, validates the file first, and creates a safety copy before changing your profile.

For daily profile backups, set `BACKUP_DIR=/data/scheduled-backups` in `.env`; the default retention is seven completed backups. Keep another copy outside the Docker volume to protect against losing that volume. Cached poster files are pruned automatically by age and size.

Use the [operations guide](docs/OPERATIONS.md) for updates, ownership changes, database snapshots, rollback, backup retention, and optional HTTPS. Keep your data volume during updates; `docker compose down -v` deletes it.

## Development

The app uses **TypeScript, React, Vite, Fastify, and SQLite**. A production build serves the web app and API from one Node process.

Use **Node 22.12 or newer within Node 22**. Configure `.env` as above, then install the locked dependencies:

```sh
npm ci
```

Run these in separate terminals:

```sh
npm run dev:server
npm run dev:web
```

Open <http://localhost:5173>. Vite proxies API requests to port 8300, which must be free for the development server.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

CI checks Windows and Linux builds, server and browser regressions, dependency audits, and the production image's installation, upgrade, restore, rollback, and HTTPS behavior. Live provider checks run separately. See the [verification record](docs/RELEASE_VERIFICATION.md) and [dependency review](docs/DEPENDENCY_REVIEW.md) for the tested candidate and remaining platform findings.

## Support and project status

For bugs, [open an issue](https://github.com/mgelsinger/watch-it/issues) with your app version, platform, and steps to reproduce. Include the region and title when availability is involved. Review reports before sharing and leave out keys, passwords, backups, and private notes. See [SECURITY.md](SECURITY.md) for security-reporting status and [data privacy](docs/PRIVACY.md) for what stays local and what goes to providers.

This repository is prepared for self-installation from source. Packaged releases remain gated on the owner's code-license and private security-contact decisions, followed by the release checks. No repository license has been selected yet. Implementation status is tracked in the [release plan](docs/RELEASE_PLAN.md).

## Credits

<a href="https://www.themoviedb.org/"><img src="web/public/tmdb-logo.svg" alt="TMDB" width="100"></a>

This product uses the TMDB API but is not endorsed or certified by TMDB.

Metadata and artwork come from [TMDB](https://www.themoviedb.org/); watch-provider availability is supplied by [JustWatch](https://www.justwatch.com/) through TMDB. Optional ratings come from [OMDb](https://www.omdbapi.com/), and broadcast schedules come from [TVmaze](https://www.tvmaze.com/). See [attribution details](docs/ATTRIBUTION.md).
