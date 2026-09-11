# Self-install release: technical implementation plan

Status: implementation completed September 10, 2026. Local release-candidate verification is recorded in [RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md). Distribution still needs the owner's code-license and private security-contact decisions, followed by the configured GitHub release checks.

September 11 public-preparation work adds a screenshot README, first-install guide, correct environment-update instructions, and a complete installation ZIP tested from its extracted files in CI. See [PUBLIC_READINESS.md](PUBLIC_READINESS.md) for the evaluation, evidence, and remaining publication decisions.

The release target is a single-user app that people install and operate themselves. Docker Compose is the primary installation path. Each installation keeps its own SQLite database, credentials, library, and preferences. Support fresh installations and upgrades on Linux and Windows Docker hosts.

The core discovery features and the reliability, packaging, recovery, and maintenance work below are implemented. User accounts, registration, billing, tenant separation, and a shared public website are outside this plan. Access from outside the local machine is an optional operator configuration.

## Implementation record

The requirements below remain as the acceptance checklist. The implementation covers both P0 and P1 work.

| ID | Implemented result | Evidence |
|---|---|---|
| R1 | Updated dependencies, locked builds, minimal runtime, audit gates | [Dependency review](DEPENDENCY_REVIEW.md), clean installs, builds, npm and image scans |
| R2 | Explicit Browse retry states, cancellation, response limits, bounded and shared upstream work | HTTP regression tests and desktop/mobile browser tests |
| R3 | Regional offer queries, dated availability status, incomplete-result recovery | Region, source-exclusion, audio, and browser tests |
| R4 | Local binding, UID/GID 1000, restricted image context, explicit route auth, credential rotation | HTTP installation tests and production-image smoke checks |
| R5 | Graceful shutdown, append-only migrations, snapshot/rollback helper, safety copies | Disposable fresh/older volumes, restore, restart, integrity, and rollback rehearsal |
| R6 | About/credits/privacy, official attribution asset, installation and support documentation | Desktop/mobile checks and [operations guide](OPERATIONS.md); owner license and private contact remain open |
| R7 | Windows/Linux CI, browser and image checks, opt-in live smoke, checked archive packaging, draft release workflow | Local verification passed; GitHub workflows are authored and await a pushed commit/version tag |
| R8 | Settings setup guidance, validated watch links, manual title report context | Browser setup checks and watch-URL tests |
| R9 | Bounded image cache, optional retained backups, sanitized diagnostics, optional HTTPS proxy | Maintenance regression tests and isolated TLS/login proxy check |

## Existing baseline to preserve

- Korean Dramas and Anime query the matching TMDB catalog across services with pagination; they are not fixed title lists.
- Browse and Pick For Me support source exclusions, including separately listed channel variants. A title on an excluded service remains eligible if an included service also carries it.
- Browse preserves filters in its URL. Pick preferences persist and are included in profile backups.
- Optional single-installation login already has hashed session tokens, HttpOnly/SameSite cookies, expiry, logout, and failed-login throttling.
- Profile export, validation, transactional merge/replace restoration, and pre-restore safety copies already exist.
- Before this plan, implementation verification passed 44 tests, type checking, a production build, and live browser checks. Current results are in the verification record.
- The pre-plan production dependency audit reported nine affected packages: four high and five moderate. Those application findings are resolved. The new runtime's remaining medium/low platform findings have a dated [disposition](DEPENDENCY_REVIEW.md).

## Delivery order

P0 items block the first self-install release. P1 items improve the first stable release but may follow an explicitly labeled beta.

| Order | ID | Priority | Deliverable | Depends on |
|---|---|---|---|---|
| 1 | R1 | P0 | Patched, reproducible dependencies | None |
| 2 | R2 | P0 | Bounded requests and recoverable Browse errors | R1 |
| 3 | R3 | P0 | Correct regional availability and failure reporting | R2 |
| 4 | R4 | P0 | Safe, clean installation package | R1 |
| 5 | R5 | P0 | Verified upgrades, shutdown, and recovery | R4 |
| 6 | R6 | P0 | Credits, limitations, and operator documentation | None |
| 7 | R7 | P0 | Automated release checks and versioned artifacts | R1-R6 |
| 8 | R8 | P1 | First-run setup and watch-options links | R3, R6 |
| 9 | R9 | P1 | Maintenance improvements and optional remote-access checks | R4, R5 |

