# tests index

The tests are deterministic. They use fake credentials, stubbed network calls and synthetic fixtures. They make no live Anthropic, OAuth or model-discovery requests.

- `helpers.ts`: shared fixtures: SSE replies (text, thinking, tool calls, parallel tools, mid-stream error, truncated EOF), a recording fetch passed per request, full tool schemas, and the review reproducers (Unicode, tool exchange across a system patch, signed and redacted thinking).
- `transport.test.ts`: compares the wrapper with unwrapped Pi on the same model, transcript and options: wire parity, `onPayload`, `onResponse`, fetch, retries, stream events and `result()` for every reply shape including abort, content fidelity, cache anchors and retention, API-key pass-through, and the OAuth boundary (destination, wire auth, redirect, error-body redaction, network-error causes).
- `pi-session.test.ts`: real Pi sessions through Pi's resource loader. It covers native auth ownership and Pi-owned refresh, an account change in `auth.json` being used on the next request (review cases C/D), a failed refresh with no API-key fallback, API-key users, main loop, tool round trip, compaction, model-registry calls, the bare-compat bypass, `/reload`, a duplicate copy, other extensions' overrides, the migration notice, and the loader ignoring a private pi-ai copy. Every session checks that legacy credential files and the Keychain are untouched.
- `package-manifest.test.ts`: manifest metadata, `npm pack --dry-run` contents, the versioned changelog, and static checks that runtime source has no credential reader, OAuth hooks, dummy key or global patching.
- `dependency-drift.test.ts`: Pi dependency lockstep, the Node floor, documented gate categories, and the installed-vs-lockfile checker.
- `secret-scan.test.ts`: `scripts/secret-scan.mjs` flags credential-shaped strings and passes a clean tree.
