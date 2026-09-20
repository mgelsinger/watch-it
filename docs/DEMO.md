# Sample demo

The candidate includes a standalone HTML walkthrough at `web/public/demo/index.html`. Open the file directly in a browser, without building or installing anything. The built app also serves it at `/demo/`, outside the installation login. This page has no access to the private API or library and does not bypass API authentication.

The demo shows the core sequence: 45 minutes, selected subscriptions, Light / comedy, a recommendation with reasons, sample watch options, a saved Watchlist title, and episode progress. All titles, typographic artwork, offers and progress are fictional and labeled on the page. Service names illustrate selection only. The tiny sample filter is not the production recommendation engine or evidence of live availability. The source has no keys, user data, external images, fetches, analytics, cookies or browser storage. Its Content Security Policy disallows network requests and form submission. Reset or reload restores the initial state.

This is the smallest useful pre-installation demo. It avoids a public writable installation, shared personal data, an operator API key and provider traffic. It cannot demonstrate real catalog breadth, audio coverage, freshness or recommendation quality. Use the separately captured real-app screenshots for those UI examples, with their existing availability caveats.

For the repository launch, offer the HTML download in the README. After the preparation is merged and visibility approved, that main-branch download link becomes publicly accessible. A hosted static copy would remove the download step. Publish only this HTML file to a chosen static host with HTTPS; do not publish an app server or personal data volume. Test the final public URL on desktop and mobile before linking it. No hosting was provisioned or published in this phase. Domain, public URL and publication are owner decisions.

The demo deliberately uses its own temporary state. Do not replace it with a seed operation on a user's real database. If a later demo shares the full app UI, retain an explicit sample banner, isolated state, reset behavior and tests proving it cannot read or mutate personal data.
