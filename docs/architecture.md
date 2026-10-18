# Architecture

The extension is a thin wrapper around Pi's built-in `anthropic` provider. Offline gates pass. **Live acceptance has not been checked yet:** no request built by Pi and sent through this wrapper has gone to Anthropic with a real Claude Pro/Max login. Until that check passes, this version is not ready for release.

## Request path

```text
Pi session / compaction / ctx.modelRegistry.streamSimple()
  -> Pi auth (auth.json, /login anthropic, refresh under Pi's lock)
  -> provider anthropic, streamSimple registered by extensions/pi-claude-subscription/index.ts
  -> src/transport.ts: OAuth token?  no  -> Pi transport, same options object
                                     yes -> Pi transport with a composed fetch:
                                            endpoint + wire-auth check, redirect: manual,
                                            error-body redaction, status/request-id record
  -> Pi's anthropicMessagesApi().streamSimple (resolved through the host loader's
     @earendil-works/pi-ai/compat alias, never from the api registry)
  -> https://api.anthropic.com/v1/messages
```

Pi decides the request body, headers, Claude Code identity block, tool names, thinking, cache anchors, retries and stream parsing. The wrapper returns Pi's stream object itself, so events, `result()` and errors are Pi's. It patches nothing global: not `fetch`, not the api registry, not other providers.

## Code

- `extensions/pi-claude-subscription/index.ts`: resolves the host transport, registers `{ api: "anthropic-messages", streamSimple }` on `anthropic`, shows the migration and ownership notices, and registers `/claude-subscription-status`.
- `src/transport.ts`: resolves the host transport; applies the OAuth check; contains the fetch boundary.
- `src/diagnostics.ts`: redaction, the per-request record (metadata only), and the status text.

## Retained differences from native Pi

Each row is behavior that unwrapped Pi 1.3.0 does not have. Everything else is native Pi.

| Behavior (OAuth requests only) | Benefit | Reproducer | Tests |
|---|---|---|---|
| Refuse destinations other than `https://api.anthropic.com/v1/messages` (custom `baseUrl`, credentials in the URL, plain HTTP) | The subscription token is not sent to a proxy or a misconfigured endpoint. Native Pi sends it to any `baseUrl` | OAuth + `baseUrl: https://proxy.example.test` | `tests/transport.test.ts` "blocked before sending" |
| Refuse conflicting wire auth (`x-api-key`, or a different `Authorization`) | One credential per request; no mixed OAuth/API-key request from header overrides | OAuth + `headers: { "x-api-key": … }` | same |
| `redirect: "manual"`; a 3xx is not followed | A redirect cannot take the request elsewhere | stubbed 307 response | "redirects are not followed" |
| Redact token and header-shaped secrets in non-2xx response bodies | An echoed token does not end up in `errorMessage`, the session file or the UI. Native Pi includes it as-is | 401 body that echoes the token: native output contains it, wrapped output does not | "echoed secrets … are redacted" |
| Record status, request id, stop reason, token/cache counters, and redacted network-error causes in memory | `/claude-subscription-status` without logs, telemetry or extra requests | any request | "caching", "network errors", `tests/pi-session.test.ts` status assertions |

Requests are blocked by returning a local HTTP 400 marked `x-should-retry: false`, with type `pi_claude_subscription_blocked`. Pi reports that as `errorMessage` and does not retry it. If the fetch threw instead, Pi would report only "Connection error." and retry.

Not carried over (no evidence of a gap in Pi 1.3.0): request-body shaping, billing/version headers, device metadata, tool renaming beyond Pi's own, the custom SSE parser and watchdogs, conversion memo, cache builder, model catalog, fallback-model policy, thinking-signature retry, tool-argument repair, the credential store/import/accounts, and the changelog notice.

## Coverage

| Call path | Covered | Evidence |
|---|---|---|
| Main agent loop, including tool round trips | yes | `pi-session.test.ts` |
| Built-in compaction | yes | same |
| Extensions calling `ctx.modelRegistry.streamSimple()` | yes | same |
| After `/reload` | yes, the new instance replaces the old one; no stacking | same |
| pi-ai `compat.streamSimple()` called directly | **no**, it skips registered providers (the test asserts this) | same |
| Another extension registers an `anthropic` transport later | **no**; startup warning and `NOT COVERED` in status | same |
| API-key, `ANTHROPIC_AUTH_TOKEN` header auth, federation | passed through untouched (same options object) | `transport.test.ts`, `pi-session.test.ts` |

## Test map (definition-of-done gates)

| Gate | Where |
|---|---|
| 1 Native auth ownership, legacy files untouched | `pi-session.test.ts` "native auth ownership": registered keys are only `api` + `streamSimple`; Pi's OAuth and API-key auth stay, refresh happens in Pi and is persisted; an account change in `auth.json` is used on the next request (review cases C/D); fs/Keychain guard plus content/mtime snapshots on every session test |
| 2 Delegation parity | `transport.test.ts` "delegation parity" (wire equality across options, `onPayload` once + replacement, `onResponse`, caller fetch, retries) |
| 3 Stream contract | `transport.test.ts` "stream contract" (text, thinking, parallel tools, mid-stream error, truncated EOF, abort, `result()` timeout guard, one request per turn) |
| 4 Content fidelity | `transport.test.ts` "content fidelity" (Unicode, tool exchange across a system patch, signed/redacted thinking, full schemas, caller objects not mutated) |
| 5 Caching | `transport.test.ts` "caching" (none/short/long, repeat turn, mid-conversation tool addition, counters) |
| 6 Security boundaries | `transport.test.ts` "security" and "redaction"; `pi-session.test.ts` refresh-failure and API-key tests |
| 7 Loader integration | `pi-session.test.ts` (real loader, `/reload`, duplicate copy, other extension's overrides, compaction, registry calls, bare compat, private pi-ai copy ignored) |

## Pi versions

Supported: Pi `>=1.3.0 <2`. Only Pi 1.3.0 (the newest release on 2026-10-18) is tested. The wrapper depends on `anthropicMessagesApi` being exported from `@earendil-works/pi-ai/compat`, on `ModelRuntime.getRegisteredProviderConfig`, and on the auth precedence in Pi 1.3.0's `packages/ai/src/auth/resolve.ts`. Re-run `tests/pi-session.test.ts` before widening the range.

## Remaining limitations

- Live acceptance is still pending (see the top of this page). Pi builds a different request from the 0.x direct transport, with fewer changes, so the fact that 0.x worked does not show this one works.
- Mid-stream SSE `error` events are passed through as Pi reports them; only HTTP error bodies are redacted.
- Upstream Pi gaps found during this work: [`upstream-gaps.md`](upstream-gaps.md).
