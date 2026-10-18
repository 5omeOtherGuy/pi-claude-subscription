# AGENTS.md

## Profile

- Purpose: Pi package whose extension registers a native `claude-subscription` provider, authenticated with Claude Code OAuth.
- Stage: released (repository standard 2026-10-18)
- Gate: `npm run check` (CI job `gate`)
- Landing: PR, squash-merged on a green gate; agents land: yes
- Release: release-please PR; agents release: no
- Outside issues and PRs: agents triage; outside PRs merge: owner approves
- Sensitive paths: `src/credentials.ts`, `src/credential-accounts.ts`, `src/native-headers.ts`, `src/model-catalog.ts` (OAuth credentials and authenticated requests); `src/redaction.ts`, `src/anthropic-sse.ts` (secret redaction); `src/native-request.ts`, `src/native-stream-simple.ts`, `src/native-stream-transport.ts` (Messages URL, provider guard, outbound URL guard); `extensions/minimalcc-pi/`, `src/models.ts`, `package.json` (public interface and install manifest); `package-lock.json`, `.nvmrc` (CI install inputs); `scripts/secret-scan.mjs`; `.github/workflows/`, `.github/dependabot.yml`, `.github/CODEOWNERS`; `release-please-config.json`, `.release-please-manifest.json`; `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/verification-gates.md`, `.github/pull_request_template.md` (policy)

Deliberate deviations from the repository standard, kept on purpose:

- Per-task worktrees with a control-only primary checkout, even for a single session (Workflow step 1), so parallel agents never share a working tree.
- No live Anthropic calls anywhere in the test suite, the gate or the docs; the opt-in `PI_LIVE_CLAUDE_*_TEST=1` tests spend the owner's subscription quota and run only when he asks.
- Focused drift gates per change type in `docs/verification-gates.md`, run before the gate.
- Every bug fix carries a regression test that fails before the fix.

Keep changes focused and deterministic; never use or commit real credentials, OAuth tokens, API keys, `Authorization` / `Bearer` logs, or `.credentials.json` contents.

## Read when relevant

- `REPO_MAP.md` / `INDEX.md` — codebase map.
- `CONTRIBUTING.md` — contribution and testing rules.
- `docs/architecture.md` — request shape, models, credentials, stream and replay rules.
- Open GitHub issues — work state and planned work; issues labelled `enhancement` are hardening work (for example the SSE self-heal set #66–#70). Comment on or close an issue when its work is completed, deferred, or replaced.

## Commands

- Install: `npm ci`
- Test: `npm test`
- Focused test: `node --test --import tsx tests/<name>.test.ts`
- Typecheck: `npm run typecheck`
- Gate: `npm run check` (secret scan, tests incl. pack check, typecheck); CI job `gate` runs exactly this.

## Workflow

1. Per-task worktree (parallel-agent safe):
   - Primary checkout is control-only: never edit files or switch branches there.
   - Preflight: `git status --short --branch && git worktree list && git fetch origin --prune`.
   - Create: `git worktree add ../minimalcc-pi-<slug> -b <type>/<slug> origin/main`, one concern per branch and PR.
   - A change to a sensitive path (profile above), a public interface, security-sensitive code, auth or credential handling, install or setup, deployment, CI or release configuration, or agent policy (`AGENTS.md`, `.agents/`, `.githooks/`) gets an independent review (another agent or the owner) before merge, listed or not; a docs change that alters rules or executable instructions counts too. The review is recorded on the PR against the reviewed head; a later push needs a new review.
   - Merge once the gate is green on the head commit: `gh pr merge <N> --squash --match-head-commit <sha>` (the repo auto-deletes merged head branches). Never use `--admin`; only the owner bypasses checks. When merging as `5omeOtherGuy`, add `--author-email 268151429+5omeOtherGuy@users.noreply.github.com`, and author commits with that address: this repository is public.
   - Cleanup, from outside the worktree: `git worktree remove ../minimalcc-pi-<slug> && git branch -D <branch> && git fetch origin --prune && git worktree prune`.
2. For behavior changes, add/update deterministic tests first; no live Anthropic/API calls.
3. Run `npm run check` before PRs.
4. Write the PR title in user-facing Conventional Commits form; release-please builds `CHANGELOG.md` from it.
5. Releases go through the release-please PR; merging it bumps `package.json`, tags `vX.Y.Z` and creates the GitHub Release. Never tag or publish by hand. The first release PR takes over the hand-kept `[Unreleased]` entries (move them into its section and its release notes) and drops its `v0.1.0...` compare link, since no `v0.1.0` tag exists.
