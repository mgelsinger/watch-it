# Data and privacy

Each installation stores its own library, ratings, watched episodes, notes, recommendations, preferences, cached metadata, images, hashed sessions, and salted installation credential fingerprint in SQLite or local files. There is no telemetry, hosted account, automatic bug-report upload, or shared user database.

The server sends search terms and title/provider/region identifiers to TMDB, ratings lookups to OMDb if configured, and schedule/date/country requests to TVmaze. Image requests go to TMDB's image service. Each provider sees the installation server's public network address and API credentials where required. The application does not send personal notes or watched-history records as telemetry; title lookups can still reveal viewing interests to upstream providers.

External source, cast-image, and watch-options links/images may connect your browser directly to the named provider. That provider can see your browser's public address and normal request metadata. Its own privacy policy applies.

Keys and the optional installation password come from environment configuration. Session cookies are HttpOnly and SameSite Strict, with Secure enabled by operator configuration for HTTPS. Theme selection stays in browser local storage. Profile backups contain personal library information and preferences, but omit secrets, session tokens, and credential fingerprints. Full database snapshots include installation/session state and must remain private.

Application logs record request paths, response/error status, and refresh activity. Standard request logging omits query strings, cookies, authorization headers, and response session cookies. Operators control log and backup storage/retention. Support diagnostics omit library contents, notes, database paths, and credentials. Sharing a report is a manual user action.

Export and restore are available in Settings. See [operations](OPERATIONS.md) for preserving or removing local data. Metadata and artwork remain subject to the providers' licenses, described in [credits](ATTRIBUTION.md) and the About page.
