# Claude Subscription Provider for Pi

Use a Claude Pro or Max subscription in the Pi coding agent through your Claude Code login. The provider supports native streaming, tool calling, and thinking levels.

Status: released. Changes land only through pull requests that pass the gate, and releases follow SemVer. While the version is 0.x, a breaking change bumps the minor version.

[![gate](https://github.com/5omeOtherGuy/pi-claude-subscription/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/5omeOtherGuy/pi-claude-subscription/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What it does

This [Pi](https://pi.dev) package adds a native `claude-subscription` provider. The provider signs in with your existing Claude Code login, so you keep the same account and the same model IDs while Pi runs the agent loop.

The package bundles no credentials, uses no Anthropic API keys, and runs no local proxy. For each request, the provider reads the Claude Code OAuth token from its standard credential store.

> This is an independent community package. Pi packages run with your local user permissions, so review the source before you install it. Use it only for individual, local subscription use. Do not use it for resale, pooled access, or as a replacement for Anthropic API usage.

### Why use this provider

This table compares three ways to reach a Claude subscription from Pi 1.4.0, as of 2026-11-01. The entries come from requests captured with fake tokens against a local server and from reading each route's code. [`pi-anthropic-auth`](https://github.com/gotgenes/pi-anthropic-auth) is version 3.4.3.

| | This provider | `pi-anthropic-auth` | Pi's built-in `anthropic` login |
|---|---|---|---|
| Login | Reuses your Claude Code login | Separate `/login anthropic` | Separate `/login anthropic` |
| Given an API key | Ignores it and never sends `x-api-key` | Sends the key if no OAuth login is stored, or if you pass `--api-key` | Sends the key if no OAuth login is stored, or if you pass `--api-key` |
| Where your token can go | Fixed Anthropic URLs that no setting can change | Any `baseUrl` set in `models.json` | Any `baseUrl` set in `models.json` |
| What it changes in each request | Adds the Claude Code identity block and removes three doc-routing lines from Pi's prompt | Same as Pi's built-in login, plus a billing block that marks the request as Claude Code usage and a shorter Pi prompt | Adds the identity block, a `claude-cli` user-agent, and `x-app: cli` |
| Share of a new session's first request that misses the cache | 0.8% | 65.8% | 0.7% |

The last row is simulated. We applied Anthropic's documented caching rule to requests captured from two short scripted sessions. Their first requests were about 9,000 to 10,500 characters.

`pi-anthropic-auth` puts a per-conversation block before the system prompt. A new session with a different first message therefore cannot reuse that prefix. Across both sessions, `pi-anthropic-auth` cost about 7.8% more on the input side. Inside a session, all three routes reuse the previous turn in the same way, so the difference shrinks as a session gets longer.

This provider has its own client, so it does two things that Pi's built-in route does not. It refuses a stream that breaks Anthropic's event order. It also refreshes the token and retries once after a 401.

The other routes are ahead in these ways:

- Pi's `cacheWarming` setting can refresh the cache during long tool runs on the other two routes, but not on this one. See [Long sessions](#long-sessions).
- The other routes pick up Pi's Anthropic request changes automatically. This provider needs a change here for each one.
- `pi-anthropic-auth` sends a billing block, and this provider does not. `pi-anthropic-auth` reports that Anthropic treats real-sized OAuth requests without that block as third-party usage and can answer with an extra-usage 400. Our long session did not hit that error, on one account with extra usage turned off.
- The other routes work without Claude Code. This provider needs Claude Code installed and logged in.

### Tested on long sessions

Short prompts can succeed where long sessions fail, so we ran this provider on a real repository. On 2026-11-01, one Claude subscription account with extra usage turned off ran 69 turns of Opus 5.5 at `high` thinking on Pi 1.4.0. The run was a read-only review of this repository, a restart, an idle gap, and a fresh session.

The run gave these results:

- 94% of the input tokens came from the prompt cache.
- All 69 responses stayed within plan limits.
- Context grew to about 230,000 tokens.
- Restarting Pi kept the cache.
- A fresh session reused the tools and the system prompt.
- An idle gap longer than 5 minutes was the one thing that lost the cache. See [Long sessions](#long-sessions).

These figures come from one account on one day. For the full results and the steps to repeat them, see [`docs/prompt-cache-live-verification.md`](docs/prompt-cache-live-verification.md).

### Billing and safety

The provider signs in only through the Claude Code OAuth credential store. It never sends `x-api-key` and never reads `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`. Its stream refuses to run for any other provider, and it checks that before it loads credentials. As a result, this provider cannot bill your Anthropic API account.

The provider cannot control extra usage, the metered overage on your Claude plan. Extra usage runs on the same OAuth route. Anthropic decides how each request is billed, and your only control is the account toggle at <https://claude.ai/settings/usage>. Our long session ran within plan limits with that toggle off. We have not measured an account with the toggle on. Pi's warning for its own `anthropic` route says that third-party harness usage draws from extra usage, so check your balance if you turn the toggle on.

An error that says `400 ... "You're out of extra usage"` does not always mean that your balance is empty. `pi-anthropic-auth` reports that the same prompt fails without its billing block and succeeds with it.

While this package is loaded, it refuses new prompts sent through Pi's built-in `anthropic` provider and through providers named `custom-anthropic` or `meridian`. It does not block other providers. `pi-anthropic-auth` also uses the name `anthropic`, so this package refuses that package's default route. Pi's `/compact` and `/tree` summaries can still run on a session that already uses a blocked provider.

The package writes its local credential state to `pi-claude-subscription/` in Pi's agent directory. It never changes Pi's `auth.json`. Treat `imported-credentials.json` as a secret, and delete it when you no longer need it.

### How it works

The provider builds Anthropic Messages API requests itself and sets four headers: `Authorization: Bearer <Claude Code OAuth token>`, `Content-Type: application/json`, `anthropic-version`, and `anthropic-beta`.

The request's `system` field is a list of content blocks. The first block is the Claude Code identity, `You are Claude Code, Anthropic's official CLI for Claude.` Pi's system prompt follows it. Tools use the standard Anthropic schema: `name`, `description`, `input_schema`, and optional `cache_control`. The provider does not use eager tool-input streaming.

Each request marks four prompt-cache points: both system blocks, the last tool, and the last user block. The provider parses responses as they arrive, and an invalid stream ends the turn with an error. For the architecture, cache policy, stream guards, and replay rules, see [`docs/architecture.md`](docs/architecture.md) and [`REPO_MAP.md`](REPO_MAP.md).

## Install

Before you install, make sure that you have:

- Pi 0.80.6 or newer and Node.js 22.19.0 or newer. See [Compatibility](#compatibility).
- Claude Code installed and logged in on the same machine.
- One credential source: the file `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json` (`.claudeAiOauth.accessToken`), a copy made with `/claude-subscription-import`, or, on macOS, the `Claude Code-credentials` Keychain item.

To install the package, run:

```bash
pi install git:github.com/5omeOtherGuy/pi-claude-subscription
```

To pin a tag or commit for reproducible installs, run:

```bash
pi install git:github.com/5omeOtherGuy/pi-claude-subscription@<tag-or-commit>
```

If the provider cannot read the credential, requests fail with a login hint. The provider refreshes a token that has expired or is about to expire. It retries once after a 401, and it combines concurrent refreshes within one Pi process. It does not overwrite newer credentials that another process wrote.

## Usage

To start using the provider:

1. Start Pi. The extension registers at startup. If Pi is already running, run `/reload`. You do not need `/login`, because the provider reuses the credential that Claude Code wrote.
2. Run `/claude-subscription-status` to confirm that the extension loaded and to check your credentials.
3. Run `/model` or press `Ctrl+L`, then choose a model under provider `claude-subscription`. To start with a model directly, run `pi --model claude-subscription/claude-sonnet-4-6`.

To cycle the thinking level, press `Shift+Tab`. To set it at startup, pass `--thinking max`.

`Ctrl+P` and `Shift+Ctrl+P` cycle through scoped models only. To add these models to that list, use `/scoped-models`, pass `pi --models "claude-subscription/*"`, or add this setting to `~/.pi/agent/settings.json`:

```json
{ "enabledModels": ["claude-subscription/*"] }
```

Pi's built-in `anthropic` models may also be listed. They are separate from these models, and this package refuses new prompts on them while it is loaded.

Pi refreshes this provider's model list from Anthropic's `GET /v1/models` with the active Claude Code OAuth credential. If that request is offline, rejected, or malformed, the models in the [model reference](#model-reference) stay available. The provider adds a new model only when the API supplies usable context, output, and capability data. Known models keep their thinking-level map. The API list may not match the models enabled for your subscription, so a listed model can still fail when you call it. To pick up later catalog changes, refresh Pi's model list.

### Slash commands

The extension registers three local slash commands. They make no Anthropic model call and record no prompt text, tool arguments, file paths, or model output.

| Command | What it does |
|---|---|
| `/claude-subscription-status` | Reports provider wiring, the active provider, the discovered account, token freshness, refresh availability, and credential errors. |
| `/claude-subscription-accounts` | Finds Claude Code OAuth accounts and saves the one you select in this package's state. |
| `/claude-subscription-import` | Copies the selected Claude Code credential into this package's state and uses that copy for future requests. |

For each command's output, see [`docs/slash-commands.md`](docs/slash-commands.md).

### Model reference

Pi has the thinking levels `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Since Pi 0.80.6, it also has opt-in `max`. This provider enables native `max` for every adaptive model. Manual-budget models stop at `xhigh`.

| Model | Context | Output cap | Pi thinking levels | Request thinking |
|---|---:|---:|---|---|
| `claude-haiku-4-5` | 200,000 | 64,000 | `off` to `xhigh`, no `max` | manual `budget_tokens` |
| `claude-sonnet-4-6` | 200,000 | 64,000 | `off` to `xhigh`, no `max` | manual `budget_tokens` |
| `claude-opus-4-6` | 1,000,000 | 128,000 | `off` to `xhigh`, no `max` | manual `budget_tokens` |
| `claude-opus-4-7` | 1,000,000 | 128,000 | `off` to `max` | adaptive |
| `claude-opus-4-7-300k` | 300,000 | 128,000 | `off` to `max` | adaptive, sends native `claude-opus-4-7` |
| `claude-opus-4-8` | 1,000,000 | 128,000 | `off` to `max` | adaptive |
| `claude-opus-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive |
| `claude-opus-5-5` | 1,000,000 | 128,000 | `minimal` to `max`, no `off` | adaptive, explicit effort on every request, no refusal fallback |
| `claude-fable-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive, refusal fallback to `claude-opus-4-8` |
| `claude-fable-5-1` | 1,000,000 | 128,000 | `minimal` to `max`, no `off` | always-on adaptive, refusal fallback to `claude-opus-5` |
| `claude-sonnet-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive |
| `claude-sonnet-5-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive, `off` uses `between_tools` |
| `claude-haiku-5-5` | 1,000,000 | 128,000 | `off` to `max` | adaptive, `off` uses `disabled` |

With reasoning on, adaptive models send `thinking: { type: "adaptive", display: "summarized" }`. They also map Pi levels to Claude `effort`. Effort guides the model and is not a fixed token budget.

| Pi level | Claude effort |
|---|---|
| `off` | Model-specific, see the notes below |
| `minimal` | `low` |
| `low` | `low` |
| `medium` | `medium` |
| `high` | `high` |
| `xhigh` | `xhigh` |
| `max` | `max` |

These notes apply to the tables above:

- `claude-fable-5-1` and `claude-opus-5-5` cannot run without thinking. Pi hides `off`. A persisted `off` clamps to `minimal`, so Claude receives `low`. Every request sends explicit adaptive thinking and effort.
- `off` on `claude-sonnet-5-5` sends `thinking: { type: "between_tools" }` with effort `low`. It skips up-front reasoning but still returns thinking progress between tool calls.
- `off` on `claude-haiku-5-5` sends `thinking: { type: "disabled" }` with effort `low`.
- The provider uses neither of those two modes at `xhigh` or `max`, where they return a 400 error.
- Other adaptive models omit `thinking` and `output_config`. That omission does not guarantee that thinking is off.
- Anthropic's API defaults are `high` for Fable 5.1 and Sonnet 5.5, and `medium` for Opus 5.5 and Haiku 5.5. The provider sends Pi's selected level explicitly and does not fall back to the API default.
- All four of those models support `low`, `medium`, `high`, `xhigh`, and `max`. Anthropic has no `minimal`, so Pi `minimal` maps to `low`.
- The provider does not send sampling parameters or forced tool choice.
- The provider does not implement optional per-message effort or turn-scoped system-message betas. It sets effort once per request, at the top level.
- Manual-budget models compute `max_tokens = min(requestedOutputTokens + thinkingBudget, output_cap)`. Pi `minimal`, `low`, `medium`, `high`, and `xhigh` map to `1024`, `4096`, `10240`, `20480`, and `32768`. For details, see [manual thinking budgets](docs/architecture.md#manual-thinking-budgets).
- `claude-opus-4-7-300k` is a provider-local soft cap. Pi sees a 300,000-token window for selection, status, and compaction, but native requests send `claude-opus-4-7`.
- [`src/models.ts`](src/models.ts) holds the model metadata. Pi's `models.json` `modelOverrides` can override it.

We checked these rules against Anthropic's [effort reference](https://platform.claude.com/docs/en/build-with-claude/effort) and [per-model thinking rules](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting) on 2026-10-12.

After compaction or an edit to the prompt, tools, or history, newer models can reject old thinking signatures. On that specific HTTP 400, the provider retries once without earlier thinking blocks and keeps text, tool calls, and tool results. It does not change Pi's stored history, and it does not retry errors after streaming starts. See [thinking-block replay](docs/architecture.md#thinking-block-replay-across-model-switches).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | `$HOME/.claude` | Directory that contains the Claude Code `.credentials.json`. |
| `PI_CACHE_RETENTION` | unset | Set to `long` to keep the prompt cache for 1 hour instead of 5 minutes, unless Pi passes its own `cacheRetention` option. |

Neither variable is required.

### Long sessions

Anthropic's default prompt cache lasts 5 minutes. If a session sits idle or a tool runs for longer than that, the next turn rewrites the whole context. In our long session, that one turn wrote 230,000 tokens.

Pi's `cacheWarming` setting does not prevent this on this provider. By default, this provider's models declare no cache lifetime and are priced at zero. Pi's built-in Claude models do declare a lifetime. On the other routes, Pi refreshes the cache during long tool runs when it estimates a saving of at least $0.05, for up to an hour. Each refresh uses some of your plan. These statements come from reading Pi's code, and we did not observe warming run.

If your tasks often pause for 5 to 60 minutes, turn on the 1-hour cache before you start Pi:

```bash
export PI_CACHE_RETENTION=long
```

In a separate small session, the 1-hour cache survived the same idle gap. That test does not show that the cache lasts the full hour.

At API prices, a write to the 1-hour cache costs 2x the input price, against 1.25x for the 5-minute cache. The 1-hour cache pays off when a gap comes after enough context has built up. On the long run above, the 1-hour cache would change input-side cost as follows:

- With its one gap, at 230,000 tokens, the cost falls by about 11%.
- With no gap, the cost rises by about 27%.

One gap broke even at about 146,000 tokens on this run, and that figure changes with session size. A pause longer than an hour pays the higher write price and still loses the cache. How your subscription counts these writes is unknown.

## Compatibility

- Pi: `>=0.80.6 <2`, the package's `peerDependencies`. Pi 0.80.6 is the minimum for native `max` thinking. CI tests the locked Pi 1.4.0. We verified Pi 0.80.6, 0.87.1, and 1.3.0 on 2026-10-18, before that lock moved ([`docs/verification-gates.md`](docs/verification-gates.md#host-compatibility)). The long-session test ran on Pi 1.4.0 on 2026-11-01.
- Node.js: 22.19.0 or newer, the same minimum as Pi. CI runs Node.js 22.19.0 (`.nvmrc`).
- Platforms: CI runs on Linux (Ubuntu 24.04). The credential file works wherever Claude Code writes it. Only tests with a mocked Keychain cover the macOS Keychain fallback.
- Claude models: the models and thinking rules in the [model reference](#model-reference), checked against Anthropic's documentation on 2026-10-12. For details, see the [model compatibility matrix](docs/architecture.md#model-compatibility-matrix).

## Development

The default tests use fake credentials, static fixtures, and mocked network calls. They make no live Anthropic requests.

```bash
npm ci
npm test
npm run typecheck
npm run check
```

`npm run check` is the gate. It runs a secret scan of tracked files, the deterministic tests, and TypeScript type-checking. The tests include the `npm pack --dry-run` contents check. CI runs exactly this command in the job `gate`. For focused checks by change type, see [`docs/verification-gates.md`](docs/verification-gates.md).

The `tests/live-*` files are opt-in, spend subscription quota, and are skipped by default. Keep their raw output in an ignored path such as `.local/`.

To run one test file while you work, run:

```bash
node --test --import tsx tests/model-matrix.test.ts
```

These files explain the repository:

- [`INDEX.md`](INDEX.md) is the repository entry point.
- [`REPO_MAP.md`](REPO_MAP.md) maps the source and the request flow.
- [`docs/architecture.md`](docs/architecture.md) covers the request shape, credentials, cache behavior, stream guards, and replay rules.
- [`docs/slash-commands.md`](docs/slash-commands.md) is the command output reference.
- [`docs/model-selection.md`](docs/model-selection.md) covers model choices.
- [`docs/why-system-blocks.md`](docs/why-system-blocks.md) covers system-block choices.
- [`docs/verification-gates.md`](docs/verification-gates.md) documents the test gates and the dependency-drift policy.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) covers contributions.
- [`SECURITY.md`](SECURITY.md) covers security.

## Contributing, support and security

- Contributions: see [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
- Bugs, features, and questions: [open an issue](https://github.com/5omeOtherGuy/pi-claude-subscription/issues/new/choose).
- Security problems: report them privately as described in [`SECURITY.md`](SECURITY.md), never in a public issue.

## License

MIT. See [`LICENSE`](LICENSE).
