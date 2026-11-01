<!--
Fill this in and delete sections that don't apply.
Title: Conventional Commits, in words users understand. Use a prefix such as
`fix:`, `feat:`, or `docs:`, for example `fix: show the right model name`.
The squash merge uses this title, and release-please builds CHANGELOG.md from it.
-->

## Intent

<!-- Why make this change? Add `Fixes #n` when it resolves an issue. -->

## Changed behavior

<!-- What behaves differently afterwards for users, callers, or contributors? Write "None" only when behavior, rules, and executable instructions stay unchanged. -->

## Constraints touched

<!--
Which repository rules does this change touch (AGENTS.md, CONTRIBUTING.md,
docs/architecture.md, docs/verification-gates.md)? For example: OAuth-only
headers, no live Anthropic calls, the Pi peer range, the request shape.
-->

## Evidence

<!--
List the new or updated deterministic tests under tests/. A bug fix needs a test
that fails before the fix. Name the focused gate from docs/verification-gates.md
that you ran, and include the `npm run check` output.
For a docs-only change, list the link and wording checks you did.
-->

## Sensitive path

- [ ] This PR changes none of these: a sensitive path listed in the `AGENTS.md` profile, a public interface, security-sensitive code, auth or credential handling, install or setup, deployment, CI or release configuration, agent policy (`AGENTS.md`, `.agents/`, `.githooks/`), or docs that alter rules or executable instructions.
- [ ] It does, and this PR records an independent review of the head commit, by another agent or the owner, with a new review after any later push.

## Checklist

- [ ] `npm run check` (the gate) passes locally
- [ ] The diff and the test fixtures contain no credentials, OAuth tokens,
      API keys, or `.credentials.json` contents
- [ ] `README.md`, `docs/`, or both reflect public-facing changes
