# Screenshot capture

The README screenshots show the real built application with a curated sample library. Watched episodes, saved titles, and selected services are illustrative. Title metadata, artwork, and available offers come from live TMDB responses for the US region at capture time. They do not represent the owner's personal library or guarantee current availability.

## Reproduce

Follow the development setup, then run:

```sh
npm run build
npx playwright install chromium
node scripts/screenshots.mjs
```

The script reads only `TMDB_API_KEY` from the process environment or the repository's ignored `.env`. It creates its own temporary database, binds the app to a random localhost port, adds sample titles, and captures desktop and narrow mobile views. It never opens the existing installation, copies its database, or uses its password or OMDb key. Only PNGs and a small capture manifest are written to `docs/images`; temporary application data is removed afterward.

Review the resulting images before committing them. Do not alter the images to invent functionality, ratings, or availability. Live catalog order and artwork can change between captures. The narrow screenshot demonstrates layout in Chromium, not certification on a physical phone.

## Credits

Posters, title metadata, and service logos are provided by TMDB, with watch-provider data from JustWatch through TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. [Provider attribution](ATTRIBUTION.md).