Implement each row as a reviewable change. Add regression tests with the relevant fix. Start CI early, then make its complete release checks mandatory after the preceding changes land.

## R1. Update and audit dependencies

**Affected files:** [server/package.json](../server/package.json), [web/package.json](../web/package.json), [package-lock.json](../package-lock.json), and affected framework integrations.

**Code work:**

- Run `npm audit --omit=dev --json` and map each finding to the installed package, patched version, and code paths used by this app. Also audit development/build dependencies before producing release artifacts.
- Upgrade direct packages and regenerate the lockfile with supported combinations. Review `@fastify/static`, Fastify and its transitive dependencies, React Router, and `node-cron` explicitly. Select patched versions at implementation time rather than freezing this plan to today's versions.
- For major upgrades, check static serving/SPA fallback, navigation, and cron scheduling APIs. Do not apply an unreviewed `npm audit fix --force`.
- Keep a short advisory disposition file, including any remaining advisory's affected path, mitigation, owner, and review date.

**Acceptance checks:** clean `npm ci`; all existing tests, type checks, and builds pass; scheduled jobs and client navigation work after upgrades. No unresolved high/critical production advisory without a documented applicability review. Every moderate finding has a disposition. A clean Linux container build resolves exactly the committed lockfile.

## R2. Fix retry behavior and bound network work

**Observed problem:** [Browse.tsx](../web/src/pages/Browse.tsx) starts another first-page request whenever `page === 0` and `loading` becomes false, including after failure. The scroll observer can also re-trigger failed loads. In [http.ts](../server/src/http.ts), the timeout ends after response headers arrive, before JSON/image bodies finish downloading.

**Affected files:** [Browse.tsx](../web/src/pages/Browse.tsx), [api.ts](../web/src/api.ts), [http.ts](../server/src/http.ts), [providers.ts](../server/src/services/providers.ts), [sync.ts](../server/src/services/sync.ts). Add focused frontend and HTTP regression tests.

**Code work:**

- Give the grid explicit idle/loading/error/exhausted states and an immediate in-flight guard. Initial loading and infinite scroll must stop on error.
- Add a visible Retry action for first-page and later-page errors. Keep already loaded results when a later page fails. Retry the failed page, not the next one.
- Abort obsolete requests when filters change or the grid unmounts. Preserve the existing query-key remount and title deduplication.
- Treat `total_pages: 0` as exhausted. Handle pages emptied by availability/library filtering without declaring the entire catalog empty or starting an unbounded automatic scan. Offer Load more when additional upstream pages remain.
- Keep upstream deadlines active through body consumption, cap response sizes, release failed response bodies, and bound retries under one total request deadline. Preserve source throttling and stale-cache fallback.
- Share concurrent refreshes for the same discovery/provider cache key and bound queued upstream work. Do not start duplicate work for simultaneous identical requests.

**Acceptance checks:** simulate first-page 502, later-page 502, 429, slow headers, a stalled body, and a filter change during a request. An idle error screen makes no further requests until Retry. Retry does not skip or duplicate pages. An old response cannot appear under new filters. A successful empty final page stops loading. Simultaneous identical cache misses share one upstream operation.

## R3. Make regional availability and uncertainty consistent

**Observed problems:** some local availability queries, including `attachMyOffers`, omit the selected region. Provider enrichment can turn a request failure into an empty offer list without telling the user that the check failed. English-audio evidence remains partial and dated.

