# Self-install release candidate

This candidate targets single-user Linux containers on x86-64 Linux and Windows Docker Desktop. Native development uses Node 22.12+ within Node 22. Distribution remains gated on the owner selecting the code license and a private security-reporting contact.

- Updated framework/build dependencies and introduced dependency/container audit gates.
- Fixed Browse retry loops, later-page error recovery, empty-page handling, and cancellation after filter changes.
- Bounded upstream queues, retries, body sizes, and deadlines; identical requests share refresh work.
- Corrected regional offers and surfaced stale/unavailable checks. Broad Korean Dramas/Anime discovery and source exclusions remain in place.
- Added a local, non-root Docker default, explicit route authentication, session invalidation on password changes, and route-specific import limits.
- Added graceful shutdown, snapshot/rollback helpers, tested volume ownership upgrades, and automated installation checks.
- Added About/credits/privacy, dated audio labels, watch-options links, first-run guidance, diagnostics, image pruning, and optional scheduled profile backups.
- Added desktop/mobile browser tests and a workflow that prepares a downloadable versioned Docker archive as a draft only after required checks pass.

Upgraders must follow [OPERATIONS.md](OPERATIONS.md), including the ownership adjustment for older root-owned volumes and a pre-upgrade snapshot. The default bind address is now localhost. Set an explicit LAN address if other trusted devices need access. The runtime image has no shell or npm; use the provided Node helpers.

Known limits: data and English-audio/adaptation coverage are partial and can be dated. Provider availability must be confirmed on your actual service and region. ARM images are not certified. A dedicated setup wizard and automatic feedback upload are not required for this single-user installation; Settings provides setup and manual report guidance.
