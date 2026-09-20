# Installing and operating watch-it

watch-it is a single-user installation. The release target is Linux containers on x86-64 Linux or Docker Desktop for Windows. Native development uses Node 22.12 or newer within Node 22. ARM builds are not yet certified. There is no shared website or registration service.

## First installation

For prerequisites, getting the key, source ZIP setup, and troubleshooting, start with the [installation guide](INSTALL.md). Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell), keep its defaults for local setup, then run:

```sh
docker compose up -d --build
```

Open http://localhost:8300, visit Settings > API keys, paste your TMDB API key and choose Verify and save TMDB key. It works immediately. Choose a region, then select subscriptions in Settings or Pick For Me. These services are separate from per-search exclusions. To apply a changed `.env`, run `docker compose up -d --no-build` from the installation folder. A container restart alone does not apply environment changes; your library stays intact.

The Docker port binds to `127.0.0.1` by default. Native startup also defaults to localhost through `HOST`. To allow trusted LAN clients, set `BIND_ADDRESS` to the host's LAN address. Set `WATCH_IT_PASSWORD` to a unique password of at least 12 characters if other people can reach the installation. Require a password and HTTPS before exposing it to untrusted networks. `WATCH_IT_SECURE_COOKIE=true` is for HTTPS only. Keep forwarded headers untrusted unless an exact proxy address or CIDR is configured in `WATCH_IT_TRUSTED_PROXIES`.

The runtime runs as UID/GID 1000 with restricted data permissions. It contains Node and the required libraries, without a shell or package manager. Use `docker compose logs --tail 100` and the Node maintenance commands below for diagnostics.

## Install a downloaded release

Download the versioned installation ZIP and `checksums.txt` from the release, verify the ZIP checksum, and extract it. The ZIP contains the tested image archive, Compose configuration pinned to that version, a blank `.env.example`, `START_HERE.md`, and the operating guides. It includes no source-build requirement. Copy `.env.example` to `.env`, then use the version shown in that release's notes. Enter your key in Settings after startup. For version 1.0.0:

```sh
docker load --input watch-it-1.0.0-linux-amd64.tar
```

The included `.env.example` already selects `WATCH_IT_IMAGE=watch-it:1.0.0`; run `docker compose up -d --no-build --wait`. Compare the ZIP's SHA-256 with `checksums.txt` before extracting it (`Get-FileHash -Algorithm SHA256` in PowerShell, `sha256sum` on Linux). A release ZIP is created from the image that passed the Docker checks, with its image ID recorded separately in `image-id.txt`. No public registry is required. [Detailed steps](INSTALL.md#install-a-prebuilt-release).

## Upgrade an existing installation

1. Export a profile through Settings and keep a copy outside the Docker volume. Keep `.env` separately. App-entered keys are in `/data/credentials.json`; keep a private copy or re-enter keys after recovery. Profile exports and SQLite snapshots omit this file. Full volume backups include it and must be kept private. Older images use environment keys only, so supply the key in `.env` if rolling back to one.
2. Record your current image ID with `docker inspect watch-it --format '{{.Image}}'`. Tag that exact image as `watch-it:before-upgrade` with `docker image tag IMAGE_ID watch-it:before-upgrade` before replacing the working image. Do not remove it until recovery has been verified.
3. Obtain the new source/image. Build it with `docker compose build --pull` if installing from source. Building does not restart the running installation.
4. Stop the application with `docker compose stop watch-it`. Keep the same Compose project name and named data volume.
5. If upgrading from the old root runtime, repair ownership on **this installation's volume**:

   ```sh
   docker compose run --rm --no-deps --user 0 --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE watch-it node server/dist/maintenance.js fix-permissions
   ```

   This helper is restricted to `/data` and skips symbolic links. It sets UID/GID 1000, directory mode 700, and file mode 600. The three capabilities apply only to this stopped-app ownership repair; the normal service drops all capabilities. Do not mount unrelated host directories at `/data` for this operation.
6. Create a consistent pre-upgrade database snapshot using the new image's helper, before starting its server:

   ```sh
   docker compose run --rm --no-deps watch-it node server/dist/maintenance.js snapshot
   ```

   Record the resulting `pre-upgrade-...db` filename under `/data/snapshots`. The helper uses SQLite's backup API, including committed WAL state. Never copy only `watch-it.db` while the application is writing. Snapshots contain session state and personal data; protect them as private backups.
7. Start the new image with `docker compose up -d --no-build`. Check health, your library, watched progress, notes, services, and exclusions. Migrations run transactionally; prior migration files are preserved.

## Restore or roll back

For portable profile recovery, choose a JSON backup in Settings, review the preview, then choose merge or replace. Malformed files are rejected before changes. A complete safety copy is written before restore. Wait for an active refresh to finish first. Up to five pre-restore safety copies are retained under `/data/backups`, for at most 30 days. After restoring a profile, choose Refresh all to retrieve title details; personal progress is immediately available.

For a failed application upgrade, stop the app. Use the new image's helper to restore the matching pre-upgrade snapshot:

```sh
docker compose stop watch-it
docker compose run --rm --no-deps watch-it node server/dist/maintenance.js restore-snapshot pre-upgrade-2026-09-10T00-00-00-000Z.db
```

