# Hosted community beta proposal

Status: implementation proposal only, September 11, 2026. No account system, hosted private libraries, infrastructure or paid service has been created. Self-hosting remains supported. Publish the self-hosted release and static sample first, then decide whether demand justifies this work.

## Smallest sensible beta

An invite-only beta for 10-25 individuals, one private library per account, one deployment region, one Node service behind HTTPS, and a single VM with a persistent local disk. Keep SQLite initially: a small control database for accounts/invitations/sessions plus one private library database and credential store per account. Keep library databases on local disk, not network storage. Bound the number of open connections and background work. Do not run a public instance of the current shared-library application and call it multi-user.

The isolated database design reuses the current schema and portable profile format and limits the migration scope. It is a recommendation for a small beta, not a scaling claim. Compared with adding `user_id` to every existing table, it avoids having every query discriminate personal rows, but makes account routing, background jobs and per-account files critical authorization boundaries. A single process still requires strict request context. At higher concurrency or multiple replicas, evaluate PostgreSQL with tenant columns, composite constraints and row-level security; do not point multiple nodes at SQLite files on shared storage.

## Why adding login is insufficient

Today `server/src/db.ts` holds a process-global database handle, and `config.ts` holds installation-wide settings. Authentication accepts one installation password. All authenticated callers can change all titles, settings and keys. The current API, jobs, caches and backup operations have no owner context.

| Existing data or operation | Required hosted change |
| --- | --- |
| `user_state`, ratings, notes, saved lists | Belong to one account's private library; derive owner from the verified server session. |
| `episodes.watched_at` alongside episode metadata | Remain in the owner's database initially. If metadata is shared later, move progress to a separate owner-scoped table. |
| `my_services`, `settings`, region, OMDb counters | Per account. No process-global region, preferences or quota counter. |
| `suggestion_log`, suppressions, `events.seen` | Private per-account recommendation history and read state. |
| `titles`, seasons, cast, availability, provider checks, raw caches | Keep per account initially, even if some metadata could later be shared. Cache keys, in-flight request sharing and file paths must include the account context. Never share credential-bearing URLs, private failures or recommendation history. |
| `getDb()`, filesystem operations, imports, exports, images | Replace the singleton with a server-created account context. Derive paths from server-generated opaque IDs, never a user-supplied path. Fail closed without a context. Protect every route, including image access if it reveals viewing interests. |
| Sync, cron, refresh and maintenance state | Enumerate accounts through a controlled worker queue; run each job inside its owner context. Per-user cancellation, fairness, concurrency and deletion checks. |
| Sessions and installation password | Account-specific sessions with expiry, rotation and revocation; invitation acceptance and recovery. Separate operator access from user permissions. |

Prefer a maintained identity provider for verified email sign-in and recovery, or a mature authentication library. Regardless of choice, authorization must cover every read and write. An account ID in a URL or token supplied by a client is never enough to choose a database. CSRF defenses, HTTPS-only secure cookies, login throttling, invitation limits and session revocation remain required. Do not grant a common installation password to unrelated beta users.

## Simple bring-your-own-key onboarding

After accepting an invitation and signing in, show three short steps:

