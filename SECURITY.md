# Security Policy

## Supported versions

The latest minor release receives security fixes. Releases are tagged `vX.Y.Z`; before the first tag, only the latest commit on `main` is supported.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.** This package handles Claude Code OAuth credentials; a bug that leaks tokens, disables redaction, or removes the OAuth-only request guard should be reported privately.

Report through GitHub private vulnerability reporting: <https://github.com/5omeOtherGuy/pi-claude-subscription/security/advisories/new>. If that is unavailable, contact the maintainer through the email on the maintainer's GitHub profile.

Include: description and impact, steps to reproduce or a minimal proof of concept, the commit SHA tested, and whether the issue is already disclosed elsewhere. You will get an acknowledgement within 7 days. Fixes go through a private security advisory: fix, release, publish the advisory, and credit the reporter unless they prefer otherwise.

## Scope

In scope: repository code (`extensions/`, `src/`, `tests/`, workflows), and any path in this code that could log, send unexpectedly, or write OAuth tokens, API keys or request payloads to disk.

Out of scope: upstream dependencies (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, Anthropic services, Node.js), and issues that need an attacker who already runs code as the user running Pi. Pi itself owns credential storage, OAuth login and refresh; known Pi gaps are listed in [`docs/upstream-gaps.md`](docs/upstream-gaps.md).

## Threat model

Deterministic tests cover every boundary below. None of them needs live calls or real credentials.

1. **Credential exfiltration through a destination.** A custom `baseUrl`, credentials in the URL, plain HTTP, or a redirect could send the subscription token elsewhere. Defense: OAuth requests are refused unless they go to `https://api.anthropic.com/v1/messages`, and redirects are not followed (`redirect: "manual"`). The refusal is a local response, so nothing is sent.
2. **Mixed credentials.** Header overrides could add `x-api-key` or a second `Authorization` to an OAuth request. Defense: the wire headers must contain exactly `Authorization: Bearer <the request's OAuth token>` and no `x-api-key`.
3. **Billing-route confusion.** A failed OAuth refresh must not silently become an API-key request. Defense: Pi 1.3.0 owns this (a stored OAuth credential owns the provider, with no environment fallback). The tests check this host contract, and it must be re-checked on each Pi upgrade. The extension does not decide whether Anthropic bills a request as included or extra usage.
4. **Secret leakage in errors and diagnostics.** Upstream error bodies, network-error causes and status output could contain tokens. Defense: token- and header-shaped values and the request's own token are redacted from non-2xx bodies before Pi reads them, and from recorded causes. The status command shows metadata only: no prompt, tool, payload or credential content.
5. **Shadowed protection.** Another extension's `anthropic` transport registered later bypasses this one. Defense: a startup warning and `NOT COVERED` in the status command. The extension never unregisters other providers.
6. **Destructive automation.** Defense: tests never run live tools, change real credentials, or commit or push. The suite uses fake credentials and stubbed network calls, and checks that 0.x credential files are never read or written.

## Handling secrets

Never include real OAuth tokens, API keys, `.credentials.json` contents, or log fragments with `Authorization`, `Bearer`, `sk-…` or `anthropic-…` headers in reports, issues, pull requests or commits. Redact sample data first.

Security-sensitive invariants:

- Tests use fake credentials and stubbed network calls.
- Runtime code never reads Claude Code credential files or the Keychain, never writes credentials, and never patches global `fetch` or the api registry.
- Errors and diagnostics redact known secrets and header/token patterns before they are shown.
