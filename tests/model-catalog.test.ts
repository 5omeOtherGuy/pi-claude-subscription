import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RefreshModelsContext } from "@earendil-works/pi-ai";

import { createClaudeModelCatalog } from "../src/model-catalog.ts";
import { MODELS } from "../src/models.ts";

const context = (allowNetwork = true): RefreshModelsContext => ({
  allowNetwork, signal: new AbortController().signal, publish: async () => true,
});

const scratch = mkdtempSync(join(tmpdir(), "pi-claude-subscription-catalog-"));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
let cacheFiles = 0;
const freshCachePath = () => join(scratch, `catalog-${cacheFiles++}`, "model-catalog.json");

const FAKE_TOKEN = "fake-token";
const newModelEntry = {
  id: "claude-new-1", display_name: "Claude New", max_input_tokens: 300_000, max_tokens: 80_000,
  capabilities: { effort: { low: { supported: true }, high: { supported: true } }, thinking: { types: { adaptive: { supported: true } } } },
};
const listing = (...data: unknown[]) => async () => Response.json({ data, has_more: false });

test("Claude catalog uses OAuth headers, paginates, and maps new models", async () => {
  const urls: string[] = [];
  const refresh = createClaudeModelCatalog(async (url, init) => {
    urls.push(url);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), "Bearer fake-token");
    assert.equal(headers.get("x-api-key"), null);
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    assert.ok(init.signal);
    return Response.json(urls.length === 1
      ? { data: [{ id: "claude-new-1", display_name: "Claude New", max_input_tokens: 300_000, max_tokens: 80_000,
          capabilities: { image_input: { supported: true }, effort: { low: { supported: true }, high: { supported: true } },
            thinking: { types: { adaptive: { supported: true }, disabled: { supported: false } } } } }],
        has_more: true, last_id: "cursor-1" }
      : { data: [{ id: "other-model", display_name: "Other", max_input_tokens: 1000, max_tokens: 1000 }], has_more: false });
  }, async () => "fake-token", freshCachePath());
  const models = await refresh(context());
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]!).searchParams.get("after_id"), "cursor-1");
  assert.deepEqual(models.map((model) => model.id), ["claude-new-1"]);
  assert.equal(models[0]?.contextWindow, 300_000);
  assert.equal(models[0]?.maxTokens, 80_000);
  assert.equal(models[0]?.reasoning, true);
  assert.equal(models[0]?.thinkingLevelMap?.off, null);
  assert.deepEqual(models[0]?.input, ["text", "image"]);
});

test("Claude catalog preserves known compatibility and local soft-cap aliases", async () => {
  const refresh = createClaudeModelCatalog(async () => Response.json({ data: [
    { id: "claude-opus-4-7", display_name: "Claude Opus 4.7", max_input_tokens: 1_000_000, max_tokens: 128_000 },
  ], has_more: false }), async () => "fake-token", freshCachePath());
  const models = await refresh(context());
  assert.deepEqual(models.map((model) => model.id), ["claude-opus-4-7", "claude-opus-4-7-300k"]);
  assert.deepEqual(models[0]?.thinkingLevelMap, MODELS.find((model) => model.id === "claude-opus-4-7")?.thinkingLevelMap);
});

test("Claude catalog falls back offline, on failed pages and malformed payloads", async () => {
  let calls = 0;
  const refresh = createClaudeModelCatalog(async () => { calls++; throw new Error("offline"); }, async () => "fake-token", freshCachePath());
  assert.deepEqual(await refresh(context(false)), [...MODELS]);
  assert.equal(calls, 0);
  assert.deepEqual(await refresh(context()), [...MODELS]);
  for (const response of [new Response("denied", { status: 401 }), Response.json({ data: [], has_more: true }), Response.json({ data: [] })]) {
    assert.deepEqual(await createClaudeModelCatalog(async () => response, async () => "fake-token", freshCachePath())(context()), [...MODELS]);
  }
});

test("Claude catalog keeps manual-budget models on budget thinking when the API also offers adaptive", async () => {
  const thinking = { types: { adaptive: { supported: true }, enabled: { supported: true }, disabled: { supported: true } } };
  const refresh = createClaudeModelCatalog(listing(
    { id: "claude-opus-4-6", display_name: "Claude Opus 4.6", max_input_tokens: 1_000_000, max_tokens: 128_000, capabilities: { thinking } },
    { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", max_input_tokens: 1_000_000, max_tokens: 128_000, capabilities: { thinking } },
  ), async () => FAKE_TOKEN, freshCachePath());
  const models = await refresh(context());
  assert.deepEqual(models.map((model) => model.id), ["claude-opus-4-6", "claude-sonnet-4-6"]);
  for (const model of models) assert.equal(model.compat, undefined, `${model.id} must keep its tested request settings`);
});

test("Claude catalog keeps a known model that the API lists only under a dated name", async () => {
  const refresh = createClaudeModelCatalog(listing(
    { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", max_input_tokens: 1_000_000, max_tokens: 128_000 },
    { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5", max_input_tokens: 200_000, max_tokens: 64_000,
      capabilities: { thinking: { types: { enabled: { supported: true } } } } },
  ), async () => FAKE_TOKEN, freshCachePath());
  const ids = (await refresh(context())).map((model) => model.id);
  assert.ok(ids.includes("claude-haiku-4-5"));
  assert.ok(!ids.includes("claude-haiku-4-5-20251001"), "unknown manual-budget ids stay unsupported");
  assert.ok(!ids.includes("claude-opus-4-8"), "models the API does not list still leave the catalog");
});

test("Claude catalog survives restarts and failed refreshes through its saved list", async () => {
  const cachePath = freshCachePath();
  await createClaudeModelCatalog(listing(newModelEntry), async () => FAKE_TOKEN, cachePath)(context());
  const nextRun = () => createClaudeModelCatalog(async () => { throw new Error("offline"); }, async () => FAKE_TOKEN, cachePath);
  assert.deepEqual((await nextRun()(context(false))).map((model) => model.id), ["claude-new-1"], "offline refresh");
  assert.deepEqual((await nextRun()(context())).map((model) => model.id), ["claude-new-1"], "failed network refresh");
  const denied = createClaudeModelCatalog(async () => new Response("denied", { status: 401 }), async () => FAKE_TOKEN, cachePath);
  assert.deepEqual((await denied(context())).map((model) => model.id), ["claude-new-1"], "rejected refresh");
});

test("Claude catalog stores API entries only, so a later package version re-applies its rules", async () => {
  const cachePath = freshCachePath();
  await createClaudeModelCatalog(listing(newModelEntry), async () => FAKE_TOKEN, cachePath)(context());
  const saved = readFileSync(cachePath, "utf8");
  assert.ok(!saved.includes(FAKE_TOKEN));
  assert.deepEqual(JSON.parse(saved).data, [newModelEntry]);
});

test("Claude catalog ignores a damaged saved list and does not save an unusable response", async () => {
  const cachePath = freshCachePath();
  await createClaudeModelCatalog(listing({ id: "not-claude", display_name: "Other" }), async () => FAKE_TOKEN, cachePath)(context());
  assert.equal(existsSync(cachePath), false);
  await createClaudeModelCatalog(listing(newModelEntry), async () => FAKE_TOKEN, cachePath)(context());
  for (const damaged of ["not json", "{}", '{"data":[{"id":"not-claude"}]}']) {
    writeFileSync(cachePath, damaged);
    assert.deepEqual(await createClaudeModelCatalog(listing(), async () => FAKE_TOKEN, cachePath)(context(false)), [...MODELS]);
  }
});
