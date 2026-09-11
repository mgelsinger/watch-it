# Community-launch review

Reviewed September 11, 2026, building on `3eccaeb` on `prepare-public-release` and [draft PR #1](https://github.com/mgelsinger/watch-it/pull/1). The checkout was clean before this work. `main` was at `be9b467`, the repository was private, and all six existing branch/PR checks had passed. Repository and parent instructions were checked before editing. No new release branch was needed.

## What this phase adds

The prior release preparation already supplied a Docker image/setup bundle, installation and recovery guides, six real-app screenshots, attribution, issue forms, and CI/release gates. This phase keeps that work and concentrates on the product explanation, first use and the main demonstration:

- README, Home, About and Settings explain “Find your next watch and keep your place,” who it serves, the absence of video files/playback, the external watch-options path, and one shared library per installation.
- Required TMDB and optional OMDb keys have specific Settings fields, links and acquisition instructions. Verification happens before saving; failure preserves the previous key. Keys work immediately, remain outside profile exports/diagnostics, and persist in a mode-600 file in the Linux data volume. Environment keys remain supported and take precedence. Key checks are throttled. This is protected self-hosted storage, not the encrypted per-account hosted design.
- Pick For Me lets people choose subscriptions in context, uses Light / comedy as an explicitly limited genre filter, shows a synopsis and concrete reasons, identifies offer types and region/date, provides retry and missing-link guidance, and labels tracking actions separately from playback.
- Every explicit time limit is now enforced. Previously 120 minutes or more disabled the budget, zero could appear as a real runtime, and missing TV runtime could be guessed as 45 minutes. Unknown runtimes are skipped under a limit. Where series runtime is absent, the app checks the first episode and labels that basis. Real checks found this mattered for Ted Lasso, Trying and Platonic. Other episodes can be longer.
- The standalone sample demo is keyless and separate from installation data. Its titles, artwork, offers and history are fictional, clearly labeled, and held only in temporary browser memory. It is usable as a downloaded HTML file before installing anything; a hosted public URL remains optional.
- Only the recommendation, Pick preferences and title-progress screenshots were replaced. The library, browse and mobile captures were reviewed and retained. The lead capture shows a real Ted Lasso recommendation with S1E1's 33-minute runtime and the US Apple TV offer at capture time. It was selected using the real recommendation/shuffle flow. No availability was invented.
- A [community announcement draft](ANNOUNCEMENT_DRAFT.md) and [hosted-beta proposal](HOSTED_BETA.md) are prepared for review. Neither has been published or deployed.

## Verification

All tests use temporary databases, volumes and ports. The user's running installation, library, `.env` and provider credentials were not changed. The opt-in live tests read only the TMDB key needed to make provider requests; no browser trace is recorded for that run.

| Check | Result / evidence |
| --- | --- |
| Type checks and production build | Passed on Node 22 on Windows and in the Linux Docker build. |
| Clean source setup | Exported the candidate source into a separate folder, ran clean `npm ci` and build, copied the blank environment template, and ran the documented Compose build/start/wait command with only disposable names and ports overridden. Empty library, missing-key state and demo passed. `artifacts/community-source-install.json`. |
| Server regressions | 68 passed, including key validation/persistence/removal, authorization and cross-origin guards, export privacy, OMDb rejection, runtime limits, first-episode evidence, missing offers and service scope. |
| Browser journeys | 16 passed across desktop and mobile Chromium viewports. The full key-to-pick-to-preview-to-watchlist-to-episode flow uses the real API/database with fixture upstream responses. Missing-key/invalid-key, retry, empty results, and demo isolation are covered. |
| Live application presentation | Separate curated library and live TMDB responses; screenshot layout and image loading checked. No horizontal overflow. Only the three reviewed replacements were retained. |
| Docker and recovery | Disposable fresh install, UID/GID 1000, authentication, upgrade from schema 009, ownership repair, snapshot, merge/replace restore, restart, integrity and rollback passed. `artifacts/docker-smoke.json`. |
| Downloaded setup | The actual ZIP was extracted into a clean folder, its image loaded, and its shipped Compose configuration started. Blank-key state and demo verified. The opt-in live run pastes the key through Settings, chooses region/services, requests 45-minute comedy, follows a real watch-options URL, previews without saving, saves, marks an episode watched, and verifies persistence and secret-free export. Container recreation preserves the key, saved title and region; credential mode is 600. `artifacts/setup-smoke.json`, `artifacts/setup-journey.json`. |
| HTTPS | Existing isolated Caddy fixture passed secure-cookie, private-upstream and login-throttle checks. `artifacts/proxy-smoke.json`. |
| Dependency audit | Zero application findings for both production and all dependencies. |
| Credential scan | Gitleaks 8.30.1 with redaction found no detected secrets in the staged candidate source tree or all local Git refs. `artifacts/community-tree-scan.json`, `artifacts/community-history-scan.json`. This is not a penetration test. |
| Container audit | No high/critical findings. Existing 13 medium and 7 low platform findings remain, plus an unknown-severity nscd advisory. See the dated [platform review](DEPENDENCY_REVIEW.md), not a vulnerability-free claim. |
| Publication gate | Correctly fails until the code license and working private security contact are selected. No license or contact was invented. |

The candidate ZIP and its checksums are ignored local review artifacts, not a published release. The final release must be built by CI from the reviewed version tag. The earlier verification records describe their own historical image IDs and must not be substituted for the final artifact.

## Remaining release blockers and final decisions

1. **Code license:** choose a license, add its approved `LICENSE`, set `release-config.json`, and update pending-license copy. This remains a hard release gate.
2. **Private security reporting:** choose and verify a private reporting URL or contact, update `SECURITY.md` and `release-config.json`. This remains a hard release gate. GitHub private reporting must actually be enabled when eligible, not merely linked.
3. **Final review and CI:** review the expanded draft PR, ensure its current commit passes the Windows/Linux, browser, image, security and setup-bundle checks, and merge only the reviewed version. Check that screenshots and first-use instructions match that build.
4. **Publication:** explicitly approve changing this repository's visibility, including its history and collaboration records. Then check README/download/issue links while signed out. Approve the version tag, generated draft release and announcement before publishing them. Visibility and release publishing have not been changed.

There is no known additional implementation blocker to a clearly labeled self-hosted community release after these gates. This is not approval to expose the current shared-library app as a multi-user service.

## Optional work, separate from launch blockers

- Host the static fictional demo on a chosen public URL; retain the HTML download as a no-infrastructure option. The README main-branch link becomes usable after merge and public visibility.
- Broaden real-device coverage, including physical phones, Safari, ARM and Apple Silicon; current claims remain limited to Linux x86-64 containers and Chromium viewport checks.
- Evaluate tone controls, adult/family preferences, larger recommendation pools and next-unwatched-episode runtime matching with user feedback. Current recommendations can include animation and use genre/catalog evidence; they do not guarantee a light tone or the best personal match.
- Build the hosted beta only after a separate decision. The proposal recommends 10-25 invitees, a control database plus isolated SQLite library per account, server-enforced ownership context, encrypted credentials, quotas, exports, backups and deletion. Estimated effort is 140-220 hours and initial operating budget $25-40/month; assumptions and current price sources are in the proposal.

Recommended next step: review the sample demo, lead screenshot and draft PR, select the license and private reporting channel, then approve the self-hosted publication sequence. Gather setup and recommendation feedback before choosing to implement the hosted beta.
