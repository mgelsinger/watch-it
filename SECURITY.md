# Security policy

Watch It is a self-hosted app with one shared library per installation. The optional password protects that installation; it does not isolate different people's data. Use the localhost default, or configure a password and HTTPS before allowing untrusted access. Keep API keys, profile exports and database files private.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/mgelsinger/watch-it/security/advisories/new) once enabled at public launch. Include the affected version, installation method, reproducible steps and likely impact. Remove real keys, cookies and personal history from examples. Do not put exploit details or credentials in a public issue.

Publication status: the repository is still private, and GitHub's public-repository reporting feature cannot yet be verified. Enabling it and confirming that the Report a vulnerability form is available are required publication steps. The release workflow refuses to prepare a release if GitHub does not report the feature enabled. [GitHub setup instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

Ordinary bugs belong in [Issues](https://github.com/mgelsinger/watch-it/issues). Maintainers support the latest released version on the documented Linux x86-64 Docker target. Reports are handled on a best-effort basis; no response-time guarantee is offered.
