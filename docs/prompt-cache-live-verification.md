# Prompt-cache live verification runbook

Opt-in runbook for verifying that native Claude subscription requests get real Anthropic prompt-cache reads after a warmup. It consumes subscription quota. Do not commit live logs; use an ignored local path.

## Deterministic checks first

```bash
npm test
npm run typecheck
git diff --check
```

These prove the payload anchors and no-live-request test boundaries without spending quota.

## Live pattern

Run at least two comparable requests in one session, using the same model, tools, system prompt, and prompt shape each turn. Read Anthropic's `usage` (`cache_creation_input_tokens` / `cache_read_input_tokens`) from the stream's `message_start` / `message_delta` events; the Pi assistant message exposes them as `usage.cacheWrite` and `usage.cacheRead`.

1. Warmup: expect `cache_creation_input_tokens > 0` if Anthropic writes a cache entry.
2. Repeat with the same stable prefix: expect `cache_read_input_tokens > 0`.

Pass signal: turn 1 writes cache (or Anthropic otherwise reports creation), turn 2+ reads it, and answer/tool-call behavior stays plausible.

## Long-session test

`tests/live-long-session.test.ts` drives the real `pi` CLI through a read-only review of this repository, one file per turn. It then restarts the process, waits past the 5-minute cache lifetime, and starts a fresh session that checks emoji survive the round trip. It spends subscription quota, so it is skipped unless you enable it:

```bash
PI_LIVE_CLAUDE_LONG_SESSION_TEST=1 node --test --import tsx tests/live-long-session.test.ts
```

Set `PI_LIVE_PI_BIN` to run an installed Pi instead of the locked devDependency. `PI_LIVE_CLAUDE_LONG_SESSION_MODEL`, `PI_LIVE_CLAUDE_LONG_SESSION_THINKING` and `PI_LIVE_CLAUDE_LONG_SESSION_IDLE_SECONDS` change the model, the thinking level and the idle gap. Per-turn results go to the ignored `.local/live-long-session/` directory.

## Interpreting failures

- `cacheRead` always zero: check that the prompt is above Anthropic's cache thresholds, cache anchors are present, and the same model/session/request shape is used.
- `cacheRead` drops after working: compare the outgoing request shape between turns. Changes to tools/schemas, system blocks, message history, or cache-control/body config can break reuse.
- The API rejects cache fields: keep the failing request local, redact secrets, and treat the feature as unsupported on this route until investigated.

## Recorded results

One run on 2026-11-01 on a Claude Max account with extra usage off: `claude-opus-5-5`, thinking `high`, Pi 1.4.0, this repository at `3350af2`. These figures come from one account on one day. Anthropic decides how each request is billed and can change that at any time.

| Phase | Turns | Cache hit ratio | What it shows |
|---|---:|---:|---|
| Review of 61 files | 62 | 96.8% | Context grew to about 229,000 tokens, and every turn after the first read the cache. |
| New process, same session | 3 | 99.4% | Restarting Pi keeps the cache. |
| After 5.5 idle minutes | 2 | 49.9% | The cache had expired, so the first turn read nothing and wrote 233,986 tokens. |
| Fresh session | 1 | 97.2% | A new session reuses the tools and system prompt. Emoji came back intact. |

Across all 68 turns the run took 10 minutes 20 seconds, including the idle gap. It read 7.7 million tokens from cache, wrote 465,000, sent 144 uncached input tokens, and had a hit ratio of 94.3%. Every response was HTTP 200 with `anthropic-ratelimit-unified-status: allowed` and `anthropic-ratelimit-unified-overage-status: rejected`, so requests stayed within plan limits while extra usage was refused. The 5-hour utilization header went from 0.30 to 0.33 and the 7-day header from 0.69 to 0.70. Other Claude sessions shared that plan during the run, so those changes are an upper limit for this test.

### One-hour cache

A second check used `PI_CACHE_RETENTION=long` with the same 5.5-minute gap. The turn after the gap read 3,450 tokens and wrote 20, so the 1-hour lifetime works on the OAuth route. That check used a small session and ran once.

The 1-hour cache has a cost. Pi's pricing code charges cache writes at 2x the input price, against 1.25x for the 5-minute cache. Applied to the run above at API prices, one expired cache makes the 1-hour setting about 20% cheaper on cache writes. With no idle gap it would cost 60% more. How the subscription counts these writes is unknown.

### Comparison with other Pi routes

This comparison ran offline with fake tokens on 2026-11-01. Pi 1.4.0 ran each route in a no-network sandbox through the same scripted session against a local server. Prefix reuse was then calculated from the captured requests using Anthropic's documented rule. These are simulated figures, not Anthropic's reported usage.

| Route | Cache breakpoints | Reuse within a session | First request of a new session rewrites |
|---|---|---|---|
| This provider | 4 | Each turn reuses the previous turn | 0.8% |
| Pi's built-in `anthropic` OAuth | 4 | Each turn reuses the previous turn | 0.7% |
| `pi-anthropic-auth` 3.4.3 | 4 | Each turn reuses the previous turn | 65.8% |

`pi-anthropic-auth` puts a per-conversation billing block before the system prompt, so a new session cannot reuse that prefix. Over the scripted session that came to about 6.5% more input-equivalent cost than this provider, which cannot explain the 3x to 4x usage gap in [its issue #83](https://github.com/gotgenes/pi-anthropic-auth/issues/83). That report traced the gap to a request label, and it remains one unconfirmed report.
