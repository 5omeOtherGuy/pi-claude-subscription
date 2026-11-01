# Choose a model

The package ships 13 models, and the provider does not treat them all the same way. This guide covers the differences that can decide your choice. It does not rank the models or recommend one, because this repository has no measurements to support a ranking. For every model's limits and thinking levels, see the [model reference](../README.md#model-reference).

## Choose how thinking is limited

Three models use a fixed token budget: `claude-haiku-4-5`, `claude-sonnet-4-6`, and `claude-opus-4-6`. Pi levels `minimal`, `low`, `medium`, `high`, and `xhigh` send default `budget_tokens` of 1024, 4096, 10240, 20480, and 32768. These models have no `max` level. Pick one of them if each turn needs a stated limit on reasoning tokens.

The other ten models use adaptive thinking. The provider sends `thinking: { type: "adaptive", display: "summarized" }` and maps the Pi level to a Claude effort. Effort guides the model and sets no token budget. Claude has no `minimal` effort, so Pi `minimal` sends `low`. All ten models offer `max`.

The provider sends `temperature` only on the three budget models, and only when a request has no thinking. It drops `temperature` on every adaptive model and never sends `top_p` or `top_k`.

## Check what `off` does on your model

Pi `off` does not mean the same thing on every model:

- `claude-haiku-5-5` sends `thinking: { type: "disabled" }` with effort `low`. It is the only model where the provider asks the API for no thinking.
- `claude-sonnet-5-5` sends `thinking: { type: "between_tools" }` with effort `low`. The model skips up-front reasoning but still returns progress updates between tool calls.
- `claude-opus-5-5` and `claude-fable-5-1` have no `off`, because they cannot run without thinking. Pi clamps a saved `off` to `minimal`, and the provider clamps a request without a level the same way. Claude then receives effort `low`, so these models never run at the API's default effort.
- `claude-fable-5` offers `off`, but the provider only omits `thinking` and `output_config`. Thinking stays on at the server, and an explicit `disabled` returns a 400 error.
- `claude-opus-4-7`, `claude-opus-4-7-300k`, `claude-opus-4-8`, `claude-opus-5`, and `claude-sonnet-5` also omit both fields. The omission does not guarantee that the server skips thinking.
- The three budget models omit `thinking`, with the same caveat.

## Decide what a refusal should do

Anthropic's safety classifiers can decline a request. Two models name a fallback in the `fallbacks` request field, so the API retries on the fallback model without a second request from Pi:

- `claude-fable-5` falls back to `claude-opus-4-8`.
- `claude-fable-5-1` falls back to `claude-opus-5`.

If the fallback also declines or is unavailable, the turn ends with an error that says so. If the API rejects the `fallbacks` field with a 400 error, the provider retries without the field and stops sending it until the process exits. Refusals then end the turn.

The other 11 models, including `claude-opus-5-5`, have no fallback. A refusal on one of them ends the turn with an error that tells you to rephrase or switch models.

## Compare limits only where they differ

`claude-haiku-4-5` and `claude-sonnet-4-6` have a 200,000-token context window and a 64,000-token output cap. Every other model has a 128,000-token output cap and a 1,000,000-token context window, except `claude-opus-4-7-300k`.

`claude-opus-4-7-300k` is not a separate Anthropic model. Pi sees a 300,000-token context window, and native requests send `claude-opus-4-7`. Pick it to keep Opus 4.7 but have Pi work to a smaller window.

## Expect fixed versions, with one exception

The provider registers fixed model ids and never rotates to whatever Anthropic labels "latest". Anthropic documents that dateless ids from the 4.6 generation onward are pinned snapshots, so the same id keeps the same weights across a project.

`claude-haiku-4-5` is the exception. It is older than that scheme, and the API treats it as an alias for the most recent dated Haiku 4.5 snapshot.

## Know how the list changes

An authenticated refresh decides which models exist and changes nothing else about known models. Each known model keeps the settings and limits it shipped with, and it leaves the list if the API stops listing it.

The provider adds a new model only if the API reports adaptive thinking and usable limits and effort data. A new model takes its limits and levels from the API, has no refusal fallback, and offers `off` only if the API reports `disabled` support. Pi `off` on such a model omits `thinking` and `output_config`.

The API list may not match your subscription, so a listed model can still fail when you call it.

## Switch models mid-session

You can switch models during a session safely, because Anthropic rejects a reasoning signature from another model and the provider never sends one. The provider replays signed and redacted reasoning only when the provider, the API, and the model id all match the model that produced it.

For any other model, the provider sends visible reasoning as ordinary assistant text without its signature, and it drops redacted reasoning. The match is on the exact id, so `claude-opus-4-7` and `claude-opus-4-7-300k` count as different models.

## Sources

- Anthropic, *Models overview*: https://platform.claude.com/docs/en/about-claude/models/overview
- Anthropic, *Model IDs and versioning*: https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions
- Anthropic, *Adaptive thinking*: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
- Anthropic, *Prompting best practices*: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
