import assert from "node:assert/strict";
import test from "node:test";

import type { Api, AssistantMessage, Context, Message, Model } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/compat";

import {
  CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
  CLAUDE_SUBSCRIPTION_PROVIDER_ID,
  MODELS,
} from "../src/models.ts";
import { resetConvertMessagesMemoForTests } from "../src/native-message-conversion.ts";
import { contextToPayload } from "../src/native-payload.ts";
import { buildNativeMessagesRequest } from "../src/native-request.ts";

// Anthropic reuses a cached prefix only when it is byte-identical. These tests
// pin that property across a growing session, a restarted process and new
// sessions, so a volatile value added to the tools, the system prompt or replayed
// history fails here instead of quietly raising plan usage. Each case runs on both
// context shapes: Pi >= 0.87 sends transcript system messages, older Pi sets
// `systemPrompt` and `tools`.

const FAKE_TOKEN = "fake-access-token";
const MAX_CACHE_BREAKPOINTS = 4;
const model = {
  ...MODELS.find((candidate) => candidate.id === "claude-opus-5-5"),
  provider: CLAUDE_SUBSCRIPTION_PROVIDER_ID,
  api: CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
  baseUrl: "https://api.anthropic.com",
} as Model<Api>;

const tools = [
  { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "bash", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
] as unknown as Context["tools"];

type Body = {
  tools: Array<Record<string, unknown>>;
  system: Array<Record<string, unknown>>;
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
  thinking?: unknown;
  output_config?: unknown;
};
type ContextShape = (context: Context) => Context;

const contextShapes: Array<[string, ContextShape]> = [
  ["legacy context", (context) => context],
  ["transcript context", (context) => normalizeContext(context) as unknown as Context],
];

// Each call clones the history, as a restarted process would, so a value that only
// the in-process conversion memo keeps stable still fails.
function requestBody(messages: Message[], shape: ContextShape): Body {
  resetConvertMessagesMemoForTests();
  const context: Context = { systemPrompt: "Stable Pi system prompt.\nPrefer small changes.", tools, messages: structuredClone(messages) };
  const payload = contextToPayload(model, shape(context), { reasoning: "high" });
  return buildNativeMessagesRequest({ accessToken: FAKE_TOKEN, payload }).body as unknown as Body;
}

function assistantTurn(index: number): AssistantMessage {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: `Step ${index}.`, thinkingSignature: `sig_${index}` },
      { type: "toolCall", id: `toolu_${index}`, name: "read", arguments: { path: `f${index}.md` } },
    ],
    api: CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
    provider: CLAUDE_SUBSCRIPTION_PROVIDER_ID,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: index,
  };
}

function toolResult(index: number): Message {
  return { role: "toolResult", toolCallId: `toolu_${index}`, toolName: "read", content: [{ type: "text", text: `contents ${index}` }], isError: false, timestamp: index };
}

function withoutCacheControl(block: Record<string, unknown>): string {
  const { cache_control: _cacheControl, ...rest } = block;
  return JSON.stringify(rest);
}

// The order of Anthropic's prompt prefix: tools, then system, then messages.
function orderedBlocks(body: Body): string[] {
  const blocks = [...body.tools.map(withoutCacheControl), ...body.system.map(withoutCacheControl)];
  for (const message of body.messages) {
    const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    for (const block of content) blocks.push(`${message.role}:${withoutCacheControl(block)}`);
  }
  return blocks;
}

function breakpointCount(body: Body): number {
  const messageBlocks = body.messages.flatMap((message) => (typeof message.content === "string" ? [] : message.content));
  return [...body.tools, ...body.system, ...messageBlocks].filter((block) => "cache_control" in block).length;
}

for (const [shapeName, shape] of contextShapes) {
  test(`each turn sends the previous turn's request as an exact prefix: ${shapeName}`, () => {
    const messages: Message[] = [{ role: "user", content: "Review the files.", timestamp: 0 }];
    const first = requestBody(messages, shape);
    let previous = orderedBlocks(first);
    for (let index = 1; index <= 8; index += 1) {
      messages.push(assistantTurn(index), toolResult(index));
      const body = requestBody(messages, shape);
      const current = orderedBlocks(body);
      assert.deepEqual(current.slice(0, previous.length), previous, `turn ${index} changed an earlier block`);
      assert.ok(current.length > previous.length, `turn ${index} must extend the conversation`);
      assert.equal(breakpointCount(body), MAX_CACHE_BREAKPOINTS, `turn ${index} must use every cache breakpoint`);
      assert.deepEqual(body.thinking, first.thinking, `turn ${index} changed the thinking settings`);
      assert.deepEqual(body.output_config, first.output_config, `turn ${index} changed the effort settings`);
      const lastBlock = body.messages.at(-1)?.content.at(-1);
      assert.ok(typeof lastBlock === "object" && "cache_control" in lastBlock, `turn ${index} must move the cache anchor to its last block`);
      previous = current;
    }
  });

  test(`new sessions share the tools and system prefix, whatever their first message says: ${shapeName}`, () => {
    const first = requestBody([{ role: "user", content: "First task.", timestamp: 0 }], shape);
    const second = requestBody([{ role: "user", content: "A completely different task.", timestamp: 0 }], shape);
    assert.ok(first.tools.length > 0 && first.system.length > 0);
    assert.equal(JSON.stringify(second.tools), JSON.stringify(first.tools));
    assert.equal(JSON.stringify(second.system), JSON.stringify(first.system));
  });
}
