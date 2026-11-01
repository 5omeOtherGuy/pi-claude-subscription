# Repository map

`pi-claude-subscription` is a public Pi package whose extension registers a native `claude-subscription` provider, authenticated with Claude Code OAuth. The provider runs on the isolated API id `claude-subscription-native` with its own `streamSimple`, and it needs no local proxy, Python virtual environment, or background service.

## Request flow

```text
Pi session
  |  loads the package through package.json, pi.extensions: ./extensions/pi-claude-subscription
  v
extensions/pi-claude-subscription/index.ts
  |  - calls unregisterProvider("anthropic"), which removes only other extensions'
  |    registrations and leaves Pi's built-in provider in place
  |  - registers claude-subscription on claude-subscription-native
  |    with streamNativeClaudeSubscription and refreshClaudeModels
  |  - registers the status, accounts, and import slash commands
  |  - input handler blocks anthropic, custom-anthropic, and meridian
  |  - before_provider_request handler shapes system blocks and throws for blocked
  |    providers. Pi catches those errors, reports them, and sends the request anyway.
  v
src/native-stream-simple.ts
  |  - rejects every provider except claude-subscription before it loads credentials
  |  - loads Claude Code OAuth credentials through src/credential-accounts.ts
  |  - builds the payload, then lets Pi run before_provider_request on it
  |  - retries once with a forced refresh after an authentication rejection
  |  - retries once without fallbacks if Anthropic rejects the fallback beta
  |  - retries once without thinking blocks if Anthropic reports a conversation-bound signature
  v
src/native-payload.ts, src/native-message-conversion.ts
  |  - convert Pi context, messages, tools, and thinking into Anthropic payload fields
  v
src/native-request.ts, src/system-shape.ts, src/native-headers.ts
  |  - build system as a content-block array with the Claude Code identity first
  |  - add prompt-cache anchors
  |  - send OAuth headers only, never x-api-key
  v
src/native-stream-transport.ts
  |  - refuses every URL except the Anthropic Messages URL before fetch
  |  - applies the response-start and no-progress watchdogs
  v
https://api.anthropic.com/v1/messages
  |  returns an SSE response
  v
src/anthropic-sse.ts, src/native-stream-events.ts
     - parse the SSE chunks and apply each event to Pi's event stream
```

The model list has a separate path through Pi's `refreshModels` hook:

```text
src/model-catalog.ts (refreshClaudeModels)
  |- network refresh: GET https://api.anthropic.com/v1/models with OAuth headers,
  |    then saves the entries to <agentDir>/pi-claude-subscription/model-catalog.json
  |- offline or failed refresh: rebuilds the list from the saved model-catalog.json
  |- no usable saved file: returns MODELS from src/models.ts
```

## Critical invariants

- The provider id is `claude-subscription`. The native API id is `claude-subscription-native`.
- The registered model ids are `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-7-300k`, `claude-opus-4-8`, `claude-opus-5`, `claude-opus-5-5`, `claude-fable-5`, `claude-fable-5-1`, `claude-sonnet-5`, `claude-sonnet-5-5`, and `claude-haiku-5-5`.
- Credentials, OAuth tokens, API keys, `.credentials.json`, `.env`, runtime configs, and logs do not belong in git.
- Native requests use Claude Code OAuth from `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json` or the macOS Keychain fallback. They refresh expired and near-expired tokens, force a refresh and retry once on 401, and must not send `x-api-key`.
- Built-in Pi `anthropic` models may remain visible and selectable. Safety relies on provider and API isolation and on runtime guards, not on removing the built-in provider.
- Pi catches `before_provider_request` hook errors and only reports them, so docs must not describe that hook as the sole safety boundary.
- The first Anthropic `system` block must be exactly `You are Claude Code, Anthropic's official CLI for Claude.`. It must be a separate first text block, not concatenated with the Pi prompt.
- The runtime must not depend on a local proxy, Python virtual environment, or background service.
- Public docs may carry dated, aggregate live results and opt-in runbooks. They must not include raw logs, request or response bodies, or machine-specific setup notes.