1. **Connect TMDB (required).** A button opens [TMDB API settings](https://www.themoviedb.org/settings/api). Explain: sign up or sign in, apply for API access for the intended use, copy the 32-character **API Key**, return to the field labeled **TMDB API key**, and select **Verify and save TMDB key**. Do not request their TMDB password or Read Access Token. Preserve progress while the user visits TMDB. Show actionable invalid-key, provider-outage and quota states.
2. **Choose country and subscriptions.** A country selector followed by searchable services, with channel variants named separately. Continue directly to a 45-minute Pick For Me example.
3. **Extra ratings (optional).** Link to [OMDb key registration](https://www.omdbapi.com/apikey.aspx), explain the activation email, and offer **OMDb API key** plus **Verify and save OMDb key**. Include a prominent **Skip for now**. TVmaze needs no user key. Never request streaming-service passwords.

These field names are already implemented for self-hosting in this candidate. Hosted onboarding must use owner-scoped storage and authorization before reusing them. A real-user key must never be used for a public sample demo or another account. API keys are credentials, not proof of a streaming subscription.

Store hosted keys encrypted at rest with a versioned authenticated-encryption envelope, random nonces and the account ID bound as additional authenticated data. Keep the wrapping key in an operator secret store outside database and backup archives. Document rotation, recovery and separation of duties. Decrypt only for a server-to-provider request. Never return existing keys, put them in URLs sent to browsers, include them in logs, or export them in profiles. Allow verification, replacement and removal. Failed verification keeps the old key. Access to a hosted user's key must require that user's session or narrowly audited operational access. The current protected but unencrypted self-hosted credential file is not the hosted design.

TMDB documents account-based applications, non-commercial attribution conditions and separate commercial access. Bringing individual keys does not by itself establish that a public hosted deployment meets provider terms. Confirm the actual hosted use, storage and attribution requirements before beta invitations; if monetizing, resolve commercial access first. Sources: [TMDB FAQ](https://developer.themoviedb.org/docs/faq), [TMDB application authentication](https://developer.themoviedb.org/docs/authentication-application). OMDb currently advertises a free 1,000-request daily allowance; show the app's own remaining budget as an estimate because the same key may be used elsewhere. [OMDb key page](https://www.omdbapi.com/apikey.aspx).

## Ownership, recovery and deletion

Users control their personal titles, notes and viewing history; provider metadata and artwork retain their providers' terms. Publish a plain privacy notice describing operator access, provider requests, retention, hosting region and support contact. Do not promise end-to-end privacy: the server must read user keys to call providers.

Keep the portable `.watchit.json` export/import compatible with self-hosting. A hosted export contains only the signed-in user's library, never account credentials, sessions or another user's records. Restore into that same user's context; preview and confirm merge or replace. Source owner identifiers must not redirect ownership during import. Limit file size, title count and restore work.

Take consistent per-database SQLite backups using its backup API, including committed WAL state, and encrypt copies off-host. Proposed target: daily backups, 24-hour recovery point, restore within one working day during beta, seven daily copies and up to 30 days total retention. Back up the account registry consistently with its library mapping and encrypted credential stores; store encryption recovery material separately. Alert on backup failures and test a full restore before invitations, then monthly. Same-disk copies alone do not satisfy this plan.

Provide account deletion in Settings with reauthentication, a clear summary and confirmation. Immediately revoke sessions, disable the account, cancel queued jobs and prevent new writes. Remove the library database and WAL/SHM files, cached images, credential ciphertext and active exports. Delete personal account identifiers according to the stated policy. Keep a minimal deletion record that can be applied before a restored backup is served; otherwise a restore can resurrect a deleted account. Explain the backup expiry window (proposed maximum 30 days), any required security-log retention, and upstream-provider data outside the app's control. Test deletion during an active refresh and restore, not just when idle.

## Proposed beta limits and gates

Start with 25 invitation slots, 500 saved titles per account, one refresh per account per six hours, one active recommendation request per account, and an initial interactive request budget of 30/minute with a bounded global queue. These are starting controls to load-test, not measured capacity. Keep OMDb at a conservative 900/day per key including validation requests, honor provider 429 responses, and expose retry times. Stagger daily jobs, cap image storage and import size, and stop accepting new invitations before storage or queues are saturated. Separate expensive operation limits from ordinary page requests. No open registration, billing, social graph, recommendations generated by an LLM, or automatic video downloads are needed.

Before invites: two-account negative tests for every route and ID, export/import and filesystem access; forged/stale/revoked session tests; account-context propagation in every async job and shared cache; key rotation and recovery; disk-full behavior; per-user throttling and fairness; restore and deletion rehearsal; load testing against mocked providers plus a small permitted live check; and a review of logs, backup artifacts and support access. Test self-hosting and migration from existing exports alongside hosted changes.

## Development and operating estimate

Planning estimate for one developer familiar with this code, including review and testing, not a delivery commitment:

| Work | Hours |
| --- | ---: |
| Account/session model, invitations, onboarding and recovery | 24-40 |
| Remove global database/config assumptions; scope routes, jobs and files | 40-60 |
| Encrypted credentials, quotas and request fairness | 20-32 |
| Private export/import, backup/restore and account deletion | 24-40 |
| Isolation tests, deployment, load testing and beta runbook | 32-48 |
| **Total** | **140-220 hours, roughly 4-6 focused weeks** |

A reference budget for modest usage is a 2 GiB Linux VM ($12/month), daily VM backups ($3.60/month), separate object storage (from $5/month), plus domain, transactional email and monitoring. Budget **$25-40/month initially**, excluding developer/support time, taxes and any provider licensing. Upgrade to 4 GiB if measurements require it; that VM is $24/month. These are estimates, not a purchased configuration or a capacity guarantee. Reference prices checked September 11, 2026: [DigitalOcean basic VM pricing](https://www.digitalocean.com/pricing/droplets), [daily backups at 30%](https://docs.digitalocean.com/products/backups/details/pricing/), [object storage pricing](https://www.digitalocean.com/pricing). The quote is a concrete benchmark, not a requirement to use that vendor. Account-application/provider approvals and email deliverability can add calendar time.

Allow an initial 2-4 operator hours a week for invites, support, failed provider calls, updates and restore drills, then measure the actual burden. There is no video bandwidth bill because the product never serves video. Posters, application traffic, backups and provider calls still consume resources. A single VM means maintenance downtime and no high-availability promise.

## Owner decisions before implementation

Approve whether to build the beta at all, the invitation cap and target audience, hosting region and monthly budget, sign-in/recovery method, privacy/support owner and retention commitments, and provider-term suitability for the intended use. Decide how long the beta will run and what evidence warrants expansion. Keep the current Docker path and portable exports supported regardless. Repository visibility, releasing software and buying infrastructure remain separate explicit decisions.
