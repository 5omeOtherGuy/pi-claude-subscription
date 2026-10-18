# Verification gates and drift checks

No live Anthropic calls: the deterministic suite makes no live Anthropic, OAuth, bootstrap or model-discovery requests. Use fake credentials and stubbed network boundaries. Live acceptance is a separate, explicitly authorized step and is never committed as logs.

## Change-type gates

| Change type | Focused checks | Broader gate |
|---|---|---|
| Transport delegation / stream contract | `node --test --import tsx tests/transport.test.ts` | `npm run check` |
| OAuth boundary / redaction | `node --test --import tsx tests/transport.test.ts tests/pi-session.test.ts` | `npm run check` |
| Extension registration / loader / status command | `node --test --import tsx tests/pi-session.test.ts tests/package-manifest.test.ts` | `npm run check` |
| Dependency / Pi version | `node --test --import tsx tests/dependency-drift.test.ts tests/pi-session.test.ts` plus `npm run typecheck` | `npm run check` |
| Docs only | Link/path and wording checks for the touched docs | `npm run typecheck` optional if code is untouched |

`npm run check` (CI job `gate`: secret scan, tests, typecheck) is the gate before a pull request.

## Host compatibility

- Supported Pi range: `>=1.3.0 <2` (`peerDependencies`). Only 1.3.0 is verified.
- `tests/pi-session.test.ts` loads the extension through Pi's real resource loader from the installed devDependency, with the network stubbed. Re-run it against any Pi version before widening the range: `npm install --no-save @earendil-works/pi-ai@<v> @earendil-works/pi-coding-agent@<v>`.
- What the wrapper depends on: `anthropicMessagesApi` exported from `@earendil-works/pi-ai/compat` and aliased by the extension loader, `ModelRuntime.getRegisteredProviderConfig`, and the auth precedence in `packages/ai/src/auth/resolve.ts`, where a stored OAuth credential owns the provider and a failed refresh gives no environment fallback.

## Supply-chain drift policy

- Bump `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` together. They share private TypeScript members and provider contracts.
- Keep `@types/node` on the declared Node floor (`~22.19.0`).
- `tests/dependency-drift.test.ts` checks that the installed `node_modules` matches `package-lock.json` for every declared dependency; when it fails, run `npm ci`.

## Live acceptance (not part of the suite)

The live check must be authorized separately. It runs a real `/login anthropic` session through this wrapper and checks a plain turn, a tool round trip, compaction, and a repeat turn with cache reads. Record the result outside the repository; never record tokens, prompts or raw payloads.
