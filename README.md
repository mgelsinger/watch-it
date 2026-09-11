# watch-it

**Find your next watch. Remember where you left off.**

A personal home for movies and TV, across your streaming services. Find something for tonight, keep a watchlist, and pick up at the next episode.

Run it on your own computer or home server. Your library stays in your installation, with no watch-it account or telemetry. Metadata and streaming availability come from external providers; playback opens on your streaming service.

![watch-it's sample library, with movies and shows, viewing status, posters, and streaming services](docs/images/library.png)

[Get started](#get-started) · [Take a look](#take-a-look) · [Installation help](docs/INSTALL.md) · [Backups and updates](docs/OPERATIONS.md) · [Report a bug](https://github.com/mgelsinger/watch-it/issues)

## What you can do

- **Decide what to watch.** Pick For Me uses your available time, mood, genres, and services. Shuffle, save a suggestion, or choose never to see it again.
- **Browse across services.** Explore movies, TV, Korean dramas, and anime. Search all available sources or stick to your subscriptions, with exclusions for services you do not want.
- **Keep your place.** Track watched episodes, see what is coming next, and separate your Watchlist from Saved for Later.
- **Look closer.** Open a title for cast, seasons, scores, similar titles, and regional watch options. Previewing a title does not add it to your library.
- **Keep your history.** Export and restore your library, progress, ratings, notes, and preferences. Move them to another installation whenever you need to.

## Take a look

### Find something for tonight

Set your time, choose a mood, and decide which services to include.

![A live Pick For Me result with runtime, streaming options, and actions to save or shuffle](docs/images/recommendation.png)

### Explore beyond your watchlist

Browse a full genre catalog, including anime and Korean dramas, then refine it with the filters you care about.

![Anime discovery in watch-it with catalog filters and title posters](docs/images/browse.png)

<details>
<summary>See recommendation filters, episode tracking, and the mobile layout</summary>

![Pick For Me with time, type, mood, and streaming preferences](docs/images/pick.png)

![A sample Severance detail page with watched progress and episode controls](docs/images/title.png)

<img src="docs/images/mobile.png" alt="The sample watch-it library in a narrow mobile browser viewport" width="390">

</details>

Screenshots use a separate sample library and live TMDB artwork. Watch history is illustrative. Availability depends on your region and when you check; screenshots are not a current service listing. [Screenshot details and credits](docs/SCREENSHOTS.md).

## Get started

The current installation path is Docker. You need:

- **[Docker with Compose](https://docs.docker.com/compose/install/).** On Windows, start Docker Desktop and use Linux containers.
- **A [TMDB account and API key](https://www.themoviedb.org/settings/api).** Choose the API Key, not the API Read Access Token. [Step-by-step help](docs/INSTALL.md#2-get-your-tmdb-key).

The verified container platform is **Linux x86-64**, including Docker Desktop on Windows. ARM, Apple Silicon, and other browser/device combinations need further verification. You do not need Node.js or Python for this installation.

**Upgrading?** Use the [upgrade guide](docs/OPERATIONS.md#upgrade-an-existing-installation) to preserve your existing library and prepare a rollback.

1. **Get the project.** [Download the source ZIP](https://github.com/mgelsinger/watch-it/archive/refs/heads/main.zip) and extract it, or clone it:

   ```sh
   git clone https://github.com/mgelsinger/watch-it.git
   cd watch-it
   ```

2. **Open a terminal in the project folder**, alongside `docker-compose.yml`. Copy `.env.example` to `.env`:

   Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   Linux:

   ```sh
   cp .env.example .env
   ```

3. **Open `.env` in a text editor.** Paste your key after `TMDB_API_KEY=` and save. Leave OMDb blank to start; it is optional.

4. **Build and start the app:**

   ```sh
   docker compose up -d --build --wait
   ```

   The first build downloads dependencies. When it finishes, open **[localhost:8300](http://localhost:8300)**.

In **Settings**, test TMDB, choose your country under **Watch-provider region**, and select any streaming services you use. Open **Pick For Me** or **Browse** to find your first title. You can start with an empty library.

[Full installation guide, key setup, and troubleshooting](docs/INSTALL.md). A downloaded release, when available, includes a prebuilt image and its setup files so you can skip the build.

## A few useful answers

**Does watch-it play or download videos?** No. It helps you discover and track titles, then opens watch options for your region. Streaming subscriptions are separate.

**Do I need OMDb?** No. TMDB supplies discovery, posters, and its own ratings. An optional OMDb key adds IMDb, Rotten Tomatoes, and Metacritic scores where available.

**Can I use it on my phone?** The layout adapts to smaller screens. To reach a home-server installation from another device, follow [LAN and HTTPS setup](docs/OPERATIONS.md#first-installation). `localhost` on your phone refers to the phone itself.

**Will it find every show or English dub?** Catalog and regional availability depend on upstream data. English-audio evidence and adaptation links are partial. [How the filters work](docs/CATALOG.md).

**Where is my library?** In the Docker data volume. Rebuilding the app preserves it. Export a profile in Settings and keep a copy outside the installation. [Backups, upgrades, and recovery](docs/OPERATIONS.md).

## Development

TypeScript, React, Vite, Fastify, and SQLite. One Node process serves the built app and API.

Use **Node 22.12 or newer within Node 22**, configure `.env`, and run `npm ci`. Start `npm run dev:server` and `npm run dev:web` in separate terminals, then open http://localhost:5173. Port 8300 must be free for the development API.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

CI checks Windows and Linux builds, browser flows, installation, upgrades, recovery, and the production image. [Verification record](docs/RELEASE_VERIFICATION.md) · [Contribution guide](CONTRIBUTING.md).

## Status and support

Prepared for personal self-installation. Public distribution is being finalized; a code license and private security-reporting channel still need to be selected. See the [public-release preparation record](docs/PUBLIC_READINESS.md).

For ordinary bugs, [open an issue](https://github.com/mgelsinger/watch-it/issues). Include your app version, installation method, and steps to reproduce. [Security reporting](SECURITY.md) · [Data and privacy](docs/PRIVACY.md).

## Credits

<a href="https://www.themoviedb.org/"><img src="web/public/tmdb-logo.svg" alt="TMDB" width="100"></a>

This product uses the TMDB API but is not endorsed or certified by TMDB.

Metadata and artwork come from [TMDB](https://www.themoviedb.org/), with watch-provider data from [JustWatch](https://www.justwatch.com/) through TMDB. Optional ratings come from [OMDb](https://www.omdbapi.com/), and broadcast schedules from [TVmaze](https://www.tvmaze.com/). [Attribution details](docs/ATTRIBUTION.md).
