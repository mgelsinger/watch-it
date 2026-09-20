# Hosted community beta proposal

**Deferred.** The owner chose a self-hosting-first community launch on September 20, 2026. This proposal is reference material for a later decision. No hosted implementation, account infrastructure or spending is authorized by that launch scope.

Status: implementation proposal only, reviewed September 20, 2026. No account system, hosted private libraries, infrastructure or paid service has been created. Self-hosting remains supported. Resolve the self-hosted release gates and offer the static sample first, then decide whether demand justifies this work. This revision replaces the earlier bring-your-own-key beta proposal: ordinary hosted users should not need provider accounts or API keys.

## Smallest sensible beta

An invite-only beta for 10-25 individuals, one private library per account, one deployment region, one Node service behind HTTPS, and a single VM with a persistent local disk. Keep SQLite initially: a small control database for accounts/invitations/sessions and shared provider budgets, plus one private library database per account. Use operator-managed TMDB credentials and omit OMDb initially. Keep library databases on local disk, not network storage. Bound the number of open connections and background work. Do not run a public instance of the current shared-library application and call it multi-user.

The isolated database design reuses the current schema and portable profile format and limits the migration scope. It is a recommendation for a small beta, not a scaling claim. Compared with adding `user_id` to every existing table, it avoids having every query discriminate personal rows, but makes account routing, background jobs and per-account files critical authorization boundaries. A single process still requires strict request context. At higher concurrency or multiple replicas, evaluate PostgreSQL with tenant columns, composite constraints and row-level security; do not point multiple nodes at SQLite files on shared storage.

## Why adding login is insufficient

Today `server/src/db.ts` holds a process-global database handle, and `config.ts` holds installation-wide settings. Authentication accepts one installation password. All authenticated callers can change all titles, settings and keys. The current API, jobs, caches and backup operations have no owner context.

| Existing data or operation | Required hosted change |
| --- | --- |
| `user_state`, ratings, notes, saved lists | Belong to one account's private library; derive owner from the verified server session. |
| `episodes.watched_at` alongside episode metadata | Keep owner-scoped. Separate watched markers from expiring episode metadata so provider expiry never deletes personal progress. |
| `my_services`, `settings`, region | Per account. No process-global region or preferences. |
| Provider credentials and quota counters | Operator-only secrets; atomic global counters for the shared key, with per-account usage accounting and fairness. A separate 900/day counter in every private database would exceed one shared OMDb allowance. |
| `suggestion_log`, suppressions, `events.seen` | Private per-account recommendation history and read state. |
| `titles`, seasons, cast, availability, provider checks, raw caches | Keep per account initially, even if some metadata could later be shared. Cache keys, in-flight request sharing and file paths must include the account context. Never share credential-bearing URLs, private failures or recommendation history. |
| `getDb()`, filesystem operations, imports, exports, images | Replace the singleton with a server-created account context. Derive paths from server-generated opaque IDs, never a user-supplied path. Fail closed without a context. Protect every route, including image access if it reveals viewing interests. |
| Sync, cron, refresh and maintenance state | Enumerate accounts through a controlled worker queue; run each job inside its owner context. Per-user cancellation, fairness, concurrency and deletion checks. |
| Sessions and installation password | Account-specific sessions with expiry, rotation and revocation; invitation acceptance and recovery. Separate operator access from user permissions. |

Prefer a maintained identity provider for verified email sign-in and recovery, or a mature authentication library. Regardless of choice, authorization must cover every read and write. An account ID in a URL or token supplied by a client is never enough to choose a database. CSRF defenses, HTTPS-only secure cookies, login throttling, invitation limits and session revocation remain required. Do not grant a common installation password to unrelated beta users.

## Onboarding without user API keys

After accepting an invitation and signing in, show three short steps:

1. **Choose country and subscriptions.** A country selector followed by searchable services, with channel variants named separately. Never request streaming-service passwords.
2. **Get a first pick.** Offer 45 minutes, TV or Either, and Light / comedy; show the same runtime, genre and provider evidence as self-hosting. Provider outages say to retry later and notify the operator, not to obtain a personal API key.
3. **Save and keep your place.** Save a title to the private library and mark episodes watched. Offer an optional import of an existing Watch It profile. Explain exports and deletion in Settings.

TMDB supports application authentication; the reviewed public documentation does not require every end user of an application to obtain a separate developer key. Register the operator's actual hosted application and settle its applicable terms before invitations. Do not distribute the operator credential in the browser, downloadable Docker bundle, sample demo, exports or per-user databases. Self-hosters continue using their own installation key. Only add user-owned credentials if a provider specifically requires them for the chosen integration, with a documented reason; do not use multiple user keys to evade quotas. Sources and unresolved terms are in the [provider review](PROVIDERS.md).

Keep application credentials in an operator secret store or restricted secret mount outside library databases, images and profile backups. Encrypt persisted credentials and manage the wrapping key separately. Prefer TMDB's supported Bearer header in the hosted adapter, redact all credentials from logs, and document rotation, revocation and recovery. Only audited operator actions may replace keys. Block hosted access to today's installation key-management routes at the server, not just in the UI. The current protected but unencrypted self-hosted credential file is not the hosted design. If user credentials become required later, use owner-scoped authenticated encryption and deletion without exposing plaintext to the browser.

Use TMDB scores for the first beta. OMDb is optional and its public content license is non-commercial; a paid quota does not establish commercial rights. Resolve hosted use, attribution, caching and any commercial agreement before enabling it with an operator key. TVmaze's public API needs no key but has attribution, ShareAlike and rate-limit obligations. No provider permission or commercial price has been obtained by this review.

