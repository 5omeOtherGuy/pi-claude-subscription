# AGENTS.md

This repo is a Pi package shipping a single extension that registers a native Claude subscription provider, authenticated with Claude Code OAuth. Keep changes focused and deterministic; never use or commit real credentials, OAuth tokens, API keys, `Authorization` / `Bearer` logs, or `.credentials.json` contents.

## Read when relevant

- `REPO_MAP.md` / `INDEX.md` — codebase map.
- `CONTRIBUTING.md` — contribution and testing rules.
- `docs/current-status.md` — implementation notes and known follow-ups.
- Open GitHub issues — work state and planned work; issues labelled `enhancement` are hardening work (for example the SSE self-heal set #66–#70). Comment on or close an issue when its work is completed, deferred, or replaced.

## Commands

- Install: `npm ci`
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Gate: `npm run check` (secret scan, tests incl. pack check, typecheck); CI job `gate` runs exactly this.

## Workflow

1. Per-task worktree (parallel-agent safe):
   - Primary checkout is control-only: never edit files or switch branches there.
   - Preflight: `git status --short --branch && git worktree list && git fetch origin --prune`.
   - Create: `git worktree add ../minimalcc-pi-<slug> -b <branch> origin/main`.
   - Merge: `gh pr merge <N> --squash [--admin]` (no `--delete-branch`; the repo auto-deletes merged head branches).
   - Cleanup, from outside the worktree: `git worktree remove ../minimalcc-pi-<slug> && git branch -D <branch> && git fetch origin --prune && git worktree prune`.
2. For behavior changes, add/update deterministic tests first; no live Anthropic/API calls.
3. Run `npm run check` before PRs.
4. Write the PR title in user-facing Conventional Commits form; release-please builds `CHANGELOG.md` from it.
5. Releases go through the release-please PR; merging it bumps `package.json`, tags `vX.Y.Z` and creates the GitHub Release. Never tag or publish by hand. The first release PR takes over the hand-kept `[Unreleased]` entries (move them into its section and its release notes) and drops its `v0.1.0...` compare link, since no `v0.1.0` tag exists.
