# Why this package exists

The package started as a separate `claude-subscription` provider. It had its own credential loading, model list, request builder, SSE parser and cache logic, so a Claude subscription could be used from Pi's leaner agent loop: same account, same model ids, a different harness.

Pi now ships all of that natively: `/login anthropic` for Claude Pro/Max, token refresh with locking, the Anthropic model list, Claude Code identity headers and system block, thinking, cache anchors and retries. A second copy of the same work drifted from Pi and had its own bugs. During review, the old converter replaced supplementary-plane characters with U+FFFD, dropped a completed tool exchange that followed a system patch, and mixed credentials between accounts. Pi's own path does none of these (see the reproducers in `tests/transport.test.ts`).

So the package now does only what Pi lacks:

- It keeps OAuth requests on the official endpoint with a single credential, and does not follow redirects.
- It redacts echoed secrets from error bodies.
- It offers a local status command that does not log anything.

It does not try to look more like Claude Code than Pi already does. Every extra transform needs a reproduced compatibility problem, a narrow scope, and tests that show it is idempotent and preserves the rest of the request. The billing outcome (included usage or extra usage) is decided by Anthropic for the account. The package makes no claim about it.

## Principles

- Pi owns the plumbing; the extension owns a small, tested boundary.
- Measured, redacted evidence over anecdotes; no telemetry and no raw-payload logging.
- Problems in Pi are reported and fixed upstream, not hidden behind a copied transport ([`upstream-gaps.md`](upstream-gaps.md)).
- Individual use of your own subscription; not for resale, pooled access, or replacing API usage that belongs on the API.
