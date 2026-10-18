<!--
Thanks for the PR! Please fill this in. Delete sections that don't apply.
Title: Conventional Commits, in words users understand (`fix: …`, `feat: …`,
`docs: …`); PRs are squash-merged with it and release-please builds
CHANGELOG.md from it.
-->

## Intent

<!-- Why this change? Add `Fixes #n` when it resolves an issue. -->

## Changed behavior

<!-- What behaves differently for users or callers afterwards? "None" for a pure refactor or docs. -->

## Constraints touched

<!--
Which repository rules does this touch (AGENTS.md, CONTRIBUTING.md,
docs/architecture.md, docs/verification-gates.md)? For example: OAuth-only
headers, no live Anthropic calls, the Pi peer range, the request shape.
-->

## Evidence

<!--
New or updated deterministic tests under tests/ (a bug fix needs one that fails
before the fix), the focused gate from docs/verification-gates.md you ran, and
`npm run check` output. Docs-only: the link and wording checks you did.
-->

## Sensitive path

- [ ] This PR changes none of the sensitive paths listed in the `AGENTS.md` profile, a public interface, auth or credential handling, CI or release configuration, or agent policy.
- [ ] It does, and an independent review (another agent or the owner) of the reviewed head commit is recorded on this PR; a later push needs a new review.

## Checklist

- [ ] `npm run check` (the gate) passes locally
- [ ] No credentials, OAuth tokens, API keys, or `.credentials.json`
      contents are included in the diff or in the test fixtures
- [ ] Public-facing changes are reflected in `README.md` and/or `docs/`
