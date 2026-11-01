# Prompt-cache live verification

This page shows how to check that native Claude subscription requests get real Anthropic prompt-cache reads after a warmup, and it records the results so far.

## Run the live checks

The live checks spend subscription quota, so run them only when the owner asks. Keep live logs in an ignored local path and do not commit them.

### Run the deterministic checks first

```bash
npm test
npm run typecheck
git diff --check
```

These commands prove the payload anchors and the test boundaries that block live requests. They spend no quota.

### Check cache reads in a short session

Run at least two comparable requests in one session. Use the same model, tools, system prompt, and prompt shape on each turn.

Read Anthropic's `usage` from the `message_start` and `message_delta` stream events. Its fields are `cache_creation_input_tokens` and `cache_read_input_tokens`. The Pi assistant message has the same counts in `usage.cacheWrite` and `usage.cacheRead`.

1. Send the warmup request. If Anthropic writes a cache entry, expect `cache_creation_input_tokens > 0`.
2. Repeat the request with the same stable prefix. Expect `cache_read_input_tokens > 0`.

The check passes if Anthropic reports a cache creation on the first turn, the second and later turns read that cache, and the answers and tool calls stay plausible.

### Run the long-session test

`tests/live-long-session.test.ts` drives the real `pi` CLI through a read-only review of this repository and then tests cache reuse across a restart, an idle gap, and a new session. The test is skipped unless you enable it.

1. Install the locked dependencies.

   ```bash
   npm ci
   ```

2. Start the test.

   ```bash
   PI_LIVE_CLAUDE_LONG_SESSION_TEST=1 node --test --import tsx tests/live-long-session.test.ts
   ```

3. Open the result file. The test prints its path as a diagnostic.

To change the run, set these variables:

| Variable | Default | Effect |
|---|---|---|
| `PI_LIVE_PI_BIN` | `node_modules/.bin/pi`, the locked devDependency | Runs this Pi binary instead. |
| `PI_LIVE_CLAUDE_LONG_SESSION_MODEL` | `claude-opus-5-5` | Sets the model. |
| `PI_LIVE_CLAUDE_LONG_SESSION_THINKING` | `high` | Sets the thinking level. |
| `PI_LIVE_CLAUDE_LONG_SESSION_IDLE_SECONDS` | `330` | Sets the idle gap. |

Keep the idle gap above 300 seconds. At 300 or less, the test skips its check that the 5-minute cache expired, and the one-hour check then proves nothing. The test sets `PI_CACHE_RETENTION` itself for each phase, so a value in your shell has no effect.

The phases run in this order. The test waits for the idle gap between `one-hour-start` and `one-hour-after-idle`.

| Phase | What Pi does | What the test checks |
|---|---|---|
| `long` | Starts a session and reviews `src`, `extensions/pi-claude-subscription`, `docs`, and `tests`, one file per turn. | The session takes at least 50 turns. Every turn after the first reads at least 90% of the previous turn's context. The phase hit ratio is at least 0.8. |
| `resumed` | Starts a new process, continues the `long` session, and reads `package.json` and then `AGENTS.md`. | The first turn reads at least 90% of the context of the last `long` turn. |
| `one-hour-start` | Starts a separate session with `PI_CACHE_RETENTION=long` and reads `LICENSE`. | Nothing beyond the checks on every phase. |
| `one-hour-after-idle` | Continues the separate session with the same setting. | The first turn reads at least 90% of the context of the last `one-hour-start` turn. |
| `after-idle` | Continues the `long` session on the 5-minute cache and reads `LICENSE`. | The first turn reads less than half of the context of the last `resumed` turn. |
| `fresh` | Starts a new session and asks Claude to repeat an emoji string. | The first turn reads from the cache, and the output contains the emoji string. |

Every phase must exit with code 0, record at least one turn, and end no turn in error. If a phase fails one of these checks, the test stops so that the run spends no more quota. The test checks the `long` phase when that phase ends. It checks the other phases after `fresh`.

After `fresh`, the test also requires one response for each turn, HTTP 200 on every response, and a plan status of `allowed` or `allowed_warning`. Every turn must use the `claude-subscription` provider and come from the requested model.

The test writes its results to `.local/live-long-session/<startedAt>.json`, even if the run fails. The directory is ignored by git. The timestamp in the file name has hyphens in place of colons and dots. The file holds usage counts for each turn and the quota headers, and it holds no prompts or tool output. `filesListed` counts the files named in the prompt, not the files the model read.

### Diagnose cache failures