## Ownership, recovery and deletion

Users control their personal titles, notes and viewing history; provider metadata and artwork retain their providers' terms. Publish a plain privacy notice describing operator access, provider requests, retention, hosting region and support contact. Do not promise end-to-end privacy: the operator can access the server-side library. Separate durable user records from expiring provider metadata and rehydrate metadata after imports; apply provider retention deadlines to live data, exports, caches and backup restore. The current combined title/episode schema does not fully provide this separation.

Keep the portable `.watchit.json` export/import compatible with self-hosting. A hosted export contains only the signed-in user's library, never account credentials, sessions or another user's records. Restore into that same user's context; preview and confirm merge or replace. Source owner identifiers must not redirect ownership during import. Limit file size, title count and restore work.

Take consistent per-database SQLite backups using its backup API, including committed WAL state, and encrypt copies off-host. Proposed target: daily backups, 24-hour recovery point, restore within one working day during beta, seven daily copies and up to 30 days total retention. Back up the account registry consistently with its library mapping; recover shared application credentials through the separate operator secret store. Store backup encryption recovery material separately. Alert on backup failures and test a full restore before invitations, then monthly. Same-disk copies alone do not satisfy this plan.

Provide account deletion in Settings with reauthentication, a clear summary and confirmation. Immediately revoke sessions, disable the account, cancel queued jobs and prevent new writes. Remove the library database and WAL/SHM files, that account's cached images, account-specific tokens and active exports. Never delete the shared operator provider credential when deleting a user. Delete personal account identifiers according to the stated policy. Keep a minimal deletion record that can be applied before a restored backup is served; otherwise a restore can resurrect a deleted account. Explain the backup expiry window (proposed maximum 30 days), any required security-log retention, and upstream-provider data outside the app's control. Test deletion during an active refresh and restore, not just when idle.

## Proposed beta limits and gates

Start with 25 invitation slots, 500 saved titles per account, one refresh per account per six hours, one active recommendation request per account, and an initial interactive request budget of 30/minute with a bounded global queue. These are starting controls to load-test, not measured capacity. Start upstream limits conservatively at 5 TMDB requests/second and 1 TVmaze request/second across the entire deployment; honor 429 and Retry-After with bounded backoff. If OMDb is later enabled, cap its shared key at 900/day total including validation and jobs, then allocate fair per-user budgets within that ceiling. Stagger daily jobs, cap image storage and import size, and stop accepting new invitations before storage or queues are saturated. Separate expensive operation limits from ordinary page requests. No open registration, billing, social graph, recommendations generated by an LLM, or automatic video downloads are needed.

Planning workload: 25 people making 10 picks/day at an assumed 10-30 upstream requests per cold pick implies 2,500-7,500 TMDB requests/day, before browse, imports and refreshes. Measure actual calls and cache hits before setting invitation capacity; API rate guidance is not a guaranteed allowance. At the 12,500-title storage cap, refreshing every title daily without deduplication would dominate traffic. Prioritize actively watched titles and enforce global job budgets.

Before invites: two-account negative tests for every route and ID, export/import and filesystem access; forged/stale/revoked session tests; account-context propagation in every async job and shared cache; key rotation and recovery; disk-full behavior; per-user throttling and fairness; restore and deletion rehearsal; load testing against mocked providers plus a small permitted live check; and a review of logs, backup artifacts and support access. Test self-hosting and migration from existing exports alongside hosted changes.

## Development and operating estimate

Planning estimate for one developer familiar with this code, including review and testing, not a delivery commitment:

| Work | Hours |
| --- | ---: |
| Account/session model, invitations, onboarding and recovery | 24-40 |
| Remove global database/config assumptions; scope routes, jobs and files | 40-60 |
| Encrypted credentials, quotas and request fairness | 20-32 |
| Private export/import, backup/restore and account deletion | 24-40 |
| Provider retention separation, expiry and import rehydration | 16-32 |
| Isolation tests, deployment, load testing and beta runbook | 32-48 |
| **Total** | **156-252 hours, roughly 4-7 focused weeks** |

A reference budget for modest usage is a 2 GiB Linux VM ($12/month), daily VM backups ($3.60/month), separate object storage (from $5/month), plus domain, transactional email and monitoring. Budget **$25-40/month initially**, excluding developer/support time, taxes, paid identity plans and any provider licensing. Upgrade to 4 GiB if measurements require it; that VM is $24/month. These are estimates, not a purchased configuration or a capacity guarantee. Reference prices rechecked September 20, 2026: [DigitalOcean basic VM pricing](https://www.digitalocean.com/pricing/droplets), [daily backups at 30%](https://docs.digitalocean.com/products/backups/details/pricing/), [object storage pricing](https://www.digitalocean.com/pricing/spaces-object-storage). The quote is a concrete benchmark, not a requirement to use that vendor. Account-application/provider approvals and email deliverability can add calendar time. There is no verified commercial API quote, so a commercial beta's total cost is unresolved.

Allow an initial 2-4 operator hours a week for invites, support, failed provider calls, updates and restore drills, then measure the actual burden. There is no video bandwidth bill because the product never serves video. Posters, application traffic, backups and provider calls still consume resources. A single VM means maintenance downtime and no high-availability promise.

## Owner decisions before implementation

Approve whether to build the beta at all, the invitation cap and target audience, hosting region and monthly budget, sign-in/recovery method, privacy/support owner and retention commitments, and provider-term suitability for the intended use. Decide how long the beta will run and what evidence warrants expansion. Keep the current Docker path and portable exports supported regardless. Repository visibility, releasing software and buying infrastructure remain separate explicit decisions.
