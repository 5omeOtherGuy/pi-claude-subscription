# Repository map

Updated: 2026-10-18

## What this repo is

`pi-claude-subscription` is a Pi package. Its extension registers a `streamSimple` on Pi's built-in `anthropic` provider and delegates every request to Pi's own Anthropic transport. Only requests carrying an Anthropic OAuth token (`sk-ant-oat…`, the same marker Pi uses) get the extension's fetch boundary. There is no credential store, model catalog, request builder, SSE parser, proxy or background service.

## Request flow

```text
Pi agent loop / compaction / ctx.modelRegistry.streamSimple()
  | Pi resolves auth (auth.json via /login anthropic; refresh under Pi's lock)
  v
provider-composer -> extension streamSimple for provider "anthropic"
  v
src/transport.ts createOAuthGatedStreamSimple
  | not OAuth -> Pi transport, same options object
  | OAuth     -> Pi transport, options.fetch = caller fetch composed with:
  |              origin/path check, single-Bearer check, redirect: manual,
  |              error-body redaction, status/request-id record
  v
Pi anthropicMessagesApi().streamSimple (host copy, via loader alias for @earendil-works/pi-ai/compat)
  v
https://api.anthropic.com/v1/messages
```

## Critical invariants

- Register only `{ api: "anthropic-messages", streamSimple }` on `anthropic`: no `oauth`, `apiKey`, `models`, `baseUrl` or `headers`. Never call `unregisterProvider`.
- Resolve the delegate from the `anthropicMessagesApi` factory, never from the api registry, so the wrapper cannot recurse or bind to another extension's override.
- Return Pi's stream unchanged. Do not change payloads without a reproduced need (see the retained-differences table in `docs/architecture.md`).
- Do not patch `globalThis.fetch`, the api registry or other providers.
- Do not read, write, import or migrate Claude Code credentials, the Keychain or the 0.x state files.
- Diagnostics are metadata only and redacted. No telemetry, raw payloads or extra requests.
- No credentials, tokens, `.credentials.json`, `.env`, logs or live outputs in git.

## Source tree

```text
extensions/pi-claude-subscription/index.ts   registration, migration/ownership notices, status command
src/transport.ts                   host transport resolution and the OAuth fetch boundary
src/diagnostics.ts                 redaction, request record, status text
src/dependency-drift.ts            test-only lockfile drift checker
tests/                             see tests/INDEX.md
scripts/secret-scan.mjs            tracked-file credential scan
docs/                              see docs/INDEX.md
```

## Verification entry points

- `npm run check`: secret scan, tests (including `npm pack --dry-run`) and typecheck; CI job `gate`.
- None of these makes a live Anthropic request. Live acceptance is a separate, authorized step.