Replace the example filename with the snapshot created for that upgrade. The helper validates integrity and preserves the replaced database and WAL files in a `before-rollback-...` directory. Run it only while the server is stopped. Set `WATCH_IT_IMAGE=watch-it:before-upgrade`, then start with `docker compose up -d --no-build`. Use the old image with its matching snapshot; an older binary is not guaranteed to understand a newer schema.

If a disk/permission error interrupts filesystem replacement, leave the app stopped. The original files are either in `/data` or the `before-rollback-...` directory. Recover the complete matching database/WAL set before restarting. Do not delete the recovery directory to fix an error.

## Routine maintenance

The daily refresh prunes cached images older than `IMAGE_CACHE_DAYS` or beyond `IMAGE_CACHE_MB` (defaults: 90 days, 256 MiB; maximum age: 90 days). It only removes recognized image-cache files, skipping symbolic links and other directories. Previously viewed images may need downloading again after eviction.

Set `BACKUP_DIR=/data/scheduled-backups` to enable a daily profile backup. `BACKUP_RETENTION` defaults to 7 completed scheduled files. Manual exports are unaffected. Settings shows the current process's last backup success or failure and links to a local, sanitized diagnostics report. The actual backup files persist across restarts. Files within the same Docker volume do not protect against loss of that volume; copy important backups to separate storage.

The API, logs, and SQLite data are private installation resources. Optional login protects all data routes. Password changes or disabling login revoke existing sessions when the app restarts. Use `docker compose stop` or `down` for graceful shutdown. The default Compose configuration grants 30 seconds to finish/cancel work and close SQLite.

## Support and uninstall

### Optional HTTPS proxy

`docker-compose.https.yml` and `deploy/Caddyfile` provide an opt-in Caddy proxy. Set `WATCH_IT_DOMAIN` to a domain you control, `WATCH_IT_PASSWORD` to a unique password, and `HTTPS_BIND_ADDRESS` to the intended host interface. Keep the application `BIND_ADDRESS=127.0.0.1`. Start with `docker compose -f docker-compose.yml -f docker-compose.https.yml up -d`. The override enables Secure cookies and trusts only the proxy at `172.30.83.2`; if its subnet conflicts with another network, change all three IP/subnet settings together. Use the HTTPS URL when signing in.

Caddy needs domain validation and inbound access appropriate to the certificate you request. Public DNS, router forwarding and a public certificate are operator setup, not enabled by installing watch-it. The defaults bind proxy ports to localhost. Do not use a self-signed test-certificate bypass for normal browsing. The automated proxy check uses an isolated loopback TLS fixture, verifies Secure cookies and protected routes, and exercises the application's login throttle through the proxy. Ordinary APIs retain their smaller body limits; only backup inspection/restoration accepts up to 50 MiB. The upstream client also bounds queued work and responds with errors when capacity is exhausted.

### Reports and removal

Report ordinary bugs through the [repository issue tracker](https://github.com/mgelsinger/watch-it/issues). Include app version, platform, steps to reproduce, region, and title/provider identity if relevant. Review diagnostics before sharing. Do not attach `.env`, cookies, database snapshots, profile backups, or private notes. See [SECURITY.md](../SECURITY.md) for security reporting status and [PRIVACY.md](PRIVACY.md) for data flows.

`docker compose down` stops and removes the container but keeps the named volume. Keep that volume and your external backups if you might reinstall. Do not use `down -v` during an update or routine uninstall; it deletes the installation's data volume. Removing the app does not delete your accounts or API keys at upstream providers.

## Provider data and personal history

Provider descriptions, artwork, cast, ratings, release dates and availability are temporary data. Saved title IDs, lists, notes, personal ratings, episode identities and watched dates are your history and do not expire. Startup after a long offline period and daily maintenance remove provider metadata older than 90 days; API responses and event payloads expire after 30 days. Images expire after at most 90 days, including at read time. Cached responses older than 30 days cannot be served as an offline fallback.

Each season, episode and cast record has its own fetch date. A failed season refresh cannot make old episode descriptions appear fresh. Existing installations lack those child fetch dates, so their descriptions are cleared once during the upgrade and downloaded again on Refresh all. Episode numbers and watched dates remain intact. If TMDB is unreachable or the key is missing, a title may display its TMDB identity until a successful refresh. Do not reset your library to resolve that condition.

New version 3 profile exports contain personal data and identity references, without provider descriptions, posters, cast, availability or events. Version 1 and 2 imports are still supported, but their provider content is discarded; merge keeps any current local metadata. Replace restores the personal profile, then Refresh all downloads metadata again. Keys remain separate. Protect exports because notes and viewing history are personal.

App-created SQLite snapshots, rollback files, pre-restore backups and scheduled backups are removed after 30 days at startup/daily maintenance; count limits also apply to profile backups. Only recognized filenames in the app's managed directories qualify, and symlinks are skipped. Keep durable personal history in a version 3 export outside these directories. Old full-volume backups and manually copied version 1/2 exports still contain provider content: replace them with a version 3 export or remove that content within the provider's permitted retention period. Watch It cannot clean external copies or perform maintenance while stopped. If provider access terminates, preserve a version 3 export and purge the installation's provider data, images and provider-containing backups in accordance with the agreement. See [provider requirements](PROVIDERS.md).

The Linux launcher disables inherited DNS search suffixes because the app uses fully qualified provider hosts. This mitigates the documented glibc resolver issue. Keep the default launcher when customizing the image; local short hostnames are not a supported provider configuration.
