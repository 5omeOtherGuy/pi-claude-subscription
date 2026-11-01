# Claude Subscription Provider for Pi

Use Claude Pro and Max subscriptions in the Pi coding agent through Claude Code OAuth. Native streaming, tool calling, and thinking levels.

Status: released. Others depend on it: changes land only through pull requests that pass the gate, and releases follow SemVer (while the version is 0.x, a breaking change bumps the minor version).

[![gate](https://github.com/5omeOtherGuy/pi-claude-subscription/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/5omeOtherGuy/pi-claude-subscription/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What it does

This [Pi](https://pi.dev) package adds a native `claude-subscription` provider that signs in with your existing Claude Code login. You keep the same account and the same model ids, and Pi runs the agent loop.

The package bundles no credentials, uses no Anthropic API keys and runs no local proxy. At request time, the provider reads the Claude Code OAuth token from its standard credential store.

> Independent community package. Review the source before you install it, because Pi packages run with your local user permissions. It is for individual local subscription use only, not for resale, pooled access or replacing Anthropic API usage.

### Why use this provider

The table compares the Pi 1.4.0 routes to a Claude subscription on 2026-11-01. The entries come from requests captured with fake tokens against a local server and from reading each route's code. [`pi-anthropic-auth`](https://github.com/gotgenes/pi-anthropic-auth) is version 3.4.3.

| | This provider | `pi-anthropic-auth` | Pi's built-in `anthropic` login |
|---|---|---|---|
| Login | Reuses your Claude Code login | Separate `/login anthropic` | Separate `/login anthropic` |
| Given an API key | Ignores it and never sends `x-api-key` | Sends the key if no OAuth login is stored, or if you pass `--api-key` | Sends the key if no OAuth login is stored, or if you pass `--api-key` |
| Where your token can go | Fixed Anthropic URLs that no setting can change | Any `baseUrl` set in `models.json` | Any `baseUrl` set in `models.json` |
| What it changes in each request | Adds the Claude Code identity block, removes three doc-routing lines from Pi's prompt | Pi's route plus a billing block that marks the request as Claude Code usage, and a shortened Pi prompt | Adds the identity block, a `claude-cli` user-agent and `x-app: cli` |
| Share of a new session's first request that misses the cache | 0.8% | 65.8% | 0.7% |

The last row is simulated. We applied Anthropic's documented caching rule to requests captured from two short scripted sessions, whose first requests were about 9,000 to 10,500 characters. `pi-anthropic-auth` puts a per-conversation block before the system prompt, so a new session with a different first message cannot reuse that prefix. Across both sessions it added about 7.8% to input-side cost. Inside a session, all three reuse the previous turn the same way, so the difference shrinks as a session gets longer.

Because this provider has its own client, it also refuses a stream that breaks Anthropic's event order, and it refreshes the token and retries once after a 401.

Other routes are ahead in some ways:

- Pi's `cacheWarming` setting can refresh the cache during long tool runs on the other two routes, but not on this one. See [Long sessions](#long-sessions).
- This provider does not pick up Pi's Anthropic request changes automatically, so each one needs a change here.
- This provider sends no billing block. `pi-anthropic-auth` reports that Anthropic treats real-sized OAuth requests without that block as third-party usage and can answer with an extra-usage 400. Our long session did not hit that error, on one account with extra usage turned off.
- This provider needs Claude Code installed and logged in.

### Tested on long sessions

We ran this on a real repository, because short prompts can succeed where long sessions fail. On 2026-11-01, one Claude subscription account with extra usage turned off ran 69 turns of Opus 5.5 at `high` thinking on Pi 1.4.0: a read-only review of this repository, a restart, an idle gap and a fresh session.

- 94% of the input tokens came from the prompt cache.
- All 69 responses stayed within plan limits, and context grew to about 230,000 tokens.
- Restarting Pi kept the cache, and a fresh session reused the tools and system prompt.
- The one thing that lost the cache was sitting idle past 5 minutes. See [Long sessions](#long-sessions).

These figures come from one account on one day. Full results and the steps to repeat them are in [`docs/prompt-cache-live-verification.md`](docs/prompt-cache-live-verification.md).

### Billing and safety

The provider signs in only through the Claude Code OAuth credential store. It never sends `x-api-key`, never reads `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, and its stream refuses to run for any other provider before it loads credentials. This provider cannot bill your Anthropic API account.

It cannot control your Claude plan's metered extra usage, which is the subscription's own overage on the same OAuth route. Anthropic decides how each request is billed. The only control is the account toggle at <https://claude.ai/settings/usage>. Our long session ran within plan limits with that toggle off. We have not measured an account with it on. Pi's warning for its own `anthropic` route says third-party harness usage draws from extra usage, so check your balance if you turn it on. A request that fails with `400 ... "You're out of extra usage"` does not always mean your balance is empty. `pi-anthropic-auth` reports the same prompt failing without its block and succeeding with it.

While this package is loaded, it refuses new prompts sent through Pi's built-in `anthropic` provider and through providers named `custom-anthropic` or `meridian`. It does not block other providers. `pi-anthropic-auth` also uses the name `anthropic`, so this package refuses that package's default route. Pi's `/compact` and `/tree` summaries can still run on a session that already uses a blocked provider.

The package writes its local credential state to `pi-claude-subscription/` under Pi's agent directory and never changes Pi's `auth.json`. Treat `imported-credentials.json` as a secret and delete it when you no longer need it.

### How it works

The provider builds Anthropic Messages API requests itself and sets four headers: `Authorization: Bearer <Claude Code OAuth token>`, `Content-Type: application/json`, `anthropic-version` and `anthropic-beta`.

The request's `system` field is a list of content blocks. The first block is the Claude Code identity, `You are Claude Code, Anthropic's official CLI for Claude.`, and Pi's system prompt follows it. Tools use the standard Anthropic schema (`name`, `description`, `input_schema`, optional `cache_control`) without eager tool-input streaming.

Each request marks four prompt-cache points: both system blocks, the last tool and the last user block. The provider parses responses as they arrive, and an invalid stream ends the turn with an error. [`docs/architecture.md`](docs/architecture.md) and [`REPO_MAP.md`](REPO_MAP.md) cover the architecture, cache policy, stream guards and replay rules.

## Install

You need:

- Pi 0.80.6 or newer and Node.js 22.19.0 or newer; see [Compatibility](#compatibility).
- Claude Code installed and logged in on the same machine.
- A credential source: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json` (`.claudeAiOauth.accessToken`), a minimalcc-owned import from `/claude-subscription-import`, or on macOS a `Claude Code-credentials*` Keychain item.

If the provider cannot read the credential, requests fail with a login hint. It refreshes a token that has expired or is about to, retries once after a 401, and combines concurrent refreshes within one Pi process. It does not overwrite newer credentials that another process wrote.

```bash
pi install git:github.com/5omeOtherGuy/pi-claude-subscription
```

Pin a tag or commit for reproducible installs:

```bash
pi install git:github.com/5omeOtherGuy/pi-claude-subscription@<tag-or-commit>
```

## Usage

After you install it, start Pi as usual and the extension registers at startup. If Pi is already running, run `/reload`. You do not need `/login`, because the provider reuses the credential Claude Code wrote during its own login.

Run `/claude-subscription-status` in any Pi session to confirm that the extension loaded and to check your credentials. Then choose a model:

- `/model` or `Ctrl+L` opens the full picker, with the models under provider `claude-subscription`:
  `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-7-300k`, `claude-opus-4-8`, `claude-opus-5`, `claude-opus-5-5`, `claude-fable-5`, `claude-fable-5-1`, `claude-sonnet-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.
- Start directly: `pi --model claude-subscription/claude-sonnet-4-6`.
- Cycle thinking level with `Shift+Tab`, or `--thinking max` at startup.

`Ctrl+P` and `Shift+Ctrl+P` cycle through scoped models only. Add these models to that list with `/scoped-models`, `pi --models "claude-subscription/*"`, or in `~/.pi/agent/settings.json`:

```json
{ "enabledModels": ["claude-subscription/*"] }
```

Pi's built-in `anthropic` models may also be listed. They are separate from these models, and this package refuses new prompts on them while it is loaded.

Pi refreshes this provider's model list from Anthropic's `GET /v1/models` with the active Claude Code OAuth credential. If that request is offline, rejected or malformed, the models above stay available. The provider adds a new model only when the API supplies usable context, output and capability data, and known models keep their thinking-level map. The API list may not match the models enabled for your subscription, so a listed model can still fail when called. Refresh Pi's model list to pick up later catalog changes.

### Slash commands

The extension registers local slash commands. They make no Anthropic model call and record no prompt text, tool arguments, file paths or model output.

| Command | What it does |
|---|---|
| `/claude-subscription-status` | Reports provider wiring, the active provider, the discovered account, token freshness, refresh availability and credential errors. |
| `/claude-subscription-accounts` | Finds Claude Code OAuth accounts and saves the one you select in this package's state. |
| `/claude-subscription-import` | Copies the selected Claude Code credential into this package's state and uses that copy for future requests. |

[`docs/slash-commands.md`](docs/slash-commands.md) explains each command's output.

### Model reference

Pi has the thinking levels `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and, since Pi 0.80.6, opt-in `max`. This provider enables native `max` for every adaptive model. Manual-budget models stop at `xhigh`.

| Model | Context | Output cap | Pi thinking levels | Request thinking |
|---|---:|---:|---|---|
| `claude-haiku-4-5` | 200,000 | 64,000 | `off` to `xhigh`; no `max` | manual `budget_tokens` |
| `claude-sonnet-4-6` | 200,000 | 64,000 | `off` to `xhigh`; no `max` | manual `budget_tokens` |
| `claude-opus-4-6` | 1,000,000 | 128,000 | `off` to `xhigh`; no `max` | manual `budget_tokens` |
| `claude-opus-4-7` | 1,000,000 | 128,000 | `off` to `max` | adaptive |
| `claude-opus-4-7-300k` | 300,000 | 128,000 | `off` to `max` | adaptive; sends native `claude-opus-4-7` |
| `claude-opus-4-8` | 1,000,000 | 128,000 | `off` to `max` | adaptive |
| `claude-opus-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive |
| `claude-opus-5-5` | 1,000,000 | 128,000 | `minimal` to `max`; no `off` | adaptive; explicit effort every request; no refusal fallback |
| `claude-fable-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive; refusal fallback to `claude-opus-4-8` |
| `claude-fable-5-1` | 1,000,000 | 128,000 | `minimal` to `max`; no `off` | always-on adaptive; refusal fallback to `claude-opus-5` |
| `claude-sonnet-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive |
| `claude-sonnet-5-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive; `off` uses `between_tools` |
| `claude-haiku-5-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive; `off` uses `disabled` |

With reasoning on, adaptive models send `thinking: { type: "adaptive", display: "summarized" }` and map Pi levels to Claude `effort`, which guides the model and is not a fixed token budget:

| Pi level | Claude effort |
|---|---|
| `off` | model-specific; see below |
| `minimal` | `low` |
| `low` | `low` |
| `medium` | `medium` |
| `high` | `high` |
| `xhigh` | `xhigh` |
| `max` | `max` |

Notes:

- `claude-fable-5-1` and `claude-opus-5-5` cannot run without thinking: Pi hides `off`, and a persisted `off` clamps to `minimal` (Claude `low`). Every request sends explicit adaptive thinking and effort.
- `off` on `claude-sonnet-5-5` sends `thinking: { type: "between_tools" }` with effort `low`. It skips up-front reasoning but still returns thinking progress between tool calls. `off` on `claude-haiku-5-5` sends `thinking: { type: "disabled" }` with effort `low`. Neither mode is used at `xhigh` or `max`, where it returns a 400 error. Other adaptive models omit `thinking` and `output_config`, which does not guarantee that thinking is off.
- Anthropic's API defaults are `high` for Fable 5.1/Sonnet 5.5 and `medium` for Opus 5.5/Haiku 5.5. The provider sends Pi's selected level explicitly and does not fall back to the API default. All four support `low`, `medium`, `high`, `xhigh`, and `max`; Anthropic has no `minimal`, so Pi `minimal` maps to `low`.
- Verified against Anthropic's [effort reference](https://platform.claude.com/docs/en/build-with-claude/effort) and [per-model thinking rules](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting) on 2026-10-12. Sampling parameters and forced tool choice are not sent. Optional per-message effort and turn-scoped system-message betas are not implemented by this provider; effort is top-level per request.
- Manual-budget models compute `max_tokens = min(requestedOutputTokens + thinkingBudget, output_cap)`, where Pi `minimal`/`low`/`medium`/`high`/`xhigh` map to `1024`/`4096`/`10240`/`20480`/`32768`. Details: [`docs/architecture.md`](docs/architecture.md#manual-thinking-budgets).
- `claude-opus-4-7-300k` is a provider-local soft-cap route: Pi sees a 300,000-token window for selection, status, and compaction, while native requests send `claude-opus-4-7`.
- [`src/models.ts`](src/models.ts) holds the model metadata. Pi's `models.json` `modelOverrides` can override it.

After compaction or an edit to the prompt, tools or history, newer models can reject old thinking signatures. On that specific HTTP 400, the provider retries once without earlier thinking blocks and keeps text, tool calls and tool results. It does not change Pi's stored history or retry errors after streaming starts. See [thinking-block replay](docs/architecture.md#thinking-block-replay-across-model-switches).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | `$HOME/.claude` | Directory containing Claude Code `.credentials.json`. |
| `PI_CACHE_RETENTION` | unset | Set to `long` to keep the prompt cache for 1 hour instead of 5 minutes, unless Pi passes its own `cacheRetention` option. |

You need no environment variable beyond Claude Code's normal login.

### Long sessions

Anthropic's default prompt cache lasts 5 minutes. If a session sits idle or a tool runs for longer than that, the next turn rewrites the whole context. In our long session, that one turn wrote 230,000 tokens. Pi's `cacheWarming` setting does not prevent this here, because by default this provider's models declare no cache lifetime and are priced at zero. Pi's built-in Claude models do declare one, so on the other routes Pi refreshes the cache during long tool runs when it estimates a saving of at least $0.05, for up to an hour. Each refresh uses some of your plan. That comes from reading Pi's code, and we did not observe it running.

If your tasks often pause for 5 to 60 minutes, turn on the 1-hour cache before you start Pi:

```bash
export PI_CACHE_RETENTION=long
```

In a separate small session, the cache survived the same idle gap. The test does not show that it lasts the full hour.

Writing to the 1-hour cache costs more at API prices, 2x the input price against 1.25x. It pays off when the gap comes after enough context has built up. On the run above, with 230,000 tokens at the gap, it would cost about 11% less in input-side cost. With no gap it would cost about 27% more. One gap broke even at about 146,000 tokens on this run, and that figure changes with session size. A pause longer than an hour pays the higher write price and still loses the cache. How your subscription counts these writes is unknown.

## Compatibility

- Pi: `>=0.80.6 <2` (the package's `peerDependencies`). Pi 0.80.6 is the minimum for native `max` thinking. CI tests the locked Pi 1.3.0. Pi 0.80.6, 0.87.1 and 1.3.0 were verified on 2026-10-18 ([`docs/verification-gates.md`](docs/verification-gates.md#host-compatibility)), and the long-session test ran on Pi 1.4.0 on 2026-11-01.
- Node.js: 22.19.0 or newer, the same minimum as Pi. CI runs Node.js 22.19.0 (`.nvmrc`).
- Platforms: CI runs on Linux (Ubuntu 24.04). The credential file works wherever Claude Code writes it; the macOS Keychain fallback is covered by tests with a mocked Keychain only.
- Claude models: the models and thinking rules in the [model reference](#model-reference), checked against Anthropic's documentation on 2026-10-12. Details: [`docs/architecture.md`](docs/architecture.md#model-compatibility-matrix).

## Development

The default tests use fake credentials, static fixtures and mocked network calls, and make no live Anthropic requests.

```bash
npm ci
npm test
npm run typecheck
npm run check
```

`npm run check` is the gate: secret scan of tracked files, deterministic tests (including the `npm pack --dry-run` contents check), and TypeScript type-checking. CI runs exactly this command in the job `gate`. [`docs/verification-gates.md`](docs/verification-gates.md) lists focused checks by change type. The `tests/live-*` files are opt-in, spend subscription quota and are skipped by default. Keep their raw output in an ignored path such as `.local/`.

Run one test file while you work, for example:

```bash
node --test --import tsx tests/model-matrix.test.ts
```

[`INDEX.md`](INDEX.md) is the repository entry point; [`REPO_MAP.md`](REPO_MAP.md) maps the source and request flow. [`docs/architecture.md`](docs/architecture.md) covers the request shape, credentials, cache behavior, stream guards, and replay rules; [`docs/slash-commands.md`](docs/slash-commands.md) is the command output reference; [`docs/model-selection.md`](docs/model-selection.md) and [`docs/why-system-blocks.md`](docs/why-system-blocks.md) cover model and system-block choices; [`docs/verification-gates.md`](docs/verification-gates.md) documents test gates and dependency-drift policy; [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md) cover contribution and security.

## Contributing, support and security

- Contributions: [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
- Bugs, features and questions: [open an issue](https://github.com/5omeOtherGuy/pi-claude-subscription/issues/new/choose).
- Security problems: report them privately as described in [`SECURITY.md`](SECURITY.md), never in a public issue.

## License

MIT; see [`LICENSE`](LICENSE).
