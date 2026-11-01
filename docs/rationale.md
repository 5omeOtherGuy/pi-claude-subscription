# Why this package exists

When a Claude session goes badly, you usually cannot tell why. The model Anthropic serves may have changed, the Claude Code harness around it may have got in the way, or your own prompt may be the problem. Public reports of model regressions tend to blur these three causes.

This package lets you change one of them. With a Claude Code subscription, you can run the same task in Pi on the same account and the same model ID, and compare the results. The package is not a benchmark suite, and it does not claim that any Anthropic change caused any regression.

## What the comparison does not remove

A session through this provider is not a bare Pi session. Every request sends the Claude Code identity, `You are Claude Code, Anthropic's official CLI for Claude.`, as the first `system` block, and it lists the `claude-code-20250219` beta in the `anthropic-beta` header. The subscription route is sensitive to request shape, and other shapes have failed with a generic 429. You pay that price to use the route, so count it as part of any result you compare. One sentence of identity is still far less than Claude Code's own system prompt, which this provider does not send.

Pi's system prompt follows as the second block, with one edit. The provider removes the three lines that match `DOC_ROUTING_PREFIXES` in [`src/constants.ts`](../src/constants.ts), which tell the model to read Pi's own documentation. Tools keep Pi's names, descriptions, and schemas. Conversation history stays as Pi holds it, except where the API forces a change, such as signed thinking from a different model. [`docs/architecture.md`](architecture.md) has the full request shape and the replay rules.

The rule behind these choices is to change what the model sees only when the route requires it or the effect can be measured. For the same reason, the provider adds no hidden compaction and no tool filtering.

## Why a native provider and not a proxy

A proxy is one more process to install, monitor, and trust with your token. This package has no daemon, no local proxy, no Python service, and no open port. Pi loads an extension, and the extension registers the provider.

The provider has its own client. Pi supplies the agent loop and calls the provider's `streamSimple` function. The provider then builds the request, parses the stream, and owns its model metadata in [`src/models.ts`](../src/models.ts). Owning that client makes these guarantees possible:

- The provider reads the Claude Code OAuth token for each request, and only after the stream confirms that the provider is `claude-subscription`.
- It never sends `x-api-key`, and it never reads `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`.
- The transport refuses any URL other than Anthropic's Messages endpoint.
- The stream ends with an error on malformed or out-of-order SSE events.
- Prompt-cache anchors and long-cache retention are TypeScript that you can read, with mocked tests. They save quota on repeated prefixes, but they do not promise the same behavior as Claude Code.

The cost is upkeep. This provider does not pick up Pi's Anthropic request changes automatically, so each one needs a change here. Until that change lands, this route lags Pi's built-in one. For a package that handles OAuth tokens, a client you can audit is worth that work.

## Use it for your own subscription only

This package is for one person using their own subscription on their own machine. Do not use it for resale or pooled access, and do not use it as a replacement for API usage. Do not connect it to API-capacity or arbitrage harnesses. If your workload belongs on the API, use the API and pay for it.

Keep the evidence honest too. Base a claim about a regression on measurements, and keep prompts, logs, and credentials out of anything you publish.
