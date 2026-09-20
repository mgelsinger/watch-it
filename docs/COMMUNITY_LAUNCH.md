# Community-launch review

## September 20 follow-up

Reviewed the clean `prepare-public-release` checkout at `e6b37ef`, both local/remote branches, repository instructions, all six screenshots, setup bundle scripts, release gates, and the open draft PR #1 before editing. The existing six GitHub checks at that commit were successful; repository visibility remains private. This follow-up builds on the September 11 work below.

### Changes

- Retained the existing product introduction, first-use key fields, complete recommendation workflow, fictional sample demo and all six screenshots. The lead recommendation, availability, library, episode-progress and mobile captures remain useful and clearly dated.
- Added an honest README/announcement comparison with JustWatch and watch-tracking apps such as Trakt. Jellyfin is described as a personal media server. The preference for Watch It is its self-hosted discovery-to-progress workflow and portable library, without claims of unique data or automatic tracking.
- Fixed a real missing-information case: a failed mood-list request used to say any mood would be used even when saved filters still applied. Pick now explains the retained filters, offers retry and a key-setup link, and distinguishes loading. Service search now explains no matching services and offers a reset.
- Replaced hosted bring-your-own-key onboarding with an operator-managed TMDB application credential, no ordinary user key requirement, and optional OMDb omitted initially. The proposal addresses operator-only credential routes, global provider budgets, account isolation, retention, backups, exports and deletion. Updated effort: 156-252 hours; infrastructure estimate remains $25-40/month before provider licensing, paid identity plans and operator time.
- Added the dated [provider review](PROVIDERS.md), content-license links in About, and the review file to the setup ZIP. Added a provider-review publication gate because the existing metadata/export retention does not fully implement TMDB's six-month limit.

### Current verification

| Check | September 20 result |
| --- | --- |
| Type checks, server suite, production build | Passed; 68 server tests. |
| Desktop/mobile browser suite | 18 passed, including new mood-failure recovery and service-search cases. Core key setup, 45-minute recommendation, preview, save, episode persistence, missing/invalid keys, retry, empty results and demo isolation remain covered. |
| Clean source installation | Fresh source folder, clean Windows `npm ci` and build, blank `.env.example`, documented Compose build/start/wait command with disposable project/name/port overrides. Empty library, missing-key state and sample demo passed. `artifacts/source-review.json`. |
| Docker and HTTPS | Fresh install, non-root execution, authentication, upgrade/ownership repair, snapshots, merge/replace restore, restart, integrity and rollback passed. Existing isolated HTTPS secure-cookie and login-throttle checks passed. |
| Actual setup ZIP | Extracted shipped setup files and loaded their image. Live Settings key verification, US services, 45-minute comedy, watch-options HTTP, preview without saving, Watchlist save, episode persistence, export without key and demo isolation passed. The returned title was Chainsmoker Cat, 24 minutes; this confirms the runtime/service/genre mechanics, not a light-tone guarantee. Container recreation preserved configuration, key and library. `artifacts/setup-smoke.json`, `artifacts/setup-journey.json`. |
| Application audit | Zero production or development dependency findings. |
| Container audit | No high/critical findings; 15 medium and 7 low. Gate fails for newly reported CVE-2026-8674 and newly medium-classified CVE-2026-89092. Applicability is recorded in [dependency review](DEPENDENCY_REVIEW.md); neither was silently allowlisted. |
| Publication gate | Correctly fails for unset code license, unset private security contact and pending provider-terms/retention review. |
| Screenshot review | All six inspected; no replacements needed. Current ordinary-state UI remains represented; new error states are regression-tested. |

All tests used disposable resources. The live helper read only the existing TMDB key for normal provider calls, without printing it or recording a browser trace. The personal installation, library and environment file were not modified. The local candidate image is `sha256:5e6ebf496b7659e6702a4c1cc69c86faa594806c539d61fb3e0893a61fcd045a`; final publication must still use the reviewed tagged CI artifact. Historical successful GitHub checks below do not establish that a later candidate passes the refreshed scanner.

### Current release blockers and decisions

1. Select the code license and a verified private security-reporting channel. Existing hard gates remain.
2. Resolve TMDB metadata retention and export behavior under the applicable agreement. Choose a history-preserving metadata-expiry implementation or obtain explicit permission for the intended retention; record the outcome before approving the provider-review gate. No destructive cleanup or invented permission is part of this preparation.
3. Resolve the container advisory gate. The DNS search-domain denial-of-service advisory has no stable Debian fix listed at review time. The nscd advisory concerns a daemon absent from the shipped image. A reviewed mitigation/base fix or explicit documented maintainer risk disposition is required; new medium findings remain blocked under the existing policy.
4. Review the final PR and its current checks, then explicitly decide merge, public repository visibility, version/release publication and announcement publication. Signed-out README/download/demo links cannot be verified as public while the repository remains private and the candidate is unmerged.

Static demo hosting, physical-phone/Safari/ARM coverage, richer tone preferences and building a hosted beta remain optional. The sample walkthrough is already useful without provider data; publishing a hosted URL is a separate decision. Recommended next step: resolve the retention design and container disposition alongside license/security-contact choices, then approve the self-hosted release. Do not deploy today's shared-library app for unrelated community users.

## September 11 preparation record

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

That September 11 assessment found no additional implementation blocker after its gates. The September 20 provider-retention and container findings above supersede that conclusion. This is not approval to expose the current shared-library app as a multi-user service.

## Optional work, separate from launch blockers

- Host the static fictional demo on a chosen public URL; retain the HTML download as a no-infrastructure option. The README main-branch link becomes usable after merge and public visibility.
- Broaden real-device coverage, including physical phones, Safari, ARM and Apple Silicon; current claims remain limited to Linux x86-64 containers and Chromium viewport checks.
- Evaluate tone controls, adult/family preferences, larger recommendation pools and next-unwatched-episode runtime matching with user feedback. Current recommendations can include animation and use genre/catalog evidence; they do not guarantee a light tone or the best personal match.
- Build the hosted beta only after a separate decision. The original estimate was 140-220 hours and $25-40/month; use the revised [proposal](HOSTED_BETA.md) for the current operator-key design and retention-work estimate.

Recommended next step: review the sample demo, lead screenshot and draft PR, select the license and private reporting channel, then approve the self-hosted publication sequence. Gather setup and recommendation feedback before choosing to implement the hosted beta.
