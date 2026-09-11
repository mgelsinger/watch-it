# Public-release preparation

The subsequent community-launch work builds on draft PR #1 and is recorded in [COMMUNITY_LAUNCH.md](COMMUNITY_LAUNCH.md), with the [hosted-beta proposal](HOSTED_BETA.md), [sample demo](DEMO.md) and [announcement draft](ANNOUNCEMENT_DRAFT.md). The assessment below is the earlier preparation baseline.

Reviewed September 11, 2026 against `be9b467` and the accompanying preparation changes. The initial public audience is people comfortable running a personal Docker application. The repository remains private until the owner approves publication.

## Assessment

The application already has a usable discovery, recommendation, tracking, and backup flow. The largest public-facing gaps were an image-free README, assumed knowledge of TMDB and Docker, an incorrect instruction for applying changed keys, and release downloads that contained an image without the files needed to run it. A larger feature expansion is not required for an initial self-hosted release.

Docker and a personal TMDB key remain real setup requirements. The first release should state them prominently. A managed demo, native installer, or prepublished container registry could reduce friction further, but each is a separate distribution decision rather than a requirement to publish the current project.

## Prepared changes

- README with a concise product introduction, real screenshot tour, source ZIP option, explicit prerequisites, first-run steps, and answers to common questions.
- Six screenshots from an isolated sample library: library, anime discovery, title/episode tracking, recommendation preferences, an actual recommendation result, and a narrow Chromium viewport. Capture recipe and provider attribution included.
- Dedicated installation guide for Docker, the correct TMDB credential, Windows/Linux commands, configuration, first use, and troubleshooting. Detailed catalog behavior remains in its own guide.
- Settings now gives the correct `docker compose up -d --no-build` command after configuration changes, links to TMDB key setup, and names the region controls for assistive technology. A stale recommendation tooltip now describes preview behavior accurately.
- Complete installation ZIP containing the tested image, version-pinned Compose configuration without a build requirement, blank configuration template, Start Here guide, optional HTTPS files, and operations/privacy/support documentation. Only explicitly allowed files are packaged.
- Release workflow builds that ZIP, checks its actual clean-folder installation, and prepares a draft only after the existing release gates pass. Checksums use ordinary hash/file lines; the image ID is a separate file.
- Bug and feature forms and a focused contribution guide.

## Verification performed

| Check | September 11 result |
| --- | --- |
| Type checks and production build | Passed on Windows; production Docker build also passed |
| Server regression suite | 59 tests passed |
| Browser suite | 10 desktop/mobile Chromium workflows passed |
| Live screenshots | Six captures from the built app, fresh temporary database, US metadata, no personal library; visible images loaded and no horizontal page overflow |
| Docker installation and recovery | Fresh install, non-root runtime, authentication, upgrade from schema 009, ownership repair, snapshots, merge/replace restore, restart, and rollback passed using disposable resources |
| ZIP installation | Extracted the actual 62 MB candidate ZIP into a temporary folder; loaded the image; started using only its shipped setup files; confirmed empty library and missing-key state |
| Configuration recovery | Changed `.env`, ran the documented Compose command, and verified the new environment took effect while the saved region survived container recreation |
| Application dependency audit | Zero findings for production and all dependencies |
| Credential scan | Gitleaks 8.30.1 found no detected secrets across all local Git refs (11 commits) and the staged public candidate source tree; reports were redacted |
| Tracked sensitive filenames | No `.env`, database, private-key, or certificate-key files found in the checked history filename search |
| Release gate | Correctly refuses release while code license and private security contact remain unset |

Detailed machine-readable logs are in ignored `artifacts/`, including `docker-smoke.json`, `setup-smoke.json`, `public-history-scan.json`, and `public-tree-scan.json`. The prior September 10 container advisory disposition remains in [DEPENDENCY_REVIEW.md](DEPENDENCY_REVIEW.md). The release pipeline must rerun the container scan for the final tagged candidate; the local credential scan is not a penetration test.

The user's running installation was not restarted, migrated, or used for screenshots. No broader hardware or physical-phone certification is inferred from Chromium viewport checks.

## Decisions before publication

1. **Choose the code license.** Add the approved `LICENSE`, set `code_license` in `release-config.json`, and update the README/contribution status. MIT is a reasonable option if permissive reuse, including commercial reuse, is intended. Provider metadata and artwork have separate terms. [MIT license summary](https://choosealicense.com/licenses/mit/).
2. **Choose and verify private vulnerability reporting.** GitHub's private reporting is a convenient option for a public repository; enable and verify it when eligible, then record the actual reporting URL in `release-config.json` and `SECURITY.md`. Alternatively use an owner-selected private contact. Do not claim it is enabled until verified. [GitHub instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
3. **Approve repository visibility.** The existing repository is private. Public visibility exposes the repository's history and collaboration records as well as the current files. The owner should confirm that this is the intended repository to publish.
4. **Finish the release from the reviewed commit.** Merge the preparation, run GitHub checks, update pending-status copy to match the approved decisions, create the matching version tag, and run the draft-release workflow. Inspect the generated release and its setup check before publishing it. The local candidate ZIP is an unpublished test artifact, not the final approved release.

## Repository presentation

Suggested About description: **Find your next watch and keep your place. Self-hosted movie and TV discovery, streaming availability, and personal watchlists.**

Suggested topics: `self-hosted`, `docker`, `movies`, `tv-shows`, `watchlist`, `tmdb`, `typescript`.

Keep the homepage field empty until there is a real project page or public demo. Use the screenshot README and the eventual blog article as the first public introduction. Avoid claims of exhaustive provider/dub coverage, a native one-click installer, or support on platforms that have not been verified.
