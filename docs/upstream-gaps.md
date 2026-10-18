# Upstream gaps in Pi

Gaps found in Pi 1.3.0 (`71023aec1546d6d677a65669c5665c0927ce0dd0`) while building the wrapper. They belong in Pi and are not fixed here, and none has been reported upstream yet. Each entry gives the place in Pi's code, a reproduction, and a proposed fix.

## 1. OAuth refresh does not validate the token response

`packages/ai/src/auth/oauth/anthropic.ts`, `refreshAnthropicToken` (and `exchangeAuthorizationCode`), stores whatever the token endpoint returns. Reproduced against the installed `dist/auth/oauth/anthropic.js` with a stubbed `fetch`:

- `{ "access_token": "new-access", "expires_in": 3600 }` (no `refresh_token`) → `{ access: "new-access", expires: … }`. The refresh token is lost, so the next refresh fails and the user has to log in again.
- `{ "access_token": 42, "refresh_token": null, "expires_in": "soon" }` → `{ access: 42, refresh: null, expires: null }` is accepted and written to `auth.json`.

Proposed fix: check that `access_token` is a non-empty string and `expires_in` a positive finite number, and reject anything else without changing the stored credential. If `refresh_token` is missing, keep the previous one.

## 2. The OAuth token goes to any `baseUrl`

`packages/ai/src/api/anthropic-messages.ts`, `createClient`, sends an `sk-ant-oat` token as `Authorization: Bearer` to whatever `model.baseUrl` is configured, and follows redirects. The wrapper blocks this for the `anthropic` provider (see the retained-differences table in [`architecture.md`](architecture.md)). Proposed fix: send OAuth tokens only to the official origin unless the user opts in.

## 3. Echoed credentials reach `errorMessage`

Pi turns an Anthropic HTTP error into `errorMessage` text that includes the response body as-is. If that body echoes the token, it ends up in the session file and the UI (reproducer: `tests/transport.test.ts` "echoed secrets"). Proposed fix: redact the request's own `apiKey` and Bearer values in provider error messages.

## 4. A truncated tool call is kept in the errored message

If the response body ends inside a `tool_use` block, Pi ends the turn with `stopReason: "error"` ("Anthropic stream ended before message_stop"). The errored message still contains the partial call, with its arguments repaired (for example `{"command":"rm -rf /tmp/x"}` from a cut-off string). The agent loop does not run it, and `transformMessages` drops errored messages on replay, so it is shown but never executed (reproducer: `tests/transport.test.ts` "stream contract", review case E). Proposed fix: drop or mark tool calls that never received `content_block_stop`.

## 5. Fetch failures lose their cause

When the fetch function throws, the Anthropic SDK reports `APIConnectionError` with the message "Connection error.", and Pi retries it as retryable. The cause is not in `errorMessage`. The wrapper records the redacted cause for `/claude-subscription-status`, and reports its own blocks as local HTTP 400 responses so the reason is visible. Proposed fix: include a redacted cause in `errorMessage`.

## 6. Provider coverage seams

- pi-ai `compat.streamSimple()` dispatches through the api registry and skips providers registered by extensions (`provider-composer`). This is a deliberate Pi design, documented here as a coverage limit.
- `provider-composer`'s `streamWith` sends non-simple `stream()` calls to an extension's `streamSimple` as well, so Anthropic-only `stream()` options (`thinkingEnabled`, `effort`) are read as simple options for those calls.
- `registerProvider` merges over earlier registrations from other extensions, and there is no ownership API. The wrapper can detect that it was replaced (`getRegisteredProviderConfig`), but it cannot take part in a chain of transports.
