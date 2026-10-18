# pi-claude-subscription index

A Pi package with one extension. The extension wraps the transport of Pi's built-in `anthropic` provider: OAuth requests get a strict endpoint and auth boundary, and a local status command shows their metadata. Login, refresh, models, the request body and streaming stay Pi's.

## Start here

- [`README.md`](README.md): install, login, billing, coverage, migration from 0.x.
- [`docs/architecture.md`](docs/architecture.md): request path, differences kept from native Pi, coverage, test map, pending live check.
- [`REPO_MAP.md`](REPO_MAP.md): source map and invariants.
- [`docs/INDEX.md`](docs/INDEX.md): documentation index.

## Directories

- `.github/`: CI workflows, Dependabot config, community templates.
- `docs/`: public documentation.
- `extensions/`: the Pi extension entry. See [`extensions/INDEX.md`](extensions/INDEX.md).
- `src/`: transport wrapper and diagnostics. See [`src/INDEX.md`](src/INDEX.md).
- `tests/`: deterministic Node tests. See [`tests/INDEX.md`](tests/INDEX.md).
- `scripts/`: the secret scan.

## Common commands

```bash
npm ci
npm test
npm run typecheck
npm run check
```

## Local/generated state

Ignored local state includes `.runtime/`, `.local/`, `docs/internal/`, `scripts/local/`, `node_modules/`, `*.log`, `*.pid`, `.env*`, `.credentials.json` and `.claude/`. Never commit credentials or OAuth tokens.
