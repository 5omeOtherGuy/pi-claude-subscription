# AGENTS.md

## Profile

- Purpose: Pi package whose extension registers a native `claude-subscription` provider, authenticated with Claude Code OAuth.
- Stage: released (repository standard 2026-10-18)
- Gate: `npm run check` (CI job `gate`)
- Landing: PR, squash-merged on a green gate. Agents land: yes
- Release: release-please PR. Agents release: no
- Outside issues and PRs: agents triage. Outside PRs merge: owner approves
- Sensitive paths:
  - OAuth credentials and authenticated requests: `src/credentials.ts`, `src/credential-accounts.ts`, `src/native-headers.ts`, `src/model-catalog.ts`
  - Secret redaction: `src/redaction.ts`, `src/anthropic-sse.ts`
  - Messages URL, provider guard, outbound URL guard: `src/native-request.ts`, `src/native-stream-simple.ts`, `src/native-stream-transport.ts`
  - Public interface and install manifest: `extensions/pi-claude-subscription/`, `src/models.ts`, `package.json`
  - CI install inputs: `package-lock.json`, `.nvmrc`
  - `scripts/secret-scan.mjs`
  - `.github/workflows/`, `.github/dependabot.yml`, `.github/CODEOWNERS`
  - `release-please-config.json`, `.release-please-manifest.json`
  - Policy: `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/verification-gates.md`, `.github/pull_request_template.md`

Deliberate deviations from the repository standard, kept on purpose:

- Per-task worktrees with a control-only primary checkout, even for a single session (Workflow step 1), so parallel agents never share a working tree.
- No live Anthropic calls anywhere in the test suite, the gate, or the docs. The opt-in `PI_LIVE_CLAUDE_*_TEST=1` tests spend the owner's subscription quota and run only when the owner asks.
- Focused drift gates per change type in `docs/verification-gates.md`, run before the gate.
- Every bug fix carries a regression test that fails before the fix.

Keep changes focused and deterministic. Never use or commit real credentials, OAuth tokens, API keys, `Authorization` or `Bearer` logs, or `.credentials.json` contents.

## Read when relevant

- `REPO_MAP.md`: codebase map.
- `CONTRIBUTING.md`: contribution and testing rules.
- `docs/architecture.md`: request shape, models, credentials, stream and replay rules.
- Open GitHub issues: work state and planned work. Issues labelled `enhancement` are hardening work, for example the SSE self-heal set #66 to #70. Comment on or close an issue when its work is completed, deferred, or replaced.

## Commands

- Install: `npm ci`
- Test: `npm test`
- Focused test: `node --test --import tsx tests/<name>.test.ts`
- Typecheck: `npm run typecheck`
- Gate: `npm run check` (secret scan, tests including the pack check, typecheck). CI job `gate` runs exactly this command.

## Workflow

1. Per-task worktree (parallel-agent safe):
   - The primary checkout is control-only. Never edit files or switch branches there.
   - Preflight: `git status --short --branch && git worktree list && git fetch origin --prune`.
   - Create: `git worktree add ../pi-claude-subscription-<slug> -b <type>/<slug> origin/main`. Keep one concern per branch and PR.
   - A change to any of the following gets an independent review (another agent or the owner) before merge, listed or not: a sensitive path (profile above), a public interface, security-sensitive code, auth or credential handling, install or setup, deployment, CI or release configuration, or agent policy (`AGENTS.md`, `.agents/`, `.githooks/`). A docs change that alters rules or executable instructions counts too. The review is recorded on the PR against the reviewed head. A later push needs a new review.
   - Merge once the gate is green on the head commit: `gh pr merge <N> --squash --match-head-commit <sha>`. The repo auto-deletes merged head branches. Never use `--admin`. Only the owner bypasses checks. When merging as `5omeOtherGuy`, add `--author-email 268151429+5omeOtherGuy@users.noreply.github.com` and author commits with that address, because this repository is public.
   - Cleanup, from outside the worktree: `git worktree remove ../pi-claude-subscription-<slug> && git branch -D <branch> && git fetch origin --prune && git worktree prune`.
2. For behavior changes, add or update deterministic tests first. Make no live Anthropic or API calls.
3. Run `npm run check` before PRs.
4. Write the PR title in user-facing Conventional Commits form. release-please builds `CHANGELOG.md` from the title.
5. Releases go through the release-please PR. Merging that PR bumps `package.json`, tags `vX.Y.Z`, and creates the GitHub Release. Never tag or publish by hand. The first release PR takes over the hand-kept `[Unreleased]` entries: move them into its section and its release notes. That PR also drops its `v0.1.0...` compare link, because no `v0.1.0` tag exists.
