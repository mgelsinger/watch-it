# Screenshot capture

The README screenshots show the real built application with a curated sample library. Watched episodes, saved titles, and selected services are illustrative. Title metadata, artwork, and available offers come from live TMDB responses for the US region at capture time. They do not represent the owner's personal library or guarantee current availability.

## Reproduce

Follow the development setup, then run:

```sh
npm run build
npx playwright install chromium
node scripts/screenshots.mjs
```

For the community-launch update, only `pick.png`, `recommendation.png` and `title.png` were replaced. The existing populated library, browse and mobile images were reviewed and retained. The new Pick images use 45 minutes, TV, Light / comedy and the sample Apple TV subscription, with live regional offers. The title image expands Season 1 to show watched checkboxes and the next episode. To reproduce only these captures:

```sh
node scripts/screenshots.mjs --only=pick,recommendation,title
```

The script uses the real Shuffle control to curate a sitcom result without altering the response, ranking or availability. The first suggested title may differ. Screenshots with unchanged entries in `capture.json` retain their earlier capture date; newly captured entries record their own timestamp. The separate interactive demo uses fictional titles and artwork, unlike these live-metadata screenshots.

The script reads only `TMDB_API_KEY` from the process environment or the repository's ignored `.env`. It creates its own temporary database, binds the app to a random localhost port, adds sample titles, and captures desktop and narrow mobile views. It never opens the existing installation, copies its database, or uses its password or OMDb key. Only PNGs and a small capture manifest are written to `docs/images`; temporary application data is removed afterward.

Review the resulting images before committing them. Do not alter the images to invent functionality, ratings, or availability. Live catalog order and artwork can change between captures. The narrow screenshot demonstrates layout in Chromium, not certification on a physical phone.

## Credits

Posters, title metadata, and service logos are provided by TMDB, with watch-provider data from JustWatch through TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. [Provider attribution](ATTRIBUTION.md).
