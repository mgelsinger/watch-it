# Data and privacy

Each installation stores its own library, ratings, watched episodes, notes, recommendations, preferences, cached metadata, images, hashed sessions, and salted installation credential fingerprint in SQLite or local files. There is no telemetry, hosted account, automatic bug-report upload, or shared user database.

The server sends search terms and title/provider/region identifiers to TMDB, ratings lookups to OMDb if configured, and schedule/date/country requests to TVmaze. Image requests go to TMDB's image service. Each provider sees the installation server's public network address and API credentials where required. The application does not send personal notes or watched-history records as telemetry; title lookups can still reveal viewing interests to upstream providers.

External source, cast-image, and watch-options links/images may connect your browser directly to the named provider. That provider can see your browser's public address and normal request metadata. Its own privacy policy applies.

API keys can be pasted into Settings and verified directly with their provider. App-entered keys are stored in `credentials.json` in the data directory, outside SQLite, with mode 600 in Linux containers. They are not encrypted on disk. Environment keys take precedence and remain supported. The optional installation password comes from environment configuration. Everyone with access to the shared installation can change its library and app-managed keys. Use a trusted device and HTTPS for network access.

Session cookies are HttpOnly and SameSite Strict, with Secure enabled by operator configuration for HTTPS. Theme selection stays in browser local storage. Version 3 profile backups contain title/episode identity references, personal library information and preferences, without provider descriptions or artwork, but omit API keys, session tokens, and credential fingerprints. Keys are not returned by Settings or diagnostics. Full database snapshots include installation/session state; full volume copies also include the credential file. Keep both private. A fresh profile restore requires entering keys again.

The standalone `/demo/` page has fictional titles, offers and progress. It uses temporary browser memory, no API requests, no storage or cookies, and no installation data. Resetting or closing it discards changes. Opening its documentation link connects to GitHub.

Application logs record request paths, response/error status, and refresh activity. Standard request logging omits query strings, cookies, authorization headers, and response session cookies. Operators control log and backup storage/retention. Support diagnostics omit library contents, notes, database paths, and credentials. Sharing a report is a manual user action.

Export and restore are available in Settings. See [operations](OPERATIONS.md) for preserving or removing local data. Metadata and artwork remain subject to the providers' licenses, described in [credits](ATTRIBUTION.md) and the About page.

Provider metadata expires separately from personal progress. See the [retention policy](OPERATIONS.md#provider-data-and-personal-history) for managed backup limits, legacy exports, and recovery after a long offline period.
