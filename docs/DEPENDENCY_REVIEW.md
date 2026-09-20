# Dependency and container review

## September 20 applicability review

The refreshed scan reports 15 medium and 7 low findings with zero high/critical findings. Application dependency audits have zero findings. The two newly classified medium findings are now reviewed for the shipped self-hosted container:

| Finding | Evidence and disposition |
| --- | --- |
| CVE-2026-8674 | Reproduced in the prior pinned image: a 256-, 300-, or 1,024-character `LOCALDOMAIN` search domain causes glibc's `resolv_conf_matches` assertion to abort Node; shorter examples did not. The Linux startup launcher now sets `LOCALDOMAIN=.` before loading the app, overriding both inherited environment suffixes and resolver search lists. Watch It contacts fully qualified provider hosts. The Docker smoke check injects an overflowing domain, loads the actual guard, verifies the override, and resolves TMDB successfully. Accept with this mitigation for the supplied launcher; custom entrypoints that bypass it require a new review. The underlying package remains vulnerable and must be updated when a stable vendor fix is available. [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-8674), [upstream advisory](https://www.openwall.com/lists/oss-security/2026/09/17/4). |
| CVE-2026-89092 | Requires nscd. The runtime has neither `/usr/sbin/nscd` nor `/var/run/nscd/socket`; the Docker check now asserts both. Accepted as not applicable to the supplied container. This says nothing about the host or customized images. [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-89092). |

Both findings remain visible in the full scan and the scoped reviewed list. The October 10 review deadline and all high/critical/new-medium blocking rules remain. The earlier residual findings below are not represented as fixed or vulnerability-free. This is the launch preparation's technical applicability review under the existing self-hosted release policy.

## Earlier accepted platform review

Reviewed September 10, 2026. Owner: repository maintainers. Review again by October 10, 2026, or before the next release, whichever comes first.

The application dependency audit is clear for both production-only and all installed dependencies. The upgrade covers Fastify 5.12.3, `@fastify/static` 10.1.3, node-cron 4.6.0, React Router 7.18.3, Vite 7.3.6, their compatible integrations, and transitive fixes. The committed lockfile records exact resolutions. Only the reviewed better-sqlite3 and esbuild lifecycle scripts are approved for npm 12. Clean installation is also checked with the Node 22 bundled npm.

The previous findings involved static-file path guards, URI/router handling, cron's old UUID dependency, browser navigation, and build tooling. The implementation upgrades those packages instead of relying on reachability exceptions. Regression checks cover route guards, SPA fallback, navigation, scheduled-job start/stop, and clean builds. Primary references: [Fastify static compatibility](https://github.com/fastify/fastify-static), [node-cron migration](https://www.nodecron.com/migrating-from-v3.html), and [Vite migration](https://v7.vite.dev/guide/migration).

The original Debian 12 Node runtime image included unused package-management and system utilities with high/critical findings. The replacement [distroless Node 22 Debian 13 image](https://github.com/GoogleContainerTools/distroless) contains the runtime and required libraries without those tools. Its scan has no high/critical findings. Do not report it as vulnerability-free: the September 10 scan also reports 13 medium and 7 low package findings in glibc/zlib, without a vendor fix in this base.

## Remaining platform findings

| Package / IDs | Applicability and disposition |
|---|---|
| glibc: CVE-2026-18374, CVE-2026-19499, CVE-2026-19542, CVE-2026-5450, CVE-2026-5928 | File modes, currency formatting, tree deletion, scanf and wide-character handling. Application inputs do not directly select these native formats/functions. Native runtime reachability is not fully proven absent. Retain as residual platform findings; update the base when fixes arrive. |
| glibc: CVE-2026-5435, CVE-2026-6238 | DNS parsing. Outbound provider lookups make resolver behavior relevant. Fixed upstream hostnames, bounded HTTP work, local binding and non-root execution reduce exposure/impact but do not repair glibc. Keep these as open platform risks and track the vendor update. |
| glibc: CVE-2026-6368, CVE-2026-6791, CVE-2026-77117, CVE-2026-80489 | Word/tilde expansion and character conversion. The runtime has no shell, and the app does not accept arbitrary conversion formats or invoke wordexp. Keep the findings recorded; no blanket claim that native dependencies cannot reach them. |
| zlib: CVE-2026-27171, CVE-2026-85091 | CRC combination and compression processing. HTTP processing can involve compression, so this remains a platform concern. Response limits and request deadlines bound application work but are not a replacement for a library fix. Track the base-image update. |
| glibc low severity: CVE-2010-4756, CVE-2018-20796, CVE-2019-1010022, CVE-2019-1010023, CVE-2019-1010024, CVE-2019-1010025, CVE-2019-9192 | Platform glob/regex, executable inspection, memory layout and disclosure findings. No app feature runs untrusted executables or exposes native regex/ldd. Keep these in the full report and refresh with each candidate. |

The report at `artifacts/container-audit.json` includes scanner descriptions, installed package versions, vendor status and advisory links for each entry. CI retains that full report with the tested artifact. This review accepts medium/low residual platform exposure for a local single-user candidate; it does not certify arbitrary internet exposure. It cannot waive a high/critical finding. New medium findings or an expired review fail the scanner gate, as do scanner/database errors.

## Release policy

September 11 community-candidate refresh: the scanner reports the same 13 medium and 7 low entries plus `CVE-2026-89092` with unknown severity for `libc6`. The advisory describes nscd processing malicious DNS responses. Inspection of the candidate confirmed no `/usr/sbin/nscd` binary or `/var/run/nscd/socket`; the application runs Node, not an nscd service. Retain the entry in the report and track vendor classification/fixes rather than treating unknown severity as zero risk. This observation is scoped to the shipped container, not the Docker host or a future modified image. Upstream advisory: [GLIBC-SA-2026-0016](https://sourceware.org/git/?p=glibc.git;a=blob_plain;f=advisories/GLIBC-SA-2026-0016). The existing review deadline still applies.

`npm run audit:release` fails on any application dependency advisory. `node scripts/scan-image.mjs IMAGE` scans the exact image archive, rejects every high/critical finding, and requires a current reviewed entry for medium findings. Run both again for the final candidate. A clean audit alone is not a security guarantee.
