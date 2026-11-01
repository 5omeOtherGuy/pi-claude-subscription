# Security policy

## Supported versions

The latest minor release receives security fixes. Releases are tagged `vX.Y.Z`. Before the first tag, only the latest commit on `main` is supported.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.** This package handles Claude Code OAuth credentials. Report privately any bug that leaks tokens, disables redaction, or removes the OAuth-only request guard.

Report through GitHub private vulnerability reporting: <https://github.com/5omeOtherGuy/pi-claude-subscription/security/advisories/new>. If that is unavailable, contact the maintainer through the email on the maintainer's GitHub profile.

Include these details in your report:

- A description of the issue and its impact.
- Steps to reproduce, or a minimal proof of concept.
- The commit SHA you tested.
- Whether the issue is already disclosed elsewhere.

You will get an acknowledgement within 7 days. Fixes go through a private security advisory. The steps are to fix, release, publish the advisory, and credit the reporter unless they prefer otherwise.

## Scope

These items are in scope:

- Repository code (`extensions/`, `src/`, `tests/`, and workflows).
- Credential loading, request construction, and SSE handling.
- Any path that could log, unexpectedly transmit, or write to disk OAuth tokens, API keys, or request payloads.

These items are out of scope:

- Upstream dependencies (`@earendil-works/pi-coding-agent`, Anthropic services, Claude Code, and Node.js).
- Issues that require an attacker who already has local code execution as the user running Pi.

## Threat model

This section lists the abuse cases the provider resists, its defense against each one, and the limits of that defense. Deterministic regression tests cover the boundaries that can be simulated without live calls or real credentials.

1. **Credential exfiltration.** Prompt injection or a tool may try to make the model reveal `.credentials.json`, environment variables, or request headers. The provider loads credentials at request time and at model list refresh, and it caches the access token in memory. It never places credentials in prompts, tool outputs, or diagnostics. The stream runs its surfaced errors through redaction, and credential load errors never include token or file contents. `/claude-subscription-status` and `/claude-subscription-accounts` report metadata only, such as the credential source, the account name, and token freshness. `/claude-subscription-import` deliberately copies the credential blob to a local file that the user can delete. The provider does not restrict Pi's tools. A tool that can read the file or the environment can still return that content to the model.
2. **Billing-route confusion.** Selecting Pi's built-in `anthropic` provider, or a provider named `custom-anthropic` or `meridian`, could bill an API key or metered extra usage. The `input` guard refuses new prompts on those three providers. The native stream refuses to run for any provider other than `claude-subscription`, and it refuses before it loads credentials. That second check catches misrouted calls to this provider, and it does not apply to requests that use Pi's own stream. The `input` guard covers only those three names, so it does not stop other providers. The `before_provider_request` handler only reports an error, because Pi catches its throw and still sends the request. The `input` guard does not see Pi's `/compact`, `/tree`, or `/bug` summaries. It also does not see extension turns started through `sendCustomMessage`, or the next request after a `/model` switch during a run. Those requests can still bill a blocked provider.
3. **Outbound URL/token exfiltration.** A misconfigured base URL could receive the OAuth token. The Anthropic Messages URL is hardcoded, and the stream transport refuses any other URL before `fetch`. The model list request and the OAuth refresh request also use hardcoded URLs, but they do not have that second check. The provider has no user-configurable request URL, and `src/` never reads a model's `baseUrl`.
4. **Tool-output secret leakage.** Tool results and errors can contain paths, command output, or secrets. Stream and transport diagnostics never include raw tool arguments or results. They report only tool names, byte counts, and delta counts for tool input. Redaction replaces the current access tokens, `Authorization` and `Bearer` values, and `x-api-key` and `anthropic-api-key` header values. Slash-command summaries stay metadata-only. Redaction covers only stream and transport error text. The provider sends tool results to Anthropic without redaction, so a secret in a tool result reaches the model. Redaction matches only those exact tokens and header shapes, so other token material in Anthropic error text stays visible.
5. **Malformed or malicious SSE.** A duplicate `message_start` or `content_block_start`, a `tool_use` block without an id or a name, non-object tool input, or an unsupported stop reason could corrupt state. The SSE parser and the stream applier reject these cases with redacted errors. If a stream fails before `message_stop`, the provider drops the tool-call blocks from the errored message. That rule has limits. An aborted stream keeps its partial output, including tool calls. An unsupported stop reason fails after `message_stop`, so that message keeps its tool calls. Neither the parser nor the applier rejects a repeated `message_stop`, or a new `message_start` after `message_stop`. The final parse of tool input repairs invalid JSON when it can. It fails only when non-empty input cannot become an object.
6. **User-denied or policy-denied tool calls.** Recoverable tool errors must reach the model as tool results, not become provider crashes. The provider sends Pi's tool errors to Anthropic as `tool_result` blocks with `is_error` set. Pi core owns validation and permissions. After the final JSON parse, arguments pass through unchanged for every tool except `edit`. For `edit`, the provider parses an `edits` array that arrives as a JSON string. It also removes extra keys from items whose `oldText` and `newText` are both strings. Those two changes let a recoverable call pass Pi's schema. Pi still validates the result, and a malformed item reaches Pi's validator unchanged.
7. **Destructive automation.** Tests or diagnostics could run real tools, delete user files, alter real credentials, or commit and push code. `/claude-subscription-status` only reads credentials. The deterministic suite uses fake credentials and mocked network boundaries. It deletes only its own temporary directories, and it never commits or pushes. The opt-in `PI_LIVE_CLAUDE_*_TEST=1` tests are outside that suite. They use the real OAuth credential, make live Anthropic requests, and spend subscription quota. One of them drives the real `pi` CLI with the `read`, `grep`, `find`, and `ls` tools. A live request can refresh an expired token, which rewrites the credential file.

## Handling secrets

Never include real OAuth tokens, API keys, `.credentials.json` contents, or log fragments containing `Authorization`, `Bearer`, `sk-…`, or `anthropic-…` headers in reports, issues, pull requests, or commits. If a report needs sample data, redact it first.

These security-sensitive invariants always apply:

- Tests must use fake credentials, fake tokens, and mocked network boundaries.
- The provider must not fall back to `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `x-api-key`, or `anthropic-api-key`.
- Errors must redact known secrets and header and token patterns before surfacing.
