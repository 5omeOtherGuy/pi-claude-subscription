# AGENTS.md

## Profile

- Purpose: Pi package whose extension registers a native `claude-subscription` provider, authenticated with Claude Code OAuth.
- Stage: released (repository standard)
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
- `scripts/install-hooks.sh` copies the pre-push hook from `origin/main` into Git's hooks directory instead of setting `core.hooksPath .githooks`, so a checked-out branch cannot run its own hooks.

Keep changes focused and deterministic. Never use or commit real credentials, OAuth tokens, API keys, `Authorization` or `Bearer` logs, or `.credentials.json` contents.

## Read when relevant

- `REPO_MAP.md`: codebase map.
- `CONTRIBUTING.md`: contribution and testing rules.
- `docs/architecture.md`: request shape, models, credentials, stream and replay rules.
- Open GitHub issues: work state and planned work. Issues labelled `enhancement` are hardening work, for example the SSE self-heal set #66 to #70. Comment on or close an issue when its work is completed, deferred, or replaced.

## Commands

- Install: `npm ci`. Run Node through mise (`mise exec -- node`, `npm`, `npx`) so `.nvmrc` applies.
- Test: `npm test`
- Focused test: `node --test --import tsx tests/<name>.test.ts`
- Typecheck: `npm run typecheck`
- Gate: `npm run check` (secret scan, tests including the pack check, typecheck). CI job `gate` runs exactly this command.

## Workflow

1. Work in a per-task worktree, `git worktree add ~/Work/.worktrees/pi-claude-subscription/<slug> -b <type>/<slug> origin/main` after `git fetch origin --prune`; the primary checkout is control-only (no edits, no branch switches). One concern per branch and PR. Remove the worktree and branch after the merge.
   - A change to a sensitive path (profile above), a public interface, security-sensitive code, auth or credential handling, install or setup, deployment, CI or release configuration, agent policy, or a docs change that alters rules or executable instructions gets an independent review (another agent or the owner) before merge, recorded on the PR against the reviewed head; a later push needs a new review.
   - Squash-merge; never `--admin`. This repository is public: author commits with `268151429+5omeOtherGuy@users.noreply.github.com` and merge with `--author-email` set to it.
2. For behavior changes, add or update deterministic tests first. Make no live Anthropic or API calls.
3. Run `npm run check` before PRs.
4. Write the PR title in user-facing Conventional Commits form. release-please builds `CHANGELOG.md` from the title.
5. Releases go through the release-please PR. Merging that PR bumps `package.json`, tags `vX.Y.Z`, and creates the GitHub Release. Never tag or publish by hand. The first release PR takes over the hand-kept `[Unreleased]` entries: move them into its section and its release notes. That PR also drops its `v0.1.0...` compare link, because no `v0.1.0` tag exists.
