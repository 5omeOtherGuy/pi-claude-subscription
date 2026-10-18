# src index

- `transport.ts`: resolves Pi's own Anthropic transport (`anthropicMessagesApi().streamSimple` from `@earendil-works/pi-ai/compat`, through the host loader alias), and `createOAuthGatedStreamSimple`. Requests that do not carry an OAuth token are passed to Pi with the same options object. OAuth requests get a composed fetch: official endpoint only, one Bearer credential, no redirects, redacted error bodies, metadata recording.
- `diagnostics.ts`: redaction of secrets in text and error causes, the in-memory metadata-only request record, and the `/claude-subscription-status` text.
- `dependency-drift.ts`: installed-vs-lockfile dependency drift checker, used only by `tests/dependency-drift.test.ts`.
