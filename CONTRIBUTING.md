# Contributing

Small fixes (typos, docs, and focused bug fixes) are welcome directly as pull requests. For larger changes, open an issue first so we can agree on the approach.

Every pull request must pass the gate (`npm run check`, CI job `gate`). Contributions are licensed under the repository's [MIT License](LICENSE). There is no CLA. Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

Issues and pull requests are triaged and reviewed within 7 days. An agent may triage, label, and reply on the maintainer's behalf. Those replies state that an agent sent them. Decisions to decline, roadmap promises, and license questions stay with the maintainer.

Unanswered `needs-info` issues close after 30 days, and a reply reopens them. A pull request whose review goes unanswered for 30 days gets a reminder. It closes with thanks 30 days later.

## Ground rules

- Never commit credentials, OAuth tokens, API keys, log fragments that contain `Authorization` or `Bearer` headers, or anything from `.credentials.json`.
- Tests must stay deterministic. Use fake credentials, fake tokens, and mocked network boundaries.
- The default tests make no live Anthropic or API calls. Do not add any to them, to the gate, or to the documentation. Live tests stay opt-in. Each `tests/live-*.test.ts` test is skipped unless its `PI_LIVE_CLAUDE_*_TEST=1` variable is set. Live tests spend the owner's subscription quota and run only when the owner asks.
- Keep changes focused: one pull request, one concern.

## Set up your development environment

You need npm and Node.js 22.19 or newer. `.nvmrc` pins the CI default, and that version matches Pi's `engines.node` floor.

1. Clone the repository and enter it.

   ```bash
   git clone https://github.com/5omeOtherGuy/pi-claude-subscription.git
   cd pi-claude-subscription
   ```

2. Install the dependencies.

   ```bash
   npm ci
   ```

3. Run the checks you need.

   ```bash
   npm test
   npm run typecheck
   npm run check
   ```

`npm run check` is the gate. It runs a secret scan of tracked files, the deterministic tests, and TypeScript type-checking. The tests include the `npm pack --dry-run` contents check. CI runs exactly this command in the job `gate`.

[`docs/verification-gates.md`](docs/verification-gates.md) lists the focused gates by change type and the supply-chain and runtime drift policies.

## Submit a change

1. Create a topic branch off `main`.

   ```bash
   git switch -c <topic> main
   ```

2. Make the change. Update the deterministic tests when behavior changes.

3. Run the gate.

   ```bash
   npm run check
   ```

4. Open a pull request against `main`, for example with `gh pr create --base main`. Address any CI failures.

   Write the pull request title in Conventional Commits form (`fix: …`, `feat: …`, `docs: …`), in words users understand. Pull requests are squash-merged with that title. release-please builds `CHANGELOG.md` and the next version from it.

## What to test

- Changes to request construction, header shape, system-block shaping, credential loading, provider registration, and SSE parsing need deterministic coverage.
- Bug fixes should include a regression test that fails before the fix.
- Documentation-only changes can use the lightest useful verification (link, path, and wording scans).
- Dependency or model metadata changes should run the focused drift gate and then `npm run check`.

## Security issues

Do not include secrets in public issues or pull requests. See [`SECURITY.md`](SECURITY.md).
