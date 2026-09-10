# Security reporting and installation scope

watch-it is intended for a single person running their own installation. Default Docker and native listeners are local. Configure a strong installation password, HTTPS, and exact trusted-proxy addresses before exposing it to untrusted networks. Do not share one installation between mutually untrusted users.

Private security reporting is not yet configured for distribution. The repository owner must choose and verify a private reporting URL or email address, record it in `release-config.json`, and update this document before the release workflow can proceed. Do not post exploit details or credentials in public issues while that channel is pending. No response-time commitment has been established.

Dependency and container audit checks run before release. The current advisory review is in [docs/DEPENDENCY_REVIEW.md](docs/DEPENDENCY_REVIEW.md). Build or install the latest reviewed release and follow the snapshot/rollback instructions in [operations](docs/OPERATIONS.md).
