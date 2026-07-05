---
name: verify
description: Build, launch, and drive watch-it locally to verify a change end to end against a seeded scratch database.
---

# Verifying watch-it changes

The app is a Fastify server (serves the built SPA + JSON API) backed by SQLite. Production runs in Docker on :8300 with data in the `watch-it-data` volume — never point a test server at that.

## Build

```bash
npm run typecheck        # both workspaces
npm run build            # web (vite) then server (tsc + copy migrations)
```

## Launch against a scratch DB

`DATA_DIR` controls where the SQLite file lives; migrations apply automatically on boot. From `server/`:

```bash
DATA_DIR="C:\\path\\to\\scratch" PORT=8399 node dist/index.js
```

The server serves `web/dist` with an SPA fallback, so `curl http://127.0.0.1:8399/<route>` returns index.html for client routes and JSON under `/api/`.

## Seeding fixtures

External APIs (TMDB) are only needed to *add* titles, so seed directly with SQL for offline verification. Key tables: `titles`, `user_state` (one row per title; `status`, `watched_at`, `never_suggest`), `seasons`/`episodes` (`watched_at`, `air_date` drive next-unwatched logic), `availability` (+ `my_services` for "on my services"; `initial_sync=0` rows are genuine observed arrivals), `settings`, `suggestion_log`. Warm `api_cache` key `tmdb_genres_merged` to make genre features work offline.

A reusable seeding + assertion pattern lives in git history under CR-03 (scratchpad `pick-test.mts`, run with `npx tsx` from `server/` so `better-sqlite3` resolves; set `DATA_DIR` via env **before** importing `db.ts`).

## Gotchas

- Scratchpad test files must be `.mts` — plain `.ts` outside the workspaces transpiles as CJS and top-level await fails.
- `curl` + a few loops is enough to observe weighted-random behavior (repeat draws, `grep -o '"name":"..."' | sort | uniq -c`).
- No browser automation is available by default; SPA behavior beyond "route serves index.html" needs manual eyes or a screenshot tool.
- Kill test servers via `Get-CimInstance Win32_Process` filtered on `dist/index` — several unrelated node processes are usually running.
