# Blog announcement

Copy below for the blog after the public v1.0.0 release is available. This file is announcement copy; committing it does not publish a post to a blog or social account.

## Watch It: find your next watch and keep your place

Sometimes the hard part of watching something is deciding what fits the evening, then remembering where you stopped last time.

I'm releasing Watch It, a self-hosted app that brings discovery and personal tracking together. Tell Pick For Me you have 45 minutes, choose your streaming subscriptions and Light / comedy, then review a suggestion with its listed runtime, genre and regional watch options. Save it to your Watchlist, open the provider listing to find somewhere to watch, and mark episodes watched as you go.

It does not host or play video, and you do not need video files. Playback happens on your streaming service. Watch It may suit you if you want one watchlist across services, visible episode progress, and a library you can export and keep on your own computer or home server.

JustWatch and watch-tracking apps such as Trakt already solve much of this problem. Watch It is another option for people who prefer to self-host this suggestion-to-watchlist-to-progress workflow. Episode tracking is manual. Jellyfin is a personal media server for hosting and playing files; Watch It serves a different purpose.

Setup uses Docker and your own TMDB API key. Settings links to the key application and gives you a field to paste the key into. OMDb ratings are optional. There is one shared library per installation, not separate user accounts. Availability and audio information depend on provider coverage; Light / comedy is a genre filter, not a guarantee about a title's tone.

The README includes screenshots and a small downloadable sample demo with fictional content that you can try without installing the app. I'd welcome feedback on first-time setup, Pick For Me, and tracking progress on a phone.

[See Watch It and the setup guide](https://github.com/mgelsinger/watch-it#readme) | [Download Watch It v1.0.0](https://github.com/mgelsinger/watch-it/releases/tag/v1.0.0)

Suggested lead image: `docs/images/recommendation.png`. Follow with the library, episode-progress and mobile screenshots. Do not describe the sample demo as a live catalog or claim unique recommendation quality.