- If `cacheRead` is always zero, check that the prompt is above Anthropic's cache thresholds and that the cache anchors are present. Also check that every request uses the same model, session, and request shape.
- If `cacheRead` drops after working, compare the outgoing request shape between turns. A change to tools, schemas, system blocks, message history, cache control, or body configuration can break reuse.
- If the API rejects cache fields, keep the failing request local and redact secrets. Treat the feature as unsupported on this route until someone investigates.

## Recorded results

### Long-session run on 2026-11-01

One run on 2026-11-01 on one Claude subscription account with extra usage off, using `claude-opus-5-5`, thinking `high`, and Pi 1.4.0. The run used commit `de9ab97` and an earlier version of `tests/live-long-session.test.ts`. The provider code at `de9ab97` matches `3350af2`.

These figures come from one account on one day. Anthropic decides how each request is billed and can change that at any time.

| Phase | Turns | Cache hit ratio | What it shows |
|---|---:|---:|---|
| Read-only repository review | 60 | 96.6% | Context grew to about 229,600 tokens. Every turn after the first read at least 90% of the previous context. |
| New process, same session | 3 | 99.5% | Restarting Pi keeps the cache. |
| After 5.5 idle minutes, 5-minute cache | 2 | 50.7% | The session's cache had expired. The first turn read 3,640 tokens and wrote 229,958. |
| After 5.5 idle minutes, 1-hour cache | 1 | 99.4% | A small separate session read 4,299 tokens and wrote 20 after the same gap. |
| Fresh session | 1 | 97.2% | A new session reuses the tools and system prompt. Emoji came back intact. |

The hit ratio is cache reads divided by all input tokens. The table leaves out a 2-turn setup for the 1-hour session.

Across all 69 turns the run took 10 minutes 21 seconds, including the idle gap. It read 7.4 million tokens from cache, wrote 468,000, and sent 150 uncached input tokens, for a hit ratio of 94.0%.

All 69 responses were HTTP 200 with `anthropic-ratelimit-unified-status: allowed`, `anthropic-ratelimit-unified-overage-status: rejected`, and `anthropic-ratelimit-unified-overage-disabled-reason: org_level_disabled`. All came from `claude-opus-5-5`. So every request stayed within plan limits while extra usage was disabled.

The 5-hour utilization header went from 0.06 to 0.07 and the 7-day header stayed at 0.73. Those headers are rounded, and other Claude sessions may have shared the plan during the run, so they do not measure this test's cost.

### One-hour cache

`PI_CACHE_RETENTION=long` works on the OAuth route, and the cache outlived the 5-minute lifetime in the run above. The test does not show that the cache lasts a full hour.

Pi's pricing code charges 1-hour cache writes at 2x the input price, against 1.25x for the 5-minute cache. At Opus 5.5 API prices, where cache reads cost 0.05x, the long session above would have cost about 11% less in input-side cost on the 1-hour cache with its one idle gap, and about 27% more with no gap.

The gap in this run came at peak context, which favors the 1-hour cache. The 1-hour cache breaks even at about 146,000 tokens of context. How the subscription counts these writes is unknown.

### Comparison with other Pi routes

This comparison ran offline with fake tokens on 2026-11-01. Pi 1.4.0 ran each route in a no-network sandbox through the same two scripted sessions, of 9 and 4 requests, against a local server. We then calculated prefix reuse from the captured requests with Anthropic's documented rule, in characters of JSON. These are simulated figures, not Anthropic's reported usage.

| Route | Cache breakpoints | Reuse within a session | First request of a new session rewrites |
|---|---|---|---|
| This provider | 4 | Each turn reuses the previous turn | 0.8% |
| Pi's built-in `anthropic` OAuth | 4 | Each turn reuses the previous turn | 0.7% |
| `pi-anthropic-auth` 3.4.3 | 4 | Each turn reuses the previous turn | 65.8% |

Pi's `cacheWarming` setting favors the other two routes. It defaults to `streaming` and refreshes the cache during long tool runs on models that declare a cache lifetime. Pi's built-in Claude models declare one and this provider's models do not, so a tool run longer than 5 minutes loses the cache here unless you use the 1-hour cache. This comes from reading Pi 1.4.0's code, and we did not observe it running. The [Long sessions section of the README](../README.md#long-sessions) states the limits on warming.

`pi-anthropic-auth` puts a per-conversation billing block before the system prompt, so a new session with a different first message cannot reuse that prefix. At the same API prices, the two sessions together cost about 7.8% more in input-side cost than this provider, nearly all of it from that rewrite in the second session. The gap would be larger for many very short sessions and smaller for long ones.

Caching does not appear to explain the 3x to 4x usage gap reported in [`pi-anthropic-auth` issue #83](https://github.com/gotgenes/pi-anthropic-auth/issues/83). The reporter changed only a request label, kept the same caching, and saw usage fall from 11% to 4%. That is one unconfirmed report.
