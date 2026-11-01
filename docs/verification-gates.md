# Verification gates and drift checks

No live Anthropic calls are allowed in the deterministic suite. Use fake credentials, static fixtures, and mocked network and transport boundaries, unless the user explicitly requests an opt-in live check.

## Change-type gates

| Change type | Focused checks | Broader gate |
|---|---|---|
| Tool JSON parsing / SSE | `node --test --import tsx tests/tool-json-arguments.test.ts tests/anthropic-sse.test.ts tests/native-stream-simple.test.ts` | `npm run check` |
| Request headers/body/cache | `node --test --import tsx tests/native-request.test.ts tests/native-cache-prefix.test.ts tests/native-stream-simple.test.ts` | `npm run check` |
| Credentials/refresh/redaction | `node --test --import tsx tests/native-credentials.test.ts tests/redaction.test.ts tests/native-stream-simple.test.ts` | `npm run check` |
| Extension registration/provider guard | `node --test --import tsx tests/current-provider-system-shape.test.ts tests/package-manifest.test.ts tests/pi-session.test.ts` | `npm run check` |
| Dependency/model metadata | `node --test --import tsx tests/dependency-drift.test.ts tests/current-provider-system-shape.test.ts tests/model-catalog.test.ts tests/native-request.test.ts tests/pi-session.test.ts` plus `npm run typecheck` | `npm run check` |
| Docs only | Link, path, and wording checks for the touched docs | `npm run typecheck` optional if code is untouched |

`npm run check` is the pre-PR gate for behavior, dependency, model, request, credential, stream, and package changes. The CI job `gate` runs it, which covers the secret scan, the tests, and the typecheck.

## Host compatibility

- The supported Pi range is `>=0.80.6 <2`, the `peerDependencies` in `package.json`. Pi 0.80.6 is the floor for native `max` thinking. Pi 2.x is untested and stays outside the range until it is verified.
- We verified Pi 0.80.6, 0.87.1, and 1.3.0 on 2026-10-18.
- CI tests the locked devDependency with `tests/pi-session.test.ts`. The locked devDependency is the newest Pi release (1.4.0 as of 2026-11-01).
- `tests/pi-session.test.ts` loads the extension into a real Pi session against a stubbed Anthropic endpoint. It checks provider selection, OAuth-only headers, system blocks, tool declarations, and a tool-call round trip.
- On 2026-10-18 the same scenario also passed against Pi 0.80.6 and 0.87.1 in scratch installs (`npm install --no-save @earendil-works/pi-ai@<v> @earendil-works/pi-coding-agent@<v>`). Older Pi such as 0.80.6 exposes `session.modelRegistry.find()` instead of `session.modelRuntime.getModel()`.
- When a new Pi major ships, bump both Pi packages together. Dependabot's `pi` group does this. Then adapt `src/` and `tests/`, repeat the check above, and widen the range only for what was verified.

## Supply-chain drift policy

- Bump `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` together. They share private TypeScript members and provider contracts, so a bump to only one can compile against the wrong API.
- After changing either package, rerun the `Dependency/model metadata` gate. Then re-check these native request and tool-call assumptions: the Pi-core `edit` schema, validation, `prepareArguments`, built-in Anthropic tool conversion, OAuth headers, and provider registration.
- `overrides` in `package.json` forces `undici` to 8.12.2 in the development tree, because Pi 1.4.0 pins the vulnerable 8.10.2 (Dependabot alert 33). The override covers only the installed `node_modules/undici`. The `pi` binary in `node_modules/.bin` runs a bundle with its own copy, and that copy stays on the vulnerable version. Remove the override once a Pi release ships a patched `undici`. Check for that release on each Pi update, because the exact pin would otherwise hold a newer `undici` back. The override does not change what users install, because this package has no runtime dependencies and Pi brings its own `undici`.
- Keep `@types/node` on the declared Node floor (`~22.19.0`), so TypeScript cannot allow APIs outside `engines.node`.
- Treat lockfile updates as behavior changes unless they are clearly type-only or dev-only, and record why the upgrade is safe.
- `tests/dependency-drift.test.ts` enforces an installed-versus-lockfile preflight check. For every declared dependency, it compares the `package-lock.json` version with the version in `node_modules`. A stale install therefore fails before `npm test` dies at import with `ERR_MODULE_NOT_FOUND`. When the check fails, run `npm ci`.

## Runtime and API drift policy

- Treat findings from the local Claude Code binary or package as time-bound. After a material Claude Code change, rerun bounded static extraction for headers, betas, tool schema, tool choice, identity, prompt caching, and the `edit` schema.
- Do not assume that Claude Code's native `Edit` schema matches Pi-core's lowercase `edit` tool schema.
- Track Anthropic API changes to betas, thinking, `tool_choice`, cache-control breakpoints, stop reasons, and SSE event types through deterministic docs and source updates first.
- Live Anthropic checks are opt-in only. Do not commit live logs, raw payloads, credentials, `Authorization` or `Bearer` values, `.credentials.json` contents, prompts, or machine-specific outputs.

## Extraction artifact hygiene

Keep new static-extraction artifacts outside the public package, under an ignored local path. Include enough metadata to make the claim reproducible without secrets: package and CLI versions, hashes, commands, target strings, a claim ledger, and safety notes.
