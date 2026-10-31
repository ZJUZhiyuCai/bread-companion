# Security policy

Bread is currently a local, single-user application. Only the latest `main` is maintained; old preview releases do not have a separate security support window.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/ZJUZhiyuCai/bread-companion/security/advisories/new). Include affected commit, a minimal **synthetic** reproduction, impact, and a possible fix. Never attach API keys, real conversations, private recordings, or another person's data. Do not open a public issue with exploit details before coordination.

The maintainer will respond on a best-effort basis; this is not a staffed incident-response service. If the private reporting channel is temporarily unavailable, keep sensitive details private and use [GitHub Support](https://support.github.com/) for platform access problems.

## Trust boundaries

- Bind to loopback. The current API has no user accounts or per-user authorization and is **not a multi-user public deployment**. Publishing the source does not change this boundary.
- Keep provider keys on the server. Never use `NEXT_PUBLIC_*` for credentials. Provider billing, data retention, and availability remain outside this repository's control.
- Treat pasted materials, imported files, model output and recalled content as untrusted. Candidate validation, evidence checks and storage permissions live outside the model.
- Cancellation prevents late local publication; it cannot prove an upstream provider stopped computation or billing.
- IndexedDB is browser-local storage, not encryption or user isolation. Import/export files must be handled as personal data if users put personal data in them.

For intentional data flows, see [Data handling](docs/data-handling.md). Functional and accessibility tests, dependency alerts and static analysis are complementary checks, not a security certification.
