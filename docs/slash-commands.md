# Slash-command reference

The extension registers one slash command, `/claude-subscription-status`. It runs inside Pi, makes no request, reads no credential files, and shows no prompt, tool, payload or credential content. If Pi reports it as unknown, the extension did not load: check `pi list` and re-run `pi install`.

The output is one notification, at level `info` when the wrapper is in the request path and `warning` when it is not.

```text
pi-claude-subscription <version> on Pi <host version>
route: provider anthropic (anthropic-messages) -> OAuth gate -> Pi's own Anthropic transport
login: Pi built-in (/login anthropic)
anthropic auth: <OAuth|API key or other> (<source>) | not configured
current model: <provider>/<id> | none
not covered: direct compat.streamSimple callers (they bypass registered providers)
last OAuth request: <ISO time> model=<provider>/<id> [status=<HTTP>] [request_id=<id>] [stop=<reason>] [anthropic_error=<type>] [blocked=<destination|wire_auth|redirect>] [network_error=<redacted cause>] [usage input=<n> output=<n> cache_read=<n> cache_write=<n>]
```

- `route: NOT COVERED` means another extension, or another copy of this one, registered an `anthropic` transport after this extension. Requests go through that transport instead. Load only one.
- `login: an extension overrides anthropic OAuth` means some extension replaced Pi's `/login anthropic`. This extension never does that and does not undo it.
- `anthropic auth` comes from Pi's auth snapshot; `source` is Pi's label (`stored`, `environment`, `runtime`, …).
- `last OAuth request` covers the most recent OAuth request this wrapper handled in this Pi process. API-key requests are not recorded. `anthropic_error` is Anthropic's error type, not the message text. `blocked` names the local check that stopped the request. The usage counters are Anthropic's numbers for that request.
