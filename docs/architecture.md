# Architecture

This reference describes how the `claude-subscription` provider works: its public interface, request shape, models, thinking levels, credentials, caching, stream handling, and replay rules. [`REPO_MAP.md`](../REPO_MAP.md) lists module responsibilities and the request flow. [GitHub issues](https://github.com/5omeOtherGuy/pi-claude-subscription/issues) track planned work.

## Stable public interface

| Item | Value |
|---|---|
| Provider id | `claude-subscription` |
| Native API id | `claude-subscription-native` |
| Slash commands | `/claude-subscription-status`, `/claude-subscription-accounts`, `/claude-subscription-import` |

Built-in model ids are `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-7-300k`, `claude-opus-4-8`, `claude-opus-5`, `claude-opus-5-5`, `claude-fable-5`, `claude-fable-5-1`, `claude-sonnet-5`, `claude-sonnet-5-5`, and `claude-haiku-5-5`.

## Request shape

Every request is a `POST` to `https://api.anthropic.com/v1/messages` with `stream: true`.

The provider sends four headers:

- `Authorization: Bearer <Claude Code OAuth token>`
- `Content-Type: application/json`
- `anthropic-version: 2023-06-01`
- `anthropic-beta`, with the values in the following table

It never sends `x-api-key` or `anthropic-api-key`.

| `anthropic-beta` value | Sent when |
|---|---|
| `oauth-2025-04-20` | Always |
| `claude-code-20250219` | Always |
| `interleaved-thinking-2025-05-14` | `thinking.type` is `"enabled"`, which means a manual-budget model with a budget |
| `server-side-fallback-2026-06-01` | The payload carries a non-empty `fallbacks` array |

The provider sends no other beta. It does not use eager or fine-grained tool streaming, or Message Batches.

The body has `model`, `max_tokens`, `messages`, `system`, and `stream`. Depending on the model and options, it also has `tools`, `metadata`, `thinking`, `output_config`, `fallbacks`, and `temperature`.

A tool entry has only `name`, `description`, and `input_schema`, plus `cache_control` on the last tool when caching is on.

The provider omits `tool_choice`, so Anthropic applies its `auto` default and allows parallel tool calls. Pi's `edit` and `write` tools serialize changes to one file through a per-realpath queue. Concurrent `bash` calls, and `bash` with `edit` on one file, are not serialized. That exposure matches the defaults of Pi and Claude Code.

## System blocks

The Claude Code OAuth route is sensitive to request shape. This shape has been observed to route Sonnet and Opus requests through the OAuth lane. Other shapes have been observed to fail with a generic 429.

```json
"system": [
  { "type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude." },
  { "type": "text", "text": "<Pi system prompt>" }
]
```

The identity must stay a separate first text block. It must not be concatenated with the Pi prompt, and it must not be duplicated if the prompt already contains it.

`shapeSystemBlocks` in `src/system-shape.ts` applies these rules:

- It drops a text block that equals the identity, and it strips the identity from the start of the joined prompt text.
- It joins the remaining text with a blank line.
- It removes prompt lines that start with `- When asked about:`, `- When working on pi topics`, or `- Always read pi .md files`.
- It omits the second block when no prompt text remains.

`buildNativeMessagesRequest` applies this shape to every payload with a `claude-` model, a `messages` array, and `max_tokens`. The extension's `before_provider_request` hook applies it too when the active provider is `claude-subscription`.

## Model compatibility matrix

This matrix mirrors `MODELS` in `src/models.ts`. `tests/model-matrix.test.ts` checks that it lists every model.

| Pi model id | Native model id | Context window | Max streaming tokens | Thinking mode | Notes |
|---|---|---:|---:|---|---|
| `claude-haiku-4-5` | `claude-haiku-4-5` | 200k | 64k | Manual budget. No selectable `max`. | |
| `claude-sonnet-4-6` | `claude-sonnet-4-6` | 200k | 64k | Manual budget. No selectable `max`. | |
| `claude-opus-4-6` | `claude-opus-4-6` | 1M | 128k | Manual budget. No selectable `max`. | |
| `claude-opus-4-7` | `claude-opus-4-7` | 1M | 128k | Adaptive | |
| `claude-opus-4-7-300k` | `claude-opus-4-7` | 300k | 128k | Adaptive | Soft-cap alias. The native request uses `claude-opus-4-7`. |
| `claude-opus-4-8` | `claude-opus-4-8` | 1M | 128k | Adaptive | |
| `claude-opus-5` | `claude-opus-5` | 1M | 128k | Adaptive | |
| `claude-opus-5-5` | `claude-opus-5-5` | 1M | 128k | Adaptive, always on. No Pi `off` (clamps to `minimal`). Explicit effort on every request. | No refusal fallback. |
| `claude-fable-5` | `claude-fable-5` | 1M | 128k | Adaptive, always on. `thinking` is omitted when reasoning is off. | Refusal fallback to `claude-opus-4-8`. |
| `claude-fable-5-1` | `claude-fable-5-1` | 1M | 128k | Adaptive, always on. No Pi `off` (clamps to `minimal`). Explicit effort on every request. | Refusal fallback to `claude-opus-5`. |
| `claude-sonnet-5` | `claude-sonnet-5` | 1M | 128k | Adaptive | 1M is the only context variant. |
| `claude-sonnet-5-5` | `claude-sonnet-5-5` | 1M | 128k | Adaptive. Pi `off` sends `between_tools` at `low`. | Progress updates remain thinking blocks. No automatic refusal fallback. |
| `claude-haiku-5-5` | `claude-haiku-5-5` | 1M | 128k | Adaptive. Pi `off` sends `disabled` at `low`. | No server-side refusal fallback supported. |

All models carry zero API cost metadata. Only `claude-opus-4-7-300k` has a native model id that differs from its Pi id.

## Adaptive thinking levels

Every adaptive model in `MODELS` offers Pi `max`. When reasoning is on, the request has `thinking: { type: "adaptive", display: "summarized" }` and `output_config: { effort }`. Effort is soft guidance, not a fixed budget.

| Pi level | Claude effort |
|---|---|
| `minimal` | `low` |
| `low` | `low` |
| `medium` | `medium` |
| `high` | `high` |
| `xhigh` | `xhigh` |
| `max` | `max` |

`max_tokens` is capped at the model's streaming limit and includes thinking tokens.

When reasoning is off, the request depends on the model:

| Models | Pi `off` behavior |
|---|---|
| `claude-opus-5-5`, `claude-fable-5-1` | Pi hides `off`. A persisted `off` clamps to `minimal`, which sends Claude `low`. `contextToPayload` applies the same clamp to a request with no level. |
| `claude-sonnet-5-5` | Sends `thinking: { type: "between_tools" }` at effort `low`, without `display` or a budget. It skips up-front reasoning but still emits thinking-block progress updates between tool calls. |
| `claude-haiku-5-5` | Sends `thinking: { type: "disabled" }` at effort `low`. |
| `claude-opus-4-7`, `claude-opus-4-7-300k`, `claude-opus-4-8`, `claude-opus-5`, `claude-fable-5`, `claude-sonnet-5` | Omits `thinking` and `output_config`. The omission does not guarantee that the server disables thinking. |

The `between_tools` and `disabled` modes reject `xhigh` and `max`, so they always send `low`. Every enabled level on those two models uses adaptive thinking.

Adaptive models never send `temperature`, and no model sends forced tool choice. Effort is set once per request, at the top level. The provider does not implement per-message effort, turn-scoped system messages, or binding-control betas.

`claude-opus-5-5` rejects both `disabled` and `budget_tokens` with a 400. Its map therefore has `off: null`, so every Opus 5.5 request carries explicit adaptive thinking and effort. A `cyber`, `bio`, or `reasoning_extraction` refusal ends the turn with a descriptive error.

A live run on 2026-09-22 used `tests/live-opus-5-5.test.ts` (`PI_LIVE_CLAUDE_OPUS55_TEST=1`). The API accepted a request with no level at explicit `low` effort. A signed thinking block from a `high`-effort tool-use turn replayed verbatim on the next turn.

### Anthropic specifications

These facts come from Anthropic's documentation, checked on 2026-10-12:

- API default effort is `high` for Fable 5.1 and Sonnet 5.5, and `medium` for Opus 5.5 and Haiku 5.5. The provider sends Pi's chosen level instead.
- Fable 5.1, Opus 5.5, Sonnet 5.5, and Haiku 5.5 bind thinking to the preceding conversation. An edited or compacted prefix can invalidate signed thinking. See [thinking-block replay](#thinking-block-replay-across-model-switches).
- Haiku 5.5 accepts forced tools. The provider keeps automatic tool choice so that the model can think before calling a tool.
- The explicit-list fallback uses the supported `2026-06-01` header, not the newer `2026-07-01` default-routing form.

Sources are the model pages for [Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview), [Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview), [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), and [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview), plus the guides on [effort](https://platform.claude.com/docs/en/build-with-claude/effort), [thinking configuration](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting), and [fallback beta compatibility](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback).

## Manual thinking budgets

Manual-budget models are `claude-haiku-4-5`, `claude-sonnet-4-6`, and `claude-opus-4-6`. Pi `max` is not selectable on them.

`contextToPayload` computes:

```text
max_tokens = min(requestedOutputTokens + thinkingBudget, output_cap)
```

- `requestedOutputTokens` is the visible-output request, clamped to `output_cap`. It defaults to `output_cap`.
- `output_cap` is the model's `maxTokens`: `64000` for Haiku 4.5 and Sonnet 4.6, and `128000` for Opus 4.6.
- `thinkingBudget` comes from Pi's `thinkingBudgets` option when it sets the level, and otherwise from this table:

| Pi level | `budget_tokens` |
|---|---:|
| `minimal` | `1024` |
| `low` | `4096` |
| `medium` | `10240` |
| `high` | `20480` |
| `xhigh` | `32768` |

Adding the budget to the clamped output keeps `budget_tokens` below `max_tokens` when output is clamped, as in Pi compaction. Anthropic answers `budget_tokens >= max_tokens` with a 400.

If the budget still does not fit below the cap, the budget drops to the room between the cap and the requested output. If that room is under Anthropic's `1024` minimum, the provider omits `thinking` and sends the clamped output as `max_tokens`.

With no budget, Pi's `temperature` option is passed through. Manual-budget models send no `output_config`.

## Safety boundaries

- The extension calls `pi.unregisterProvider("anthropic")`, but built-in `anthropic` models may remain visible. Visibility is not a safety boundary.
- Subscription models use the isolated `claude-subscription-native` API id. They do not replace Pi's shared `anthropic-messages` handler.
- The native stream refuses any provider other than `claude-subscription` before it loads credentials.
- The `input` hook refuses new prompts on `anthropic`, `custom-anthropic`, and `meridian`. It skips steer and follow-up messages, because their turn already passed it.
- The `before_provider_request` hook throws for those providers, but Pi catches the error and still sends the request, so the hook only reports the problem.
- The transport refuses any URL other than `https://api.anthropic.com/v1/messages`, so the OAuth token goes nowhere else on that path.

A stale extension context does not fail closed. The `input` handler tries to refuse the prompt, but `ctx.ui` also throws on a stale context, so Pi catches the error and the prompt continues. For Claude-shaped payloads, the `before_provider_request` hook throws too, and Pi still sends the request.

## Credential handling

The default source is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json`. The provider reads `.claudeAiOauth.accessToken` and also accepts a flat top-level `accessToken`.

- **Refresh.** The provider refreshes a token that has expired or expires within 5 minutes, before the model request. It needs a `refreshToken`, and it persists the result by writing a temporary file and renaming it.
- **Rejected token.** On a 401 or `authentication_error` before streaming starts, the provider force-refreshes, rebuilds the request, and retries once. If the force-refresh fails, it returns an error that tells the user to log in again. It never retries through an API-key lane.
- **Concurrency.** Refreshes for one credential source are serialized within a process. After a token exchange, the provider re-reads the file. If another process has written a different fresh token, the provider uses that token and does not overwrite the file. This check is best-effort.
- **Token cache.** An access token with a numeric `expiresAt` stays in memory until it comes within the refresh margin. A forced refresh clears the entry.
- **macOS Keychain.** On macOS, the provider falls back to the `Claude Code-credentials` Keychain service in two cases: the file cannot be read, or a parsed file gives no usable token, such as a failed refresh. Malformed file contents do not trigger the fallback. If the fallback fails after a parsed file, the provider reports the original file error.
- **Keychain refresh.** Credentials refreshed from the Keychain are written to the standard credential-file path.
- **API keys.** The provider never reads or sends `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `x-api-key`, or `anthropic-api-key`.
- **Registration key.** The registered `apiKey` is the inert literal `claude-code-oauth-loaded-at-runtime`. Pi interpolates `$` references and runs a value that starts with `!`, and the literal contains neither.

Two commands select other sources. Both write under `<agentDir>/pi-claude-subscription/` with mode `0600`, and neither changes Pi's generic `auth.json`.

| Command | Effect |
|---|---|
| `/claude-subscription-accounts` | Stores the selected source descriptor in `credential-state.json`. |
| `/claude-subscription-import` | Copies the selected credentials to `imported-credentials.json`, makes that copy the active source, and records its origin in `credential-state.json`. |

Account discovery reads only the credential file, because the extension passes no Keychain runner to `discoverKeychainAccounts`.

## Model catalog

`src/model-catalog.ts` backs Pi's `refreshModels` hook. Pi refreshes offline after any provider registration, and each result replaces the live model list. Pi refreshes over the network at interactive and RPC startup, when `/model <pattern>` finds no cached match, and when the model and scoped-models selectors open. Print mode never refreshes over the network.

On a network refresh, the provider reads up to 10 pages of `GET /v1/models` within a 5-second timeout. If every page succeeds and at least one entry is usable, it saves the entries to `<agentDir>/pi-claude-subscription/model-catalog.json`. The file keeps only the fields that the mapping reads, and it never holds credentials.

An offline or failed refresh rebuilds the list from that file, so API models survive restarts. With no usable file, the list falls back to `MODELS`. The file has no age limit, so a removed model stays until the next successful network refresh.

The API decides which models exist. A retired entry is ignored.

- A known model comes from `MODELS` unchanged, including its limits.
- A known model also stays when the API lists a dated name, such as `claude-haiku-4-5-20251001`, or the native model of an alias.
- A new model needs positive token limits, adaptive thinking, an effort table, and `high` effort. It gets `compat.forceAdaptiveThinking`, and `off: null` when the API does not list `disabled` thinking.

The file records which built-in ids existed when it was written. After a package update, offline and failed refreshes add newer built-in models to the list. The next successful refresh rewrites the file.

## Cache retention

By default, native requests add prompt-cache anchors to the system blocks, the last tool, and the last user block. An anchor goes on a user block only when the last message is a user message and its last block is text, an image, or a tool result. A block that already has `cache_control` keeps it.

| `cacheRetention` | Result |
|---|---|
| `short` or unset | `cache_control: { type: "ephemeral" }` |
| `long` | Adds `ttl: "1h"`, unless `compat.supportsLongCacheRetention` is `false`. In that case, short retention applies. |
| `none` | No anchors. The system-block shape stays. |

When `cacheRetention` is unset, `PI_CACHE_RETENTION=long` selects `long`.

## Stream and tool-call behavior

Parsing and application fail closed. Any failure below ends the turn with a Pi `error` event instead of `done`.

The parser in `src/anthropic-sse.ts` rejects:

- malformed JSON and `error` frames
- frames before `message_start`
- a second `message_start` before `message_stop`
- a block start after `message_stop`
- a duplicate start for an open block, and a delta or stop with no matching open block
- `message_stop` with a block still open
- the end of a stream without `message_stop`
- `tool_use` blocks with an empty `id` or `name`, or a non-object `input`
- `input_json_delta` outside a `tool_use` block

For `stop_reason: "tool_use"` with no `tool_use` block, the parser emits a `contractViolation` event, and the applier turns it into an error.

The applier in `src/native-stream-events.ts` re-checks these rules and also rejects a delta whose type does not match its block. `src/native-stream-simple.ts` rejects an unsupported stop reason after the stream ends.

| Anthropic `stop_reason` | Pi result |
|---|---|
| Absent, `end_turn`, `pause_turn`, `stop_sequence` | `stop` |
| `max_tokens` | `length` |
| `tool_use` | `toolUse` |
| `refusal` | Error that names the refusal category, if present, and any fallback models tried |
| Any other value | Error that names the stop reason |

### Tool input

Tool input arrives as ordinary `input_json_delta` events. The provider parses them best-effort for live preview. Up to 16,384 characters, it parses on every delta. Above that, it parses again only after the input grows by 25%.

The final parse at `content_block_stop` first tries to repair truncated JSON and invalid string contents. It fails closed when non-empty input still cannot become a JSON object.

`src/edit-tool-arguments.ts` then normalizes the arguments of the built-in `edit` tool, including input that arrived whole on the `tool_use` start:

- A stringified `edits` array is parsed.
- An edit item is reduced to `{ oldText, newText }` when both are strings.
- A malformed item stays as it is, so Pi's validator reports it.
- Other top-level keys pass through.

Arguments of all other tools pass through unchanged.

### Timeouts

| Phase | Limit | Default |
|---|---|---|
| Waiting for response headers | `streamNoProgressTimeoutMs`, then `timeoutMs` | 300 seconds under Pi, which always sets `timeoutMs`, and 120 seconds with no `timeoutMs` |
| Gap between body reads | `streamNoProgressTimeoutMs` | 45 seconds |

Pi's `timeoutMs` does not limit a stream after its headers arrive, so a long stream that keeps making progress continues.

### Error messages

An error message is a base message followed by a diagnostic suffix in brackets. `redactSensitiveText` processes the base message. It replaces `Authorization` and `Bearer` values, `x-api-key` and `anthropic-api-key` values, and the exact access tokens of the request.

| Source | Base message contains |
|---|---|
| Credentials | The reason, a login hint, and the credential path. Never a token or file contents. |
| OAuth refresh | The reason and the HTTP status. Never the response body. |
| HTTP error | The status, the response body or status text, and the request id |
| SSE `error` frame | The error type and message from Anthropic |
| Transport failure | The error and cause messages |
| Malformed SSE JSON | The frame index and byte count |
| Tool input parse failure | The input length |

The suffix holds metadata only: status, ids, models, rate-limit, `retry-after`, and `content-type` headers, last event type, lifecycle flags, endpoint, auth kind, open block and tool state, and usage counts. It never holds raw SSE, prompts, message text, tool schemas, tool arguments, command strings, credentials, or authorization headers.

### Partial output after an error

An errored message that never saw `message_stop` loses all its tool-call blocks, so an incomplete call cannot look executable. An errored message that did see `message_stop`, such as a refusal, keeps them. An aborted message keeps everything already streamed, including tool calls.

## Refusal fallback

`compat.refusalFallbackModel` adds `fallbacks: [{ model }]` to the payload, so the API retries a safety-classifier refusal on that model in the same round trip.

The API marks the switch with a `fallback` content block, which never becomes Pi content. At that block, the applier clears the signature of every earlier thinking block, so those blocks do not replay. If no content block is open, it also drops earlier tool calls. Text stays.

If the API answers with a 400 that mentions `fallback`, the provider retries once without `fallbacks` and stops sending the parameter for the rest of the process. Refusals then end the turn with an error.

## Message conversion

`convertMessages` in `src/native-message-conversion.ts` turns Pi history into Anthropic messages:

- It skips errored and aborted assistant turns.
- It sends an assistant turn's tool calls only when every call has a result immediately after that turn. Otherwise it drops those calls and their results.
- It skips Pi `system` messages, which carry the prompt and tools.
- It drops blank text from user and assistant messages.
- It replaces lone surrogates with `U+FFFD`, except in signed thinking.
- It rewrites tool-use ids to fit Anthropic's pattern.

## Thinking-block replay across model switches

Signed thinking replays only when the earlier assistant message has the same provider, native API id, and Pi model id as the current model.

| Earlier block | Same model | Different model or provider |
|---|---|---|
| Signed visible thinking | Replays byte-for-byte as `thinking`, even if its text is empty | Becomes assistant text if non-empty, without the signature |
| Redacted thinking | Replays as `redacted_thinking` | Dropped |
| Visible thinking without a signature | Dropped | Becomes assistant text if non-empty |

After Pi compaction or an edit to the system prompt, tools, or history, Anthropic can return an HTTP 400 that says the signature is bound to a different conversation. The provider then retries once without historical `thinking` and `redacted_thinking` blocks.

- The retry keeps text, tool calls, tool results, model, effort, tools, and cache settings.
- It omits assistant turns left empty by the removal.
- It does not change Pi's transcript or memoized conversion results, so a later request may need the same recovery.
- It also applies after an OAuth-refresh retry or a fallback-beta retry.
- It needs no binding-control beta, so Sonnet `between_tools` and Haiku `disabled` modes can recover too.

The provider does not use this retry for malformed signatures, modified thinking text, other errors, aborts, or failures after streaming starts. A request that succeeds sends its replay unchanged.

## Verification scope

`npm test` and `npm run check` make no live Anthropic requests and read no real credential files. The tests use fake credentials, Keychain services, and tokens, plus static fixtures and mocked network boundaries.

[`REPO_MAP.md`](../REPO_MAP.md) lists the tests by area.

The `tests/live-*.test.ts` files are the exception. They skip unless a `PI_LIVE_CLAUDE_*_TEST=1` variable is set, and they spend subscription quota when it is.

```bash
npm test
npm run typecheck
npm run check
```

[`docs/verification-gates.md`](verification-gates.md) describes focused gates and the Pi dependency lockstep policy.
