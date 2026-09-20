# Contributing to watch-it

watch-it is a personal, self-hosted movie and TV discovery and tracking app. Start with a clear problem: what you wanted to do, what happened, and what would have helped.

## Report a problem

Use the bug-report form in [Issues](https://github.com/mgelsinger/watch-it/issues). Include the app version from Settings diagnostics, your installation method and platform, and a short reproduction. For catalog problems, include the title, country, and relevant services. Upstream availability can be incomplete or dated.

Keep API keys, passwords, cookies, `.env`, databases, backups, and private notes out of reports. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

## Propose a change

Open an issue before undertaking a large feature. Explain the user outcome and how it fits discovery, recommendations, or personal viewing history. Keep changes focused and preserve the single-installation model and existing data.

Use the [README development instructions](README.md#development). Run type checks, server tests, and a production build. For browser behavior, run the relevant Playwright workflows. Storage or installation changes also need the Docker installation and recovery checks.

Update the user documentation when behavior changes. Use a separate sample library for screenshots; [capture instructions](docs/SCREENSHOTS.md) keep personal data out of images.

A contribution license has not yet been selected. Public contribution acceptance remains pending the repository owner's code-license decision.
