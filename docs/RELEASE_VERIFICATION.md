# Self-install candidate verification

Verified September 10, 2026. App version: 1.0.0 from root `package.json`.

The candidate was built and tested locally on Windows with Docker Desktop running Linux x86-64 containers. The existing personal installation was not restarted or migrated. All installation/recovery checks used disposable volumes and fixture profiles.

## Results

| Check | Result |
|---|---|
| Clean installation | `npm ci` passed on the Windows host and in the pinned Linux build image |
| Types and production builds | Passed on Windows and during the Linux image build |
| Server tests | 59 passed on Windows and 59 passed in the Linux build image |
| Browser regressions | 10 passed across desktop Chromium and a narrow mobile Chromium viewport; includes keyboard navigation, login, credits, profile restore, retries, cancellation, genres and service variants |
| Live TMDB smoke | Passed: Korean Drama and Anime discovery each returned multiple catalog pages; the regional provider catalog contained more than ten services |
| Production image | Fresh volume, UID/GID 1000, dropped capabilities, protected routes, static assets, and clean build context passed |
| Upgrade and recovery | Fixture schema 009 upgraded, watched progress/ratings/notes/services/exclusions/history preserved, merge and replace restored, restart/integrity passed, snapshot rollback restored schema 009 and data |
| Proxy | Isolated Caddy HTTPS fixture passed: private upstream, protected routes, Secure/HttpOnly cookies, login throttle |
| Application dependency audits | Zero findings for production dependencies and the complete dependency tree |
| Container scan | Zero high/critical; 13 medium and 7 low findings with a dated [platform review](DEPENDENCY_REVIEW.md) |
| Compose defaults | Parsed configuration confirms localhost publication, init process and all capabilities dropped |
| Archive packaging | Tested image exported to a versioned Docker archive with SHA-256 checksum |
| Owner-decision gate | Correctly rejects release while license and private security contact are unset |

The concurrency fixture shares 30 identical callers across one request plus a simulated 429 retry. A separate fixture enforces a two-active/two-queued limit, rejects overflow, and drains active work on shutdown. Production defaults are five active and 64 queued requests per upstream, with a global cap of 256 unique operations. This verifies the bounds and sharing behavior; it is not a throughput benchmark.

## Exact local artifact

- Build tag: `watch-it:release-candidate-local`
- Docker image/index ID: `sha256:d71a54d1dc13ff12925f8e6bb8e3bdb81c2cd3ee31228476b87a8ed7f18a3b6d`
- Linux image configuration ID recorded by Trivy: `sha256:ae7420eb0c80096a4c50b53c0d5be11eebf8577cfb82c82cd74c5570566aaa00`
- Local archive: `artifacts/watch-it-1.0.0-linux-amd64.tar`
- Archive SHA-256: `da0dc3a21c59a5c84eef21b539204ec8193365c729dec049888b88531d92cd12`

Machine-readable reports are in the ignored `artifacts/` directory: `docker-smoke.json`, `proxy-smoke.json`, `container-audit.json`, application audit reports, and `checksums.txt`. CI uploads its own reports and exact tested archive for each run. Rebuilds may produce different artifact IDs; rerun the gates for the image being distributed.

## Remaining release actions

The implementation is ready for review. The owner still needs to select a repository license and a working private security contact. The workflow intentionally blocks distribution until those decisions are recorded. GitHub CI and the draft-release workflow have been authored but have not been run remotely during this implementation. Repository rules and approval requirements for the `release` environment are owner-controlled GitHub settings.

The live smoke verifies discovery and the multi-provider catalog, not every provider's entire inventory or audio tracks. English-audio evidence and adaptation mappings remain partial. ARM, Safari and Firefox are not certified by this candidate's checks.
