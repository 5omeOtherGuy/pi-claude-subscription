# pi-claude-subscription

Use a Claude Pro or Max login with Pi's built-in `anthropic` provider, with a strict OAuth boundary and a local status command.

Status: released. Others depend on it: changes land only through pull requests that pass the gate, and releases follow SemVer (while the version is 0.x, a breaking change bumps the minor version).

[![gate](https://github.com/5omeOtherGuy/pi-claude-subscription/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/5omeOtherGuy/pi-claude-subscription/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What it does

A thin [Pi](https://pi.dev) extension. Pi does the work: login, token storage and refresh, the model list, thinking, message and tool conversion, streaming, retries, compaction and prompt caching. This extension adds two things:

- **An OAuth boundary.** Requests that carry an Anthropic OAuth token may only go to `https://api.anthropic.com/v1/messages`, with exactly that token as the only credential. Redirects are not followed, and token-shaped text is removed from Anthropic error bodies.
- **A status command.** `/claude-subscription-status` shows the route, the auth kind, and the last OAuth request's status, request id, stop reason and token/cache counters.

The request body is Pi's, unchanged. API-key, header and federation auth are passed to Pi untouched.

> Independent community package. Review the source before installing: Pi packages run with your user's permissions. Intended for individual use of your own subscription.

### Billing and safety

The extension does not decide how a request is billed. Whether it uses your plan's included usage or extra usage is up to Anthropic for your account. The extension does not stop extra usage and does not affect how Anthropic classifies or flags requests. The only control for extra usage is the account setting at <https://claude.ai/settings/usage>.

Credentials are Pi's. In Pi 1.3.0, an explicit `--api-key` wins, then a stored login (`/login`), then environment variables such as `ANTHROPIC_API_KEY`. If refreshing a stored OAuth token fails, Pi 1.3.0 fails the request and does not fall back to `ANTHROPIC_API_KEY`. That is Pi's behavior; the tests check it but the extension does not enforce it.

### How it works

The extension registers only a `streamSimple` on Pi's `anthropic` provider. It calls Pi's own Anthropic transport, resolved through Pi's extension loader and never from the shared api registry, and returns Pi's stream unchanged. OAuth requests get a fetch wrapper around the caller's fetch that checks the destination and wire auth, refuses redirects, redacts error bodies, and records metadata. Nothing global is patched. Request path, retained differences from Pi, coverage and test map: [`docs/architecture.md`](docs/architecture.md). Gaps that should be fixed in Pi: [`docs/upstream-gaps.md`](docs/upstream-gaps.md).

What is not covered:

- Requests made with pi-ai's bare `compat.streamSimple()` skip registered providers, so they bypass the boundary. Extensions should call `ctx.modelRegistry.streamSimple()`, which is covered. The main loop, compaction and model-registry calls are covered.
- Only the `anthropic` provider is wrapped. Other providers that serve `anthropic-messages` are not changed.
- If another extension registers an `anthropic` transport after this one, it takes over. The extension warns at startup and the status command shows `NOT COVERED`; it never unregisters the other extension.

## Install

You need Pi 1.3.0 or newer (below 2.0) and Node.js 22.19.0 or newer; see [Compatibility](#compatibility).

```bash
pi install git:github.com/5omeOtherGuy/pi-claude-subscription
```

Pin a tag or commit for reproducible installs (`...pi-claude-subscription@<tag-or-commit>`). In a running Pi, run `/reload`. Pi lists the extension as `5omeOtherGuy/pi-claude-subscription:pi-claude-subscription` (install source, then extension folder).

## Usage

1. `/login anthropic` and choose **Anthropic (Claude Pro/Max)**. This is Pi's own login; Pi stores and refreshes the token in its `auth.json`.
2. Pick a model with `/model`, for example `anthropic/claude-sonnet-4-6`, or start with `pi --model anthropic/claude-sonnet-4-6`.
3. Run `/claude-subscription-status` to confirm the route is covered.

`/claude-subscription-status` runs locally; it makes no request and reads no credential files. Example:

```text
pi-claude-subscription 0.1.0 on Pi 1.3.0
route: provider anthropic (anthropic-messages) -> OAuth gate -> Pi's own Anthropic transport
login: Pi built-in (/login anthropic)
anthropic auth: OAuth (stored)
current model: anthropic/claude-sonnet-4-6
not covered: direct compat.streamSimple callers (they bypass registered providers)
last OAuth request: 2026-10-18T10:00:00.000Z model=anthropic/claude-sonnet-4-6 status=200 request_id=req_… stop=stop usage input=11 output=5 cache_read=7 cache_write=3
```

Field reference: [`docs/slash-commands.md`](docs/slash-commands.md). Cache counters are Anthropic's numbers for that request; they are not a promise of quota savings.

### Migrating from 0.x (`claude-subscription` provider)

Earlier versions registered their own `claude-subscription` provider, read Claude Code's credential file or macOS Keychain, and had their own models and request builder. All of that is gone.

- Log in once with `/login anthropic` (Claude Pro/Max). Old Claude Code credentials are not imported or reused.
- Replace `claude-subscription/<model>` with `anthropic/<model>` in your `defaultProvider`/`defaultModel`, `enabledModels` (`"anthropic/*"`) and scripts. If an old selection is found, the extension shows a notice at startup but changes nothing. Model ids are now Pi's catalog: the old `claude-opus-4-7-300k` alias is gone.
- If you installed from the old URL (`git:github.com/5omeOtherGuy/minimalcc-pi`), Pi still lists the package under that name. Reinstall from `git:github.com/5omeOtherGuy/pi-claude-subscription` and remove the old entry with `pi remove`.
- Old sessions still open. When Pi replays turns made by the old provider, it drops their thinking blocks, because they came from a different provider.
- `/claude-subscription-accounts` and `/claude-subscription-import` are removed. Files the old version wrote under `<agent dir>/pi-claude-subscription/` and Claude Code's `.credentials.json` are left untouched; delete them yourself if you no longer need them.
- To go back to the old provider, install the commit before this rewrite: `pi install git:github.com/5omeOtherGuy/pi-claude-subscription@caf87d58bb385b77420937f25052dc5bc744f5f0`.

## Configuration

The extension has no settings and reads no environment variables. Prompt-cache retention (`PI_CACHE_RETENTION`, `cacheRetention`) and all auth settings are Pi's.

## Compatibility

- Pi: `>=1.3.0 <2` (the package's `peerDependencies`). Only Pi 1.3.0 is tested; the host contracts the wrapper relies on are listed in [`docs/verification-gates.md`](docs/verification-gates.md#host-compatibility).
- Node.js: 22.19.0 or newer, matching Pi's own `engines.node` floor. CI runs Node.js 22.19.0 (`.nvmrc`).
- Platforms: CI runs on Linux (Ubuntu 24.04). The extension has no platform-specific code.
- Claude models: whatever Pi's `anthropic` catalog provides.

## Development

The tests are deterministic and use fake credentials and stubbed network calls. They make no live Anthropic or OAuth requests.

```bash
npm ci
npm test
npm run typecheck
npm run check   # the gate: secret scan, tests (incl. npm pack check), typecheck; CI job `gate`
```

Run one test file while you work, for example:

```bash
node --test --import tsx tests/transport.test.ts
```

[`INDEX.md`](INDEX.md) is the repository entry point and [`REPO_MAP.md`](REPO_MAP.md) maps the source. Focused gates by change type: [`docs/verification-gates.md`](docs/verification-gates.md).

## Contributing, support and security

- Contributions: [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
- Bugs, features and questions: [open an issue](https://github.com/5omeOtherGuy/pi-claude-subscription/issues/new/choose).
- Security problems: report them privately as described in [`SECURITY.md`](SECURITY.md), never in a public issue.

## License

MIT; see [`LICENSE`](LICENSE).
