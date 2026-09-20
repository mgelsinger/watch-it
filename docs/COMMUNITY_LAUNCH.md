# Self-hosted community launch

Reviewed September 20, 2026. The first launch is for people running Watch It on their own computer or home server. One installation has one shared library and uses its owner's provider keys. Hosted accounts, private multi-user libraries and paid infrastructure are deferred.

The application and installation preparation are complete for this candidate. PR #1 is still a draft, `main` still has the older README and application, the repository is private, and no tag or packaged release has been published. The remaining required work is publication and its checks, followed by the announcement. No additional hosted service or feature expansion is needed for this launch.

## Prepared for review

The work builds on `prepare-public-release` and [draft PR #1](https://github.com/mgelsinger/watch-it/pull/1), following inspection of repository instructions, branches, existing installation/release checks, the README, setup bundle and six screenshots.

- Product copy leads with **Find your next watch and keep your place**, explains no video files or playback, identifies the required TMDB key and optional OMDb integration, and makes the shared-library limit explicit. JustWatch and Trakt are honest alternatives; Jellyfin is a personal media server.
- Pick For Me demonstrates a 45-minute, services-and-comedy workflow. Reasons are tied to runtime, catalog genre and regional offers. Missing mood data retains existing filters with retry; empty service searches explain how to reset. Missing runtime/availability and empty results do not silently broaden preferences.
- The fictional, keyless sample demo is separate from personal data. All six existing screenshots were reviewed and remain useful; no further replacements were needed. The announcement stays a draft.
- Provider metadata now expires independently from watch history. Version 3 exports contain personal state and identity references. Older exports still import, discarding provider content, and fresh details can be downloaded again. Upgrade and backup documentation explains placeholder titles, preserved episode progress, and managed recovery-file retention.
- The new DNS-search crash was reproduced and mitigated in the Linux launcher. The nscd finding is scoped to a service absent from the image. Both remain in the full report and dated review; high/critical findings and new unreviewed medium findings still block release.
- MIT is prepared as the code license. Provider artwork and data retain their separate terms. GitHub private vulnerability reporting is the selected security channel; it must be enabled and verified after the repository becomes public.

## Verification

| Check | Result |
| --- | --- |
| Types, server regression tests and build | Passed; 71 server tests, including metadata expiry, history preservation, version 1/2/3 imports/exports and safe recovery cleanup. |
| Desktop/mobile Chromium | 18 passed: first-use keys, 45-minute pick, service selection, watch options, preview, save, episode progress, error/empty recovery and demo isolation. |
| Clean documented source installation | Fresh source directory, clean Windows dependency install/build, blank environment template, documented Compose build/start/wait, empty library, missing-key state and demo passed. Final app edits also passed the production Docker build. |
| Docker upgrade and recovery | Passed: non-root execution, authentication, schema 009 upgrade, ownership repair, snapshots, merge/replace restore, shutdown, restart, integrity and rollback. Added resolver mitigation and absent-nscd assertions passed. |
| HTTPS | Passed: isolated proxy, protected routes, Secure cookie and login throttling. |
| Application dependency audit | Zero production/development findings. |
| Container audit | Gate passed: zero high/critical, 15 medium and 7 low with the dated applicability/residual-risk review. This is not a vulnerability-free claim. |
| Installation ZIP and live journey | Passed from the extracted ZIP: live key verification, US services, 45-minute comedy, watch-options HTTP, preview, save, episode persistence, personal-only export, replace restore and metadata refresh with progress preserved, demo isolation, and key/library persistence after container recreation. The live pick was Ted Lasso, 33 minutes; this verifies mechanics, not a universal tone or availability guarantee. |
| Secret review | Gitleaks 8.30.1 found no detected secrets in all local Git refs (16 commits at scan time) or the prepared source tree. Reports are redacted. |
| Release configuration | Passed. Publication check intentionally remains blocked until GitHub private reporting is enabled. |
| GitHub checks for application commit `a8bcbf8` | All six checks passed across the [branch run](https://github.com/mgelsinger/watch-it/actions/runs/35523173680) and [PR run](https://github.com/mgelsinger/watch-it/actions/runs/35523176994), including Windows/Linux and the tested installation ZIP. Later documentation commits have their own check results on the PR. |
| Existing personal installation upgrade | Completed with owner authorization after the release tests. A full stopped-volume backup, consistent database snapshot, portable export, original image and private configuration were saved outside the repository. An isolated restored copy passed migration first. The actual upgrade preserved personal-data fingerprints, settings, credentials and network access; database integrity, desktop/mobile checks and a fresh export passed. Provider-removed unwatched episode entries can lack fresh descriptions; watched history was preserved. |

The final local tested image is `sha256:27c12ae147fb4a183f3d8c4e400f795bc604764f1a53db37875acf6682f49c1c`. Machine-readable reports and the candidate ZIP are in ignored `artifacts/`; CI retains its own exact tested image and reports. Use the final tagged CI artifact for publication. Earlier records in [PUBLIC_READINESS.md](PUBLIC_READINESS.md) and [RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md) are historical.

Release tests use disposable installations. The opt-in live journey reads the existing TMDB key only for normal provider requests, without printing it or recording a trace. The subsequent owner-authorized personal upgrade is recorded separately above. Its backup files, credentials, viewing history, counts and local configuration are not committed or included in release artifacts.

## Final publication decisions

No paid service, public deployment, announcement, repository visibility change, merge or release publication is included in this preparation.

1. Review PR #1 and its latest passing checks, including the MIT license and the retention/backup change. Approve and merge the reviewed commit. The GitHub project homepage will then show the updated README and application. Remove the temporary preview-branch notices from README and INSTALL when `main` contains this candidate.
2. Explicitly approve public visibility for the repository, including its Git history and collaboration records.
3. Once public, enable GitHub private vulnerability reporting in repository security settings. Verify the Report a vulnerability form and enable maintainer security notifications. The release workflow verifies the API reports it enabled.
4. Update the README and security policy's publication-status wording to match the actual public state. Check README, source ZIP, sample demo, Issues and security-report links while signed out. They cannot be verified as public while this private branch is unmerged.
5. Approve the version tag (currently `v1.0.0`), configure the GitHub `release` environment's review policy, run the release workflow from that tag, and inspect its draft ZIP/checksums/notes. The workflow reruns checks and packages the image it tested. Explicitly approve publishing that release. A downloadable ZIP is the recommended first-launch path; no image registry or paid hosting is needed.
6. Finish the [existing announcement draft](ANNOUNCEMENT_DRAFT.md) for the blog, replace the conditional download wording with the published release link, and verify its links and screenshots. Publish only after readers can reach the repository and download. The post is the final announcement, not a substitute for the publication steps above.

The recommendation is to launch this self-hosted version first. ARM/Apple Silicon, Safari/Firefox, physical-phone testing, a hosted sample URL, richer mood matching and hosted private accounts are optional follow-up work. None justifies exposing the current shared-library installation as a multi-user community service.