**Affected files:** [queries.ts](../server/src/services/queries.ts), [providers.ts](../server/src/services/providers.ts), [browse.ts](../server/src/services/browse.ts), [pick.ts](../server/src/services/pick.ts), [system.ts](../server/src/routes/system.ts), [englishAudio.ts](../server/src/services/englishAudio.ts), [VersionNote.tsx](../web/src/components/VersionNote.tsx), and both server/client response types.

**Code work:**

- Audit availability reads in Home, Library, Browse, Pick, and title details. Use the active region for current offers; preserve old-region records as history rather than treating them as current availability.
- Validate region settings against supported values. Refresh/invalidate the appropriate view and cache keys after a region change, while preserving saved service exclusions.
- Carry additive availability metadata through the API: `fresh`, `stale`, or `unavailable`, plus a last-checked timestamp where known. Read old cache payloads compatibly or version the cache keys.
- Distinguish a successful lookup with no matching offers from a failed lookup. Keep existing exclusion semantics: do not claim a title is available on an included service when that cannot be established. Show an incomplete-results notice and recovery action when unavailable checks remove candidates.
- Keep audio evidence separate from the discovery pool. Retain provider, region, source, and check date; describe old evidence as dated rather than newly verified. Do not infer a dub from English subtitles or translated titles.

**Acceptance checks:** switch US to CA with both regions present in SQLite and prove all current-offer displays use CA. Test stale and failed provider lookups with and without exclusions. Excluding Crunchyroll and its channel variant still allows a shared Netflix title. Clearing exclusions restores the original search. Unknown audio never limits ordinary genre discovery. Existing URL, backup, and language-migration tests continue passing.

## R4. Package safe installation defaults

**Affected files:** [Dockerfile](../Dockerfile), [docker-compose.yml](../docker-compose.yml), [config.ts](../server/src/config.ts), [index.ts](../server/src/index.ts), [auth.ts](../server/src/auth.ts), [.env.example](../.env.example). Add `.dockerignore` and HTTP-level authentication tests.

**Code work:**

- Exclude `.env` files, databases, backups, logs, `.git`, host `node_modules`, and generated output from the Docker build context. Retain only the source/build inputs the image needs.
- Run the application as a non-root user. Create writable data/cache directories with restricted permissions. Provide a volume-specific ownership upgrade procedure for existing installations; avoid world-writable permissions.
- Default the published Docker port to `127.0.0.1:${PORT}:8300`, with an explicit bind-address setting for LAN access. Keep the container's internal listener reachable by Docker. Give native development startup its own explicit host setting.
- Preserve optional login for trusted local installations. Clearly require a password and HTTPS before exposing an installation to untrusted networks; do not introduce registration or multiple-user administration.
- Test authentication at the route level, covering settings, backup export/restore, sync, and title mutations. Make protected/public route policy explicit instead of depending solely on raw URL string prefixes.
- Ensure credential rotation can invalidate existing sessions, and that passwords, session tokens, and API keys never enter client responses or ordinary logs.
- Use small request body limits for ordinary APIs, with the existing larger import allowance only on backup routes. Keep login throttling bounded in memory and verify its behavior through an explicitly configured reverse proxy.

**Acceptance checks:** a clean install is reachable on localhost and not published on all host interfaces by default. Fresh and upgraded volumes are writable by the runtime user. The image contains no local data, credentials, host dependencies, or developer artifacts. With login enabled, every protected route rejects unauthenticated requests. Backup exports contain no credentials or sessions. Unsafe/ambiguous path variants cannot evade route authentication.

## R5. Make upgrades and recovery repeatable

**Affected files:** [db.ts](../server/src/db.ts), [index.ts](../server/src/index.ts), [sync.ts](../server/src/services/sync.ts), [backup.ts](../server/src/services/backup.ts), [system.ts](../server/src/routes/system.ts), migration/backup tests, and operator documentation.

**Code work:**

