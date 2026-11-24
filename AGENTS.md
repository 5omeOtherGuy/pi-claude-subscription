<profile>

- Purpose: Pi package whose extension registers a native `claude-subscription` provider, authenticated with Claude Code OAuth.
- Stage: released (repository standard)
- Gate: `npm run check` (CI job `gate`, also the pre-push hook). Focused test: `node --test --import tsx tests/<name>.test.ts`; focused gates by change type are in `docs/verification-gates.md`.
- Landing: PR, squash-merged on a green gate, never `--admin`; agents land: yes.
- Release: release-please PR; agents release: no.
- Outside issues and PRs: agents triage; outside PRs merge: owner approves.
- Sensitive paths: `src/credentials.ts`, `src/credential-accounts.ts`, `src/native-headers.ts`, `src/model-catalog.ts`, `src/redaction.ts`, `src/anthropic-sse.ts`, `src/native-request.ts`, `src/native-stream-simple.ts`, `src/native-stream-transport.ts`, `src/models.ts`, `extensions/pi-claude-subscription/`, `package.json`, `package-lock.json`, `.nvmrc`, `scripts/secret-scan.mjs`, `.github/workflows/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `release-please-config.json`, `.release-please-manifest.json`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/verification-gates.md`.

</profile>

<rules>

- Make no live Anthropic or API call in tests, the gate or the docs. Run the opt-in `PI_LIVE_CLAUDE_*_TEST=1` tests only when the owner asks: they spend the owner's subscription quota.
- Use fake credentials and tokens in tests. Never commit `Authorization` or `Bearer` log lines or `.credentials.json` contents.
- Install the pre-push hook with `sh scripts/install-hooks.sh`, never `git config core.hooksPath .githooks`: the script copies the hook from `origin/main`, so a branch cannot run its own hook.
- Author commits with `268151429+5omeOtherGuy@users.noreply.github.com` and merge with `--author-email` set to it: the repository is public.
- Never tag or publish by hand.
- In the first release-please PR, move the hand-kept `[Unreleased]` entries of `CHANGELOG.md` into its section and release notes, and drop its `v0.1.0...` compare link: no `v0.1.0` tag exists.

</rules>
