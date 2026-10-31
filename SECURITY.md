# Security policy

Bread supports loopback development and a capacity-limited HTTPS public trial. Only the latest `main` is maintained; old preview releases do not have a separate security support window.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/ZJUZhiyuCai/bread-companion/security/advisories/new). Include affected commit, a minimal **synthetic** reproduction, impact, and a possible fix. Never attach API keys, real conversations, private recordings, or another person's data. Do not open a public issue with exploit details before coordination.

The maintainer will respond on a best-effort basis; this is not a staffed incident-response service. If the private reporting channel is temporarily unavailable, keep sensitive details private and use [GitHub Support](https://support.github.com/) for platform access problems.

## Trust boundaries

- Local development binds to loopback. Hosted mode requires an exact canonical HTTPS `BREAD_PUBLIC_ORIGIN`, a server-only signing secret, same-origin POSTs, and a signed short-lived anonymous visitor cookie. Forwarded host headers do not authorize a request.
- Public paid endpoints require shared D1 accounting: atomic rolling budgets, capability capacities, active leases and 24-hour deduplication. Missing accounting fails closed. Anonymous cookies are not user accounts and can be reacquired; the global budget remains the cost boundary. This is not a comprehensive bot or DDoS defense.
- D1 stores only keyed anonymous/request identifiers, capability lane and timestamps. It does not store conversations, audio, materials or provider credentials. Expired rows are deleted on the next admission, not by a precise-time erasure scheduler. Worker runtime bindings and secrets are scoped to each request with AsyncLocalStorage.
- Keep provider keys on the server. Never use `NEXT_PUBLIC_*` for credentials. Provider billing, data retention, and availability remain outside this repository's control.
- Provider endpoints and CLI evaluation targets are trusted operator configuration, not client-editable settings. Do not expose them to untrusted users without adding destination validation and an explicit network policy.
- Treat pasted materials, imported files, model output and recalled content as untrusted. Candidate validation, evidence checks and storage permissions live outside the model.
- Cancellation prevents late local publication; it cannot prove an upstream provider stopped computation or billing.
- IndexedDB is browser-local storage, not encryption or user isolation. Import/export files must be handled as personal data if users put personal data in them.

For intentional data flows, see [Data handling](docs/data-handling.md). Functional and accessibility tests, dependency alerts and static analysis are complementary checks, not a security certification.

The [initial CodeQL triage](docs/security-triage.md) records the source-to-sink reasoning for findings reviewed on 2026-10-31.