## Modules in `src/`

The extension entry point is `extensions/pi-claude-subscription/index.ts`. Pi labels the extension with that directory's name.

| Module | Job |
|---|---|
| `anthropic-sse.ts` | Full-text and incremental SSE parsers with fail-closed lifecycle and contract guards. |
| `constants.ts` | The Claude Code identity string, the fallback beta name, and the doc-routing prefixes. |
| `credential-accounts.ts` | Finds, selects, and imports Claude Code OAuth sources and formats their status. Keeps its state in `pi-claude-subscription/` under Pi's agent directory and never changes Pi's `auth.json`. |
| `credentials.ts` | Resolves the credential path, loads and caches tokens, refreshes and saves them, coalesces refreshes in one process, avoids stale writes, and reads the macOS Keychain. |
| `dependency-drift.ts` | Pure checker that compares declared, locked, and installed dependency versions. |
| `edit-tool-arguments.ts` | Conservative normalizer for the `edit` tool's arguments. Other tools never reach it. |
| `extension-changelog.ts` | Parses versioned changelog entries and keeps the per-user notification state for startup and reload. |
| `model-catalog.ts` | Pi `refreshModels` hook. Reads `GET /v1/models`, saves the last good list to `model-catalog.json`, and maps entries to model configs. |
| `models.ts` | Model definitions, thinking-level maps, compat metadata, the provider id, and the native API id. |
| `native-headers.ts` | OAuth headers for Anthropic requests, with no `x-api-key`. |
| `native-message-conversion.ts` | Converts Pi messages to Anthropic blocks: surrogate cleanup, memoization, same-model signed-thinking replay, tool-use id mapping, and tool-result sequencing. |
| `native-payload.ts` | Turns Pi context, model, and options into the Anthropic payload: tool schemas, thinking, native model ids, and the server-side fallback latch. Reads both the transcript context and the older context fields. |
| `native-request.ts` | Builds the Messages request, applies the system shape, and adds prompt-cache anchors with `cacheRetention` and `PI_CACHE_RETENTION` handling. |
| `native-stream-events.ts` | Applies parsed SSE events to Pi's stream: contract state, usage and cache mapping, fallback boundary, tool JSON parsing, final argument normalization, and active-tool diagnostics. |
| `native-stream-simple.ts` | `streamNativeClaudeSubscription`, the Pi `streamSimple` integration: provider check, retries, redacted diagnostics, and fail-closed errors. |
| `native-stream-transport.ts` | Raw fetch and SSE transport: URL guard, response callbacks, and the response-start and no-progress watchdogs. |
| `native-tool-sequencing.ts` | Shared rules for which tool results may be sent, used by message conversion. |
| `redaction.ts` | Removes credential and header patterns and exact known secrets from surfaced errors. |
| `system-shape.ts` | Pure helpers that remove Pi doc-routing lines and build the required `system` blocks. |
| `tool-json-arguments.ts` | Repairs and parses partial `tool_use` input JSON. Incremental parsing is best-effort. Final parsing fails closed on non-empty input that cannot become an object. |
| `type-guards.ts` | `isRecord`, the shared guard for unknown values. |

## Tests

`npm test` runs every file in `tests/`. The deterministic tests use fake credentials, fixtures, and mocked network boundaries, so they make no live Anthropic requests. `npm run check` is the gate (CI job `gate`). It runs `scripts/secret-scan.mjs`, the tests, and the typecheck.

The table omits the `.test.ts` suffix.

