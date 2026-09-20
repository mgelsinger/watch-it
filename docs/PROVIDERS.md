# Provider requirements for launch

Reviewed September 20, 2026 against the linked official sources. This is an implementation review, not provider approval. The actual application agreement and intended use must be checked before operating a hosted beta or charging for it. No providers were contacted and no agreements were accepted in this review.

| Provider | Credentials, quotas and attribution | Hosted option (deferred) |
| --- | --- | --- |
| TMDB metadata and artwork | Application API key or Bearer token. Developer access is offered for non-commercial use with approved logo and notice. Commercial use needs a separate written agreement; no verified public quote. Current guidance describes an approximate 40 requests/second upper limit that can change; handle 429, not a promised quota. | Operator registers the real hosted application and keeps its credential server-side. Users choose country/services without a TMDB account. Confirm the use and agreement before invites. |
| JustWatch availability through TMDB | The watch-provider endpoint requires JustWatch attribution. It supplies regional offers and a TMDB page URL, not full provider deep links or episode/audio guarantees. | Keep the existing TMDB watch-options path and JustWatch credit. No separate end-user key is described for this endpoint. A direct JustWatch API would be a separate agreement and is outside this proposal. |
| OMDb optional ratings | Free keys advertise 1,000 requests/day. Public content uses CC BY-NC 4.0. Paid quota or patron access must not be assumed to grant commercial reuse. | Omit for the smallest beta. If added, verify the intended hosted use/rights and use one operator key with a global budget, not 1,000 requests per user. |
| TVmaze schedules | Public API needs no key. CC BY-SA 4.0 permits use subject to attribution and ShareAlike. Rate guidance: at least 20 calls/10 seconds per IP, with possible stricter limits and 429 backoff. | Retain source/license links and provenance for redistributed schedule data. Enforce a deployment-wide limiter. The premium user API is not needed. |

Sources: [TMDB application authentication](https://developer.themoviedb.org/docs/authentication-application), [TMDB FAQ and attribution](https://developer.themoviedb.org/docs/faq), [TMDB rate limits](https://developer.themoviedb.org/docs/rate-limiting), [TMDB provider endpoint](https://developer.themoviedb.org/reference/tv-series-watch-providers), [OMDb license](https://www.omdbapi.com/), [OMDb quota](https://www.omdbapi.com/apikey.aspx), [TVmaze licensing and limits](https://www.tvmaze.com/api).

## Self-hosted retention review

The [TMDB API terms](https://www.themoviedb.org/api-terms-of-use), reviewed September 20, restrict cached information beyond six months and require purging provider content on termination. They also require a written commercial agreement and restrict ML/AI use. Watch It's ranking uses deterministic catalog scoring, not an LLM or trained model.

The self-hosted implementation now separates durable personal history from expiring provider content:

- Saved title identities, user lists, notes, personal ratings and watched episode identities/dates remain. Descriptive title, season and episode fields expire after 90 days without a refresh. Seasons, episodes, cast and release dates have independent fetch timestamps, so partial refresh failures cannot extend unrelated old data. Cast, release dates, offers and provider-check links expire after 90 days. Missing legacy child timestamps are treated as unknown, not newly fetched.
- Raw API responses and provider-derived event payloads expire after 30 days. Offline fallback cannot return an API cache entry older than 30 days. Images are capped at 90 days and checked again before serving. Startup and daily maintenance apply expiry even without a valid API key. A stopped installation is cleaned on its next start.
- Version 3 exports contain personal state and identity references, not provider descriptions/artwork/cast/offers/events. Imports of older formats discard provider content while preserving progress. A normal refresh retrieves metadata afterward; merge retains fresh local details.
- Managed recovery snapshots, rollback database files and scheduled/safety backups expire after 30 days. Ordinary exported files are not deleted. External old exports/full-volume copies remain the operator's responsibility. The operations guide explains replacing these with personal-only exports and purging provider content when access terminates.

These conservative windows leave room for copied cache/event/recovery data within the six-month ceiling. SQLite secure deletion is enabled for the active database; storage snapshots and outside copies are not under the app's control. Personal title/episode/provider identity references are retained to make history portable. This implementation review does not represent provider permission or a legal certification. Operators must accept and follow the agreement applicable to their own key and use.

Regression coverage includes expired metadata with preserved progress, independently expired child records, refusing overly old offline responses, personal-only exports, legacy imports, merge protection, and restricted recovery-file cleanup. [Operator instructions](OPERATIONS.md#provider-data-and-personal-history).

## Attribution and rights follow the data

The app already credits TMDB and JustWatch and includes TMDB's approved logo and API-terms notice. About now also links OMDb's and TVmaze's content licenses and explains display formatting. The application code license does not license provider posters, metadata or ratings. Keep attribution and applicable share-alike information with any redistributed provider dataset or export; user notes and watch progress need a distinct ownership treatment. The About page and README use the notice in the reviewed API terms. Recheck terms before changing the use or introducing charges.

The sample demo avoids these dependencies: fictional titles and artwork, temporary browser memory, no provider requests. The real-app screenshots remain dated illustrations with provider credits, not current availability promises.
