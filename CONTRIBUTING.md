# Contributing

Small fixes (typos, docs, focused bug fixes) are welcome directly as pull requests. For larger changes, open an issue first so we can agree on the approach. Every pull request must pass the gate (`npm run check`, CI job `gate`). Contributions are licensed under the repository's [MIT License](LICENSE); there is no CLA. Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

Issues and pull requests are triaged and reviewed within 7 days. An agent may triage, label and reply on the maintainer's behalf; such replies say so. Decisions to decline, roadmap promises and licence questions stay with the maintainer. Unanswered `needs-info` issues close after 30 days (a reply reopens them); a pull request whose review goes unanswered for 30 days gets a reminder, and closes with thanks 30 days later.

## Ground rules

- Never commit credentials, OAuth tokens, API keys, log fragments containing `Authorization` / `Bearer` headers, or anything from `.credentials.json`.
- Tests must stay deterministic: fake credentials, fake tokens, mocked network boundaries.
- Do not add live Anthropic/API calls to the repository test suite or documentation.
- Keep changes focused: one pull request, one concern.

## Development setup

Requirements: Node.js 22.19 or newer (`.nvmrc` pins the CI default and matches Pi's `engines.node` floor) and npm.

```bash
git clone https://github.com/5omeOtherGuy/pi-claude-subscription.git
cd pi-claude-subscription
npm ci
```

Useful checks:

```bash
npm test
npm run typecheck
npm run check
```

`npm run check` is the gate: secret scan of tracked files, deterministic tests (including the `npm pack --dry-run` contents check), and TypeScript type-checking. CI runs exactly this command in the job `gate`. Focused gates by change type and the supply-chain/runtime drift policy are in [`docs/verification-gates.md`](docs/verification-gates.md).

## Workflow

1. Create a topic branch off `main`.
2. Make the change and update deterministic tests when behavior changes.
3. Run `npm run check`.
4. Open a pull request against `main` and address CI failures. Write the PR title in Conventional Commits form (`fix: …`, `feat: …`, `docs: …`), in words users understand: PRs are squash-merged with that title, and release-please builds `CHANGELOG.md` and the next version from it.

## What to test

- Changes to the transport wrapper, the OAuth boundary, redaction, registration or the status command need deterministic coverage. Compare against unwrapped Pi where you can (`tests/transport.test.ts`), and check real loader behavior in `tests/pi-session.test.ts`.
- A new request or response transform needs a reproduced compatibility problem in supported Pi, a narrow scope, and tests that show it is idempotent and preserves the rest of the request. Problems in Pi itself go to [`docs/upstream-gaps.md`](docs/upstream-gaps.md).
- Bug fixes should include a regression test that fails before the fix.
- Documentation-only changes can use the lightest useful verification (link/path and wording scans).
- Dependency or Pi version changes should run the focused drift gate and then `npm run check`.

## Security issues

Do not include secrets in public issues or pull requests. See [`SECURITY.md`](SECURITY.md).
