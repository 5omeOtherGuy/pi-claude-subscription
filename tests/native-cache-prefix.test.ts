import assert from "node:assert/strict";
import test from "node:test";

import type { Api, AssistantMessage, Context, Message, Model } from "@earendil-works/pi-ai";

import {
  CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
  CLAUDE_SUBSCRIPTION_PROVIDER_ID,
  MODELS,
} from "../src/models.ts";
import { contextToPayload } from "../src/native-payload.ts";
import { buildNativeMessagesRequest } from "../src/native-request.ts";

// Anthropic reuses a cached prefix only when it is byte-identical. These tests
// pin that property across a growing session and across new sessions, so a
// volatile value added to the tools, the system prompt or replayed history
// fails here instead of quietly raising plan usage.

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

type Body = { tools: Array<Record<string, unknown>>; system: Array<Record<string, unknown>>; messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> };

function requestBody(messages: Message[]): Body {
  const context: Context = { systemPrompt: "Stable Pi system prompt.\nPrefer small changes.", tools, messages };
  const payload = contextToPayload(model, context, { reasoning: "high" });
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

// The order Anthropic hashes a prompt in: tools, then system, then messages.
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

test("each turn sends the previous turn's request as an exact prefix", () => {
  const messages: Message[] = [{ role: "user", content: "Review the files.", timestamp: 0 }];
  let previous = orderedBlocks(requestBody(messages));
  for (let index = 1; index <= 8; index += 1) {
    messages.push(assistantTurn(index), toolResult(index));
    const body = requestBody(messages);
    const current = orderedBlocks(body);
    assert.deepEqual(current.slice(0, previous.length), previous, `turn ${index} changed an earlier block`);
    assert.ok(current.length > previous.length, `turn ${index} must extend the conversation`);
    assert.equal(breakpointCount(body), MAX_CACHE_BREAKPOINTS, `turn ${index} must use every cache breakpoint`);
    previous = current;
  }
});

test("the last block of every request carries the moving cache anchor", () => {
  const messages: Message[] = [{ role: "user", content: "Review the files.", timestamp: 0 }, assistantTurn(1), toolResult(1)];
  const last = requestBody(messages).messages.at(-1);
  assert.equal(last?.role, "user");
  assert.ok(Array.isArray(last?.content) && "cache_control" in last.content.at(-1)!);
});

test("new sessions share the tools and system prefix, whatever their first message says", () => {
  const first = requestBody([{ role: "user", content: "First task.", timestamp: 0 }]);
  const second = requestBody([{ role: "user", content: "A completely different task.", timestamp: 0 }]);
  assert.equal(JSON.stringify(second.tools), JSON.stringify(first.tools));
  assert.equal(JSON.stringify(second.system), JSON.stringify(first.system));
});