| Area | Test files | Covers |
|---|---|---|
| Extension and Pi integration | `current-provider-system-shape`, `pi-session` | Provider registration, input and billing guards, stale contexts, slash-command messages, and a tool-call round trip in a real Pi session with a stubbed endpoint. |
| Credentials | `credential-accounts`, `native-credentials` | Account discovery and import, refresh and persistence, Keychain fallback, no API-key fallback, and OAuth-only headers. |
| Models and thinking | `model-catalog`, `model-matrix`, `native-fable-5`, `native-new-models`, `native-opus-5-5`, `native-thinking-levels` | Catalog paging and the saved list, the documented model matrix, per-model request rules, refusals and fallbacks, and thinking levels. The matrix test also checks the threat-model headings in `SECURITY.md`. |
| Request building | `native-request`, `native-request-golden`, `native-cache-prefix`, `native-convert-messages-memo`, `native-surrogates`, `native-tool-sequencing`, `native-transcript-context`, `system-shape` | System blocks, cache anchors and prefix stability, memoized conversion, emoji and surrogates, tool sequencing, and both context shapes. Golden bodies are in `tests/golden/`, and `PI_GOLDEN_UPDATE=1` regenerates them. |
| Streaming | `anthropic-sse`, `native-stream-simple`, `edit-tool-arguments`, `tool-json-arguments` | SSE parsing, contract violations, mocked `streamSimple` integration, retries, aborts, redacted errors, and tool argument repair. |
| Redaction and secrets | `redaction`, `secret-scan` | Redaction patterns and the tracked-file secret scan. |
| Repository hooks | `pre-push-hook` | `scripts/install-hooks.sh` and the pre-push hook in a linked worktree: the gate runs without Git's hook variables, pushes to `main` are refused, and a branch's own hooks never run. |
| Package and dependencies | `dependency-drift`, `extension-changelog`, `package-manifest` | Dependency lockstep, the Node floor, the documented gate categories, changelog display, and manifest and `npm pack` contents. |

The live tests below are opt-in. They spend subscription quota and stay skipped unless their variable is `1`. Run them only when the owner asks.

| File | Variable | Checks |
|---|---|---|
| `tests/live-opus46-routing.test.ts` | `PI_LIVE_CLAUDE_OPUS46_TEST` | The response model confirms that selecting `claude-opus-4-6` sends Opus 4.6. |
| `tests/live-opus46-routing.test.ts` | `PI_LIVE_CLAUDE_OPUS48_TOOL_TEST` | Opus 4.8 accepts a standard Anthropic tool schema. |
| `tests/live-opus-5-5.test.ts` | `PI_LIVE_CLAUDE_OPUS55_TEST` | A request without a Pi level is accepted with explicit `low` effort, and signed thinking replays across a tool-use turn. |
| `tests/live-long-session.test.ts` | `PI_LIVE_CLAUDE_LONG_SESSION_TEST` | The real `pi` CLI stays on the plan, reuses its cache, and round-trips emoji across a long session. |

`PI_LIVE_CLAUDE_LONG_SESSION_MODEL`, `PI_LIVE_CLAUDE_LONG_SESSION_THINKING`, and `PI_LIVE_CLAUDE_LONG_SESSION_IDLE_SECONDS` change the model, the thinking level, and the idle gap of the long-session test.

## Documentation

| File | Contents |
|---|---|
| [`README.md`](README.md) | Install, usage, configuration, and compatibility. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution rules, development setup, and test expectations. |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting, threat model, and secret handling. |
| [`AGENTS.md`](AGENTS.md) | Rules and workflow for agents working in this repository. |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history. |
| [`docs/architecture.md`](docs/architecture.md) | Public interface, request shape, model matrix, safety boundaries, credentials, model catalog, caching, stream handling, and replay rules. |
| [`docs/model-selection.md`](docs/model-selection.md) | How to choose between Opus snapshots and thinking levels. |
| [`docs/prompt-cache-live-verification.md`](docs/prompt-cache-live-verification.md) | Opt-in runbook and recorded results for prompt-cache behavior. |
| [`docs/rationale.md`](docs/rationale.md) | Why the package exists and why it is a native provider and not a proxy. |
| [`docs/slash-commands.md`](docs/slash-commands.md) | Output and meaning of the three slash commands. |
| [`docs/verification-gates.md`](docs/verification-gates.md) | Focused test gates per change type, and the supply-chain and runtime drift policy. |
