# Self-install release candidate

This candidate targets single-user Linux containers on x86-64 Linux and Windows Docker Desktop. Native development uses Node 22.12+ within Node 22. Distribution remains gated on the owner selecting the code license and a private security-reporting contact.

- Updated framework/build dependencies and introduced dependency/container audit gates.
- Fixed Browse retry loops, later-page error recovery, empty-page handling, and cancellation after filter changes.
- Bounded upstream queues, retries, body sizes, and deadlines; identical requests share refresh work.
- Corrected regional offers and surfaced stale/unavailable checks. Broad Korean Dramas/Anime discovery and source exclusions remain in place.
- Added a local, non-root Docker default, explicit route authentication, session invalidation on password changes, and route-specific import limits.
- Added graceful shutdown, snapshot/rollback helpers, tested volume ownership upgrades, and automated installation checks.
- Added About/credits/privacy, dated audio labels, watch-options links, first-run guidance, diagnostics, image pruning, and optional scheduled profile backups.
- Added desktop/mobile browser tests and a workflow that prepares a versioned installation ZIP as a draft only after required checks pass. The ZIP includes the tested Docker image, version-pinned Compose configuration, a blank environment template, and installation/operations guides.
- Added a real screenshot tour, source ZIP installation instructions, TMDB key guidance, and setup troubleshooting. Corrected the command for applying changed environment settings.
- Clarified the product's discovery and tracking purpose: no video files, hosting or playback, and one shared library per installation.
- Added TMDB and optional OMDb key fields in Settings, provider verification before saving, actionable errors, immediate activation, and protected local storage outside profile exports. Existing environment keys still take precedence.
- Made services selectable within Pick For Me and added Light / comedy guidance, a synopsis, supported reasons, explicit offer types, watch-link fallback and retry actions.
- Fixed time options of 120 minutes or longer disabling the limit. Unknown runtimes no longer masquerade as a 45-minute match. Missing series runtimes can use explicitly labeled first-episode data.
- Added an isolated, keyless sample demo with fictional content and refreshed only the recommendation, preferences and episode-progress screenshots.
- Added a draft community announcement and a hosted-beta implementation proposal. No hosted accounts or private multi-user libraries are included in this release.

For a first installation, download the versioned `watch-it-VERSION-linux-amd64.zip` and `checksums.txt`. Check the ZIP checksum, extract it, and follow `START_HERE.md`. Docker with Compose and a TMDB API key are required; Git, Node.js, Python, and a source build are not required.

Upgraders must follow the included `docs/OPERATIONS.md`, including the ownership adjustment for older root-owned volumes and a pre-upgrade snapshot. Keep the same Compose project and data volume. The default bind address is now localhost. Set an explicit LAN address if other trusted devices need access. The runtime image has no shell or npm; use the provided Node helpers.

Known limits: data and English-audio/adaptation coverage are partial and can be dated. Provider availability must be confirmed on your actual service and region. ARM images are not certified. A dedicated setup wizard and automatic feedback upload are not required for this single-user installation; Settings provides setup and manual report guidance.