- Extract app construction from process startup so integration tests can create and close an app without starting cron jobs or listening on a public interface.
- Handle SIGTERM/SIGINT: stop scheduling new work, drain or cancel in-flight work within a deadline, close Fastify and SQLite, and exit cleanly. Keep handles for scheduled jobs so they can be stopped.
- Keep migrations transactional and append-only. Preserve migrations already applied by existing installations, including `010_original_language.sql`.
- Provide a consistent pre-upgrade database snapshot procedure using SQLite's backup API or a stopped application. Never recommend copying only the main database file while WAL writes are active.
- Preserve existing profile backups and safety copies. Surface backup/restore failures without losing the original data. Verify available storage and writable paths before changing data where practical.
- Document rollback as restoring the matching pre-upgrade snapshot and previous image. Do not promise that an older binary can read a newer schema.

**Acceptance checks:** install an older fixture database, upgrade it, and verify watched episodes, ratings, notes, lists, services, exclusions, and recommendation history. Reject malformed backups without changing data. Exercise merge and replace restore into a fresh installation. Interrupt the process during work and verify restart plus SQLite integrity/foreign-key checks. Rehearse rollback against a disposable volume.

## R6. Add required credits and accurate release documentation

**Affected files:** [App.tsx](../web/src/App.tsx), [README.md](../README.md), a new About/Credits page, approved attribution assets, `LICENSE`, `SECURITY.md`, and a short privacy/support document.

**Code and documentation work:**

