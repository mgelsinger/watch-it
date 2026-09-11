# Install watch-it

Start with one computer and open watch-it in its browser. You can configure access from other devices afterward.

## 1. Install Docker

- **Windows:** install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/), complete its setup, and leave it running. Use Linux containers.
- **Linux x86-64:** install [Docker Engine](https://docs.docker.com/engine/install/) and the [Compose plugin](https://docs.docker.com/compose/install/linux/).

Open PowerShell on Windows or a terminal on Linux and check:

```sh
docker version
docker compose version
```

`docker version` should show both a client and a server. If the server cannot be reached, start Docker before continuing. The tested target is Linux x86-64 containers. ARM and Apple Silicon are not yet verified.

## 2. Get your TMDB key

1. Create or sign in to your [TMDB account](https://www.themoviedb.org/).
2. Open your [API settings](https://www.themoviedb.org/settings/api) and follow TMDB's API access application if you do not already have access. Describe your actual personal use and follow the terms presented there.
3. Copy the **API Key**. watch-it uses the key passed as `api_key`; the separately listed **API Read Access Token** is not the value this application expects. [TMDB authentication documentation](https://developer.themoviedb.org/docs/authentication-application).

You do not enter your TMDB password in watch-it. Keep the key private. An OMDb key is optional and can be added later.

## 3. Download and configure

For a source installation, [download the source ZIP](https://github.com/mgelsinger/watch-it/archive/refs/heads/main.zip) and extract it. Open the resulting folder containing `docker-compose.yml`, `Dockerfile`, and `.env.example`. Git users can instead clone `https://github.com/mgelsinger/watch-it.git`.

On Windows, right-click inside that folder and choose **Open in Terminal**. If that option is unavailable, open PowerShell and use `cd` to enter the folder. On Linux, open a terminal there.

Copy the configuration template once. If `.env` already exists, edit it instead of overwriting it.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
```

Linux:

```sh
cp .env.example .env
```

Open `.env` in your preferred text editor. Set:

```dotenv
TMDB_API_KEY=paste_your_api_key_here
```

Replace the example text with your key. Keep the filename exactly `.env`, without a `.txt` suffix. Leave `OMDB_API_KEY` and the other values at their defaults for your first local installation. You can set `TZ` to your own timezone for nightly refreshes.

## 4. Start watch-it

From the same folder:

```sh
docker compose up -d --build --wait
```

The first build downloads the application dependencies. A successful command returns after the app is healthy. Open **http://localhost:8300** in a browser on that computer. Docker keeps it running after you close the terminal.

1. Open **Settings** using the gear button.
2. Under **API keys**, test TMDB and look for a working result.
3. Choose your country under **Watch-provider region**.
4. Select any services you subscribe to. You can leave this empty and browse all sources.
5. Open **Pick For Me**, select **No limit** for your first suggestion if you want the widest choice, and request a pick. Or open **Browse** to explore the catalog.
6. Save a title to your Watchlist. Find it later in **Library**; mark episodes watched on the title page as you go.

watch-it does not need your streaming-service passwords and does not play videos. Watch options lead to the regional provider listing.

## Install a prebuilt release

When a packaged release is available on the [Releases page](https://github.com/mgelsinger/watch-it/releases), download its **`watch-it-VERSION-linux-amd64.zip`** and `checksums.txt`. Use the version in the release name in place of `VERSION` below.

Verify the ZIP checksum against `checksums.txt`:

```powershell
Get-FileHash .\watch-it-VERSION-linux-amd64.zip -Algorithm SHA256
```

On Linux, use `sha256sum watch-it-VERSION-linux-amd64.zip`. Extract the ZIP to a folder. It includes the tested Docker image, `docker-compose.yml`, `.env.example`, and instructions. Open a terminal inside that folder, create and edit `.env` as above, then run:

```sh
docker load --input watch-it-VERSION-linux-amd64.tar
docker compose up -d --no-build --wait
```

This path needs Docker but does not need Git, Node.js, Python, or a source build. A first-run build is intentionally unavailable in this bundle. Keep this installation folder for future Compose commands.

## Common setup problems

| What you see | What to do |
| --- | --- |
| Docker cannot connect to the daemon | Start Docker Desktop or the Docker service, then rerun `docker version`. |
| No configuration file found | Open the terminal in the extracted folder that contains `docker-compose.yml`. |
| TMDB key missing | Confirm the file is named `.env`, the key is after `TMDB_API_KEY=`, and you saved it. Apply the change using the command below. |
| TMDB key test fails | Check that you copied the API Key rather than the Read Access Token. Test again after applying the change; also check your connection and TMDB's service status. |
| Port 8300 is already allocated | Set `PORT=8301` in `.env`, run the command below, and open `http://localhost:8301`. |
| The browser cannot connect | Run `docker compose ps` and `docker compose logs --tail 100 watch-it`. Wait for a healthy status and use the port configured in `.env`. |
| No suitable recommendations | Try No limit, all services, or fewer genre/exclusion filters. Check the selected region and TMDB key. |
| IMDb or Rotten Tomatoes scores are unavailable | They need the optional OMDb key and upstream coverage. Discovery still works with TMDB alone. |
| Another device cannot open localhost:8300 | Localhost refers to that device. Configure [LAN access](OPERATIONS.md#first-installation), then use your host computer's LAN address. |

After changing a key, password, port, or other `.env` setting:

```sh
docker compose up -d --no-build
```

Compose recreates the container when its configuration changes and preserves the named data volume. **`docker compose restart` does not apply changed environment variables.** [Docker documentation](https://docs.docker.com/reference/cli/docker/compose/restart/). If you installed directly with Node, restart the server process instead.

## Stop, update, and protect your library

```sh
docker compose stop
```

Start it again with `docker compose up -d --no-build`. Closing the browser does not stop the server.

Export a profile from **Settings** and keep a copy outside Docker before an update. Follow the [upgrade and recovery guide](OPERATIONS.md#upgrade-an-existing-installation), especially for older installations. Avoid `docker compose down -v`: it removes the volume holding your library.

For access from other devices, scheduled backups, or HTTPS, use the [operations guide](OPERATIONS.md).
