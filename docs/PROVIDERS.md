# Provider requirements for launch

Reviewed September 20, 2026 against the linked official sources. This is an implementation review, not provider approval. The actual application agreement and intended use must be checked before operating a hosted beta or charging for it. No providers were contacted and no agreements were accepted in this review.

| Provider | Credentials, quotas and attribution | Hosted recommendation |
| --- | --- | --- |
| TMDB metadata and artwork | Application API key or Bearer token. Developer access is offered for non-commercial use with approved logo and notice. Commercial use needs a separate written agreement; no verified public quote. Current guidance describes an approximate 40 requests/second upper limit that can change; handle 429, not a promised quota. | Operator registers the real hosted application and keeps its credential server-side. Users choose country/services without a TMDB account. Confirm the use and agreement before invites. |
| JustWatch availability through TMDB | The watch-provider endpoint requires JustWatch attribution. It supplies regional offers and a TMDB page URL, not full provider deep links or episode/audio guarantees. | Keep the existing TMDB watch-options path and JustWatch credit. No separate end-user key is described for this endpoint. A direct JustWatch API would be a separate agreement and is outside this proposal. |
| OMDb optional ratings | Free keys advertise 1,000 requests/day. Public content uses CC BY-NC 4.0. Paid quota or patron access must not be assumed to grant commercial reuse. | Omit for the smallest beta. If added, verify the intended hosted use/rights and use one operator key with a global budget, not 1,000 requests per user. |
| TVmaze schedules | Public API needs no key. CC BY-SA 4.0 permits use subject to attribution and ShareAlike. Rate guidance: at least 20 calls/10 seconds per IP, with possible stricter limits and 429 backoff. | Retain source/license links and provenance for redistributed schedule data. Enforce a deployment-wide limiter. The premium user API is not needed. |

Sources: [TMDB application authentication](https://developer.themoviedb.org/docs/authentication-application), [TMDB FAQ and attribution](https://developer.themoviedb.org/docs/faq), [TMDB rate limits](https://developer.themoviedb.org/docs/rate-limiting), [TMDB provider endpoint](https://developer.themoviedb.org/reference/tv-series-watch-providers), [OMDb license](https://www.omdbapi.com/), [OMDb quota](https://www.omdbapi.com/apikey.aspx), [TVmaze licensing and limits](https://www.tvmaze.com/api).

## Retention is an unresolved release item

The [TMDB API terms](https://www.themoviedb.org/api-terms-of-use), read directly in the browser, restrict caching information beyond six months and require purging TMDB content when access terminates. They also require a written commercial agreement and restrict ML/AI use. Watch It's current ranking is deterministic catalog scoring, not an LLM or trained recommendation model. Do not add an AI recommendation claim or integration without reviewing these terms.

Code review found that raw API cache and unsaved previews are pruned after 30 days, and images default to 90 days. However, image retention can be configured as high as 3,650 days, saved title/episode/provider fields and historical events can persist indefinitely, and profile exports include provider metadata without a provider expiry policy. Routine refreshes do not cover every failure, dormant installation or old export. These defaults do not establish complete compliance with a six-month limit.

Before calling the public release ready, resolve the treatment of persisted library metadata and portable backups under the applicable agreement. The implementation option is to separate user history/notes/ratings from provider payloads, expire or refresh provider content within the permitted period, preserve personal history when refresh fails, and rehydrate metadata on import without treating an old timestamp as fresh. Apply the same rules at startup after a long offline period, to cached images, and when restoring backups. Do not automatically erase users' watch history to solve this. Alternatively obtain explicit provider permission covering the intended retention. This review does not invent that permission or run a destructive migration.

This issue applies to the self-hosted data model as well as a hosted beta. Publication of application source and operation of a provider-backed service are distinct, but the distribution should not promise readiness while this known behavior remains unresolved. Add the selected retention behavior to regression tests and installation/backup documentation before clearing the release item.

## Attribution and rights follow the data

The app already credits TMDB and JustWatch and includes TMDB's approved logo and FAQ notice. About now also links OMDb's and TVmaze's content licenses and explains display formatting. The application code license does not license provider posters, metadata or ratings. Keep attribution and applicable share-alike information with any redistributed provider dataset or export; user notes and watch progress need a distinct ownership treatment. Review the exact notice in the applicable TMDB agreement as part of final provider sign-off.

The sample demo avoids these dependencies: fictional titles and artwork, temporary browser memory, no provider requests. The real-app screenshots remain dated illustrations with provider credits, not current availability promises.
