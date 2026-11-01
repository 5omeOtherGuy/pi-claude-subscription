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

One run on 2026-11-01 on one Claude subscription account with extra usage off: `claude-opus-5-5`, thinking `high`, Pi 1.4.0, commit `de9ab97`, whose provider code matches `3350af2`. These figures come from one account on one day. Anthropic decides how each request is billed and can change that at any time.

| Phase | Turns | Cache hit ratio | What it shows |
|---|---:|---:|---|
| Review of 61 files | 60 | 96.5% | Context grew to about 229,600 tokens. Every turn after the first read at least 90% of the previous context. |
| New process, same session | 3 | 99.5% | Restarting Pi keeps the cache. |
| After 5.5 idle minutes, 5-minute cache | 2 | 50.7% | The session's cache had expired. The first turn read 3,640 tokens and wrote 229,958. |
| After 5.5 idle minutes, 1-hour cache | 1 | 99.4% | A small separate session read 4,299 tokens and wrote 20 after the same gap. |
| Fresh session | 1 | 97.2% | A new session reuses the tools and system prompt. Emoji came back intact. |

The hit ratio is cache reads divided by all input tokens. A 2-turn setup for the 1-hour session is not shown. Across all 69 turns the run took 10 minutes 21 seconds, including the idle gap. It read 7.4 million tokens from cache, wrote 468,000 and sent 150 uncached input tokens, for a hit ratio of 94.0%.

All 69 responses were HTTP 200 with `anthropic-ratelimit-unified-status: allowed`, `anthropic-ratelimit-unified-overage-status: rejected` and `anthropic-ratelimit-unified-overage-disabled-reason: org_level_disabled`, and all came from `claude-opus-5-5`. So every request stayed within plan limits while extra usage was disabled. The 5-hour utilization header went from 0.06 to 0.07 and the 7-day header stayed at 0.73. Those headers are rounded, and other Claude sessions may have shared the plan during the run, so they do not measure this test's cost.

### One-hour cache

`PI_CACHE_RETENTION=long` works on the OAuth route, and the cache outlived the 5-minute lifetime in the phase above. The test does not show that it lasts a full hour.

The 1-hour cache has a cost. Pi's pricing code charges 1-hour cache writes at 2x the input price, against 1.25x for the 5-minute cache. At Opus 5.5 API prices, where cache reads cost 0.05x, the long session above would have cost about 11% less overall on the 1-hour cache with its one idle gap, and about 27% more with no gap. How the subscription counts these writes is unknown.

### Comparison with other Pi routes

This comparison ran offline with fake tokens on 2026-11-01. Pi 1.4.0 ran each route in a no-network sandbox through the same scripted session against a local server. Prefix reuse was then calculated from the captured requests using Anthropic's documented rule, in characters of JSON. These are simulated figures, not Anthropic's reported usage.

| Route | Cache breakpoints | Reuse within a session | First request of a new session rewrites |
|---|---|---|---|
| This provider | 4 | Each turn reuses the previous turn | 0.8% |
| Pi's built-in `anthropic` OAuth | 4 | Each turn reuses the previous turn | 0.7% |
| `pi-anthropic-auth` 3.4.3 | 4 | Each turn reuses the previous turn | 65.8% |

`pi-anthropic-auth` puts a per-conversation billing block before the system prompt, so a new session cannot reuse that prefix. At the same API prices, the scripted session cost about 7.8% more than this provider. The gap would be larger for many very short sessions and smaller for long ones.

Caching does not appear to explain the 3x to 4x usage gap reported in [its issue #83](https://github.com/gotgenes/pi-anthropic-auth/issues/83). The reporter changed only a request label, kept the same caching, and saw usage fall from 11% to 4%. That is one unconfirmed report.
