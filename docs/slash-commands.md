# Slash-command reference

The extension registers three local slash commands. They make no network request, refresh no token, and do not change Pi's `auth.json`. They record no prompt text, tool arguments, or model output.

| Command | Effect |
|---|---|
| `/claude-subscription-status` | Reports the provider, the active provider, the credential source, the account, token freshness, refresh availability, and the discovered account count. Writes nothing. |
| `/claude-subscription-accounts` | Discovers the Claude Code credential file and saves it as the active account. |
| `/claude-subscription-import` | Copies the discovered credential file into package-owned state and saves that copy as the active account. |

If Pi reports one of these commands as unknown, the extension did not load. Run `pi list` to see the installed packages. If this package is missing, follow the steps in [Install](../README.md#install).

## Credential discovery

All three commands use the same discovery. It reads one file:

- `$CLAUDE_CONFIG_DIR/.credentials.json` when `CLAUDE_CONFIG_DIR` is set.
- `$HOME/.claude/.credentials.json` otherwise.

The file counts as an account when it has a non-empty `accessToken`, either in `claudeAiOauth` or at the top level. Discovery therefore finds zero or one account.

Discovery does not read the macOS Keychain. `discoverKeychainAccounts` returns an empty list without a `runSecurity` option, and the extension passes none.

## Credentials used for requests

A request loads the active account stored in `pi-claude-subscription/credential-state.json` under Pi's agent directory. Without a stored active account, the request uses the discovery file.

A stored active account wins over `CLAUDE_CONFIG_DIR`. After `/claude-subscription-accounts` or `/claude-subscription-import` saves an account, a changed `CLAUDE_CONFIG_DIR` has no effect on requests. Requests follow `CLAUDE_CONFIG_DIR` again only if `credential-state.json` is absent.

On macOS, a request that cannot read its credential file loads the single `Claude Code-credentials` Keychain item. A request also tries that item when the file's token needs a refresh and the refresh fails. With only that Keychain item, requests work and all three commands report no credentials.

## `/claude-subscription-status`

The output is one notification with three lines:

```
claude-subscription uses native Anthropic Messages with Claude Code OAuth on native API claude-subscription-native.
active_provider=claude-subscription
credentials=Claude Code credentials file /home/you/.claude/.credentials.json account=person@example.test subscription=max token=fresh refresh=available accounts=1
```

The notification level depends on the third line:

| Level | Condition |
|---|---|
| `info` | `token` is `fresh` or `unknown`. |
| `warning` | `token` is `expired` or `near-expiry`. |
| `error` | No credentials were found. |

The second line is `active_provider=<provider>`, the provider of the session's current model. The value can differ from `claude-subscription`, and it is `none` when the session has no model.

The third line contains these fields in this order:

| Field | Values |
|---|---|
| `credentials` | `Claude Code credentials file <path>` or `package-owned import <path>`. |
| `account` | The email from the credential JSON, or `unknown-account`. |
| `subscription` | `subscriptionType`, or else `rateLimitTier`. The field is absent when the credential JSON has neither. |
| `token` | `fresh`, `near-expiry` (at most 5 minutes left), `expired`, or `unknown` (no numeric `expiresAt`). |
| `refresh` | `available` or `missing`, depending on whether the credential has a `refreshToken`. |
| `accounts` | The number of discovered accounts. An imported copy does not count. |
| `action` | Present only in the cases listed below. |

The `action` field depends on `token` and `refresh`:

| `token` | `refresh` | `action` |
|---|---|---|
| `expired` | `missing` | `action=Run Claude Code login; expired token has no refresh token` |
| `expired` | `available` | `action=token will refresh on next request` |
| `near-expiry` | Either value | `action=token will refresh before request` |

The `near-expiry` text also appears with `refresh=missing`, although no refresh can happen in that case.

If the stored active account cannot be read, the third line reports the first discovered account. Requests still use the stored account.

If no account is available, the third line is:

```
credentials=missing accounts=0 No Claude Code OAuth credentials found. Run Claude Code login (`claude`) or /claude-subscription-import after credentials exist. No API-key fallback is used.
```

The command does not read `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or Pi's `auth.json`.

## `/claude-subscription-accounts`

The result depends on the number of discovered accounts:

| Accounts | Result |
|---|---|
| 0 | An `error` notification that says no credentials were found. The command writes nothing. |
| 1 | The command saves the account and shows an `info` notification, `Selected <label>.` |
| More than 1 | The command shows a selector. Production discovery cannot return this many accounts, so the selector does not appear. |

The label contains the account, the subscription when present, and the source.

The command writes the `activeAccount` field of `credential-state.json`. The field holds the source type and path, and no token. The command keeps the other fields and leaves any imported copy in place.

## `/claude-subscription-import`

The command uses the same discovery as `/claude-subscription-accounts`. With zero accounts, it shows the same `error` notification and writes nothing.

With one account, the command writes two files under `pi-claude-subscription/` in Pi's agent directory:

- `imported-credentials.json` receives the raw credential JSON and replaces any earlier copy.
- `credential-state.json` receives `activeAccount`, which points at the copy, and `importedFrom`, which holds the source.

The command creates a new directory with mode `0700` and new files with mode `0600`. It then shows an `info` notification, `Imported <label> into package-owned credential state.`

The copy is a duplicate OAuth credential secret, and it does not follow later changes to the source file. Token refreshes write to the copy.

Deleting `imported-credentials.json` leaves `activeAccount` pointing at the missing file. Requests then fail until `/claude-subscription-accounts` saves another account. On macOS, requests use the Keychain item instead of failing.

## Provider registration

None of the three commands changes provider registration. The extension does so when it loads:

- It calls `pi.unregisterProvider("anthropic")`. The call removes an `anthropic` registration queued by an extension that loaded earlier. Pi's built-in `anthropic` models stay listed.
- It refuses new prompts on the providers `anthropic`, `custom-anthropic`, and `meridian`. The [README](../README.md) lists the limits of that refusal.