- Add an About/Credits route linked from the footer, including an approved TMDB logo and the existing required notice. TMDB specifies logo and About/Credits attribution requirements in its [API FAQ](https://developer.themoviedb.org/docs/faq).
- Preserve JustWatch attribution wherever provider data is presented, as required by the [watch-provider documentation](https://developer.themoviedb.org/reference/tv-series-watch-providers). Keep OMDb and TVmaze credits.
- Explain what stays on the installation and what metadata requests go to external providers, including server logs and local backup files. Provide instructions for exporting data and uninstalling without accidental volume deletion.
- Document partial audio/remake coverage and regional availability. Avoid claims that every title, dub, service, or episode is covered.
- Explain key setup, updating, backups, recovery, supported platforms, optional LAN/HTTPS access, and how to report a bug or security issue.
- Have the owner choose the repository license and actual support/security contact before distribution. These are release decisions, not code defaults to invent.

**External release checks:** if distribution will be monetized, resolve provider terms before enabling that business model. TMDB distinguishes commercial use in its [FAQ](https://developer.themoviedb.org/docs/faq); [OMDb](https://www.omdbapi.com/) lists a noncommercial content license; [TVmaze](https://www.tvmaze.com/api#licensing) describes attribution and ShareAlike conditions. Keep code licensing separate from upstream data licensing.

**Acceptance checks:** credits are reachable on desktop and mobile; approved assets and source links work; documentation matches the actual installation defaults. No placeholder contact, invented license, or unsupported completeness claim ships.

## R7. Automate the release checks

**New files:** `.github/workflows/ci.yml`, a release workflow, and isolated installation/browser test scripts. Update package scripts as needed.

**Code work:**

- Run clean install, type checking, tests, and builds in CI. Exercise supported Windows/Linux Node environments and build/run the production Docker image on Linux.
- Add browser tests for the failure cases in R2, login, genre selection, source exclusions, preference persistence, and profile restore. Cover keyboard operation and a narrow mobile viewport; use fixtures for repeatable provider data.
- Run a separate opt-in live TMDB smoke check using a CI secret. Live provider catalogs must not make deterministic tests flaky, and secrets must not be supplied to untrusted pull requests.
- Add fresh-volume, upgrade, non-root ownership, health, graceful-shutdown, and restore checks for the exact release image.
- Produce an audit report and scan the container before release. Record any reviewed advisory exceptions with an expiry/review date.
- Derive application version, health version, backup metadata, and release notes from one version source. Produce an immutable image tag and digest. Select the image registry before implementing publication.
- Run a small fixture-backed concurrency test; verify identical cache misses are deduplicated, queues are bounded, errors recover, and the process stays responsive. Record measured limits rather than claiming untested capacity.

**Acceptance checks:** the release job cannot publish until required checks pass. Install the exact built image in a clean environment and complete setup, discovery, exclusions, save/watch actions, restart, export, and restore. No developer database or `.env` is needed by the tests. ARM support is advertised only if separately built and tested.

## R8. Improve first-run setup and watch navigation

P1: useful for a stable release; may follow the beta.

**Affected files:** [Settings.tsx](../web/src/pages/Settings.tsx), [App.tsx](../web/src/App.tsx), [tmdb.ts](../server/src/sources/tmdb.ts), [providers.ts](../server/src/services/providers.ts), [Title.tsx](../web/src/pages/Title.tsx), and [Pick.tsx](../web/src/pages/Pick.tsx).

- Add a short first-run flow: key configured/test status, region, optional subscribed services, and an explanation of search exclusions. Keep credentials in environment configuration; the UI should not expose them or silently write `.env`.
- Make incomplete setup recoverable and allow users to revisit it without clearing their library. Keep service subscriptions and per-search exclusions as distinct preferences.
- Carry the provider response's regional TMDB watch URL through the cache/API and add a Watch options link on title details and recommendations. Validate an HTTPS TMDB URL and omit the action if no valid URL is available. TMDB documents this link as the path to actual watch links; it does not supply complete direct service deep links in this endpoint. [Provider documentation](https://developer.themoviedb.org/reference/tv-series-watch-providers)
- Add a support/report action that prepares the title identity, region, provider, and check date for the user to review. Do not automatically upload their library, notes, or diagnostics. A new hosted feedback service is unnecessary.

**Acceptance checks:** a fresh user can configure the app and obtain a result; missing keys and provider failures have actionable guidance. Opening watch options does not add a title to the library. Settings and saved data survive revisiting setup.

## R9. Add maintenance conveniences where needed

P1: scope these after the P0 fixes and actual installation testing.

- Add configurable image-cache size/age limits with safe eviction of cache files only. Current cleanup removes old previews/API cache entries but not poster files.
- Add optional scheduled profile backups to a configured local directory, with retention and visible last-success/error status. Keep manual export and restore intact; a NAS/cloud integration is not required.
- Publish and test an optional HTTPS reverse-proxy example with Secure cookies, exact trusted-proxy configuration, and abuse limits for exposed installations. Keep remote access opt-in.
- Add sanitized support diagnostics containing app version, platform, sync status, and cache/database sizes. Exclude credentials, session identifiers, library contents, and private notes by default.

**Acceptance checks:** cache pruning cannot reach database/backup paths; scheduled backup failure leaves existing backups intact; exposed-installation guidance passes a real proxy/login smoke test; diagnostic output contains no secrets.

## Release gate

- [ ] R1-R7 external release checks are complete for the exact tagged candidate. Local checks pass; owner decisions and execution of GitHub checks remain.
- [x] Existing genre, source-exclusion, library, recommendation, authentication, and backup behavior remains covered by passing tests.
- [x] Clean installation, upgrade, backup restoration, and rollback have been rehearsed with disposable data.
- [x] The default installation is local, runs without root privileges, and contains no bundled credentials or personal data.
- [x] Dependency/container findings are resolved or have reviewed, dated applicability dispositions.
- [ ] Credits, repository license, supported-platform claims, known limitations, and support instructions are complete.
- [x] Release notes cover R8/R9 and explain migration or configuration changes. Both P1 rows are implemented.
- [x] The release workflow packages the tested artifact with a versioned tag and creates a draft. Public release remains a separate owner action.

The owner must select the code license, add its `LICENSE`, and configure a working private security-reporting URL or email in `release-config.json` and `SECURITY.md`. Then push the reviewed implementation, require the CI checks, configure the GitHub `release` environment's approval policy, create the matching version tag, and run the release workflow. No registry is required for the implemented downloadable Docker archive path. No public release or deployment was performed during implementation.
