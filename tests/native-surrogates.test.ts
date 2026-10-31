import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { Api, AssistantMessage, Message, Model } from "@earendil-works/pi-ai";

import {
  CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
  CLAUDE_SUBSCRIPTION_PROVIDER_ID,
} from "../src/models.ts";
import { convertMessages, resetConvertMessagesMemoForTests } from "../src/native-message-conversion.ts";

const EMOJI_TEXT = "ok \u{1F600} and \u{10437}";
const LONE_HIGH = "before \uD83D after";
const LONE_LOW = "before \uDE00 after";
const REPLACEMENT = "�";

const model = {
  id: "claude-opus-5-5",
  provider: CLAUDE_SUBSCRIPTION_PROVIDER_ID,
  api: CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
  baseUrl: "https://api.anthropic.com",
} as Model<Api>;

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"], source: Pick<AssistantMessage, "api" | "provider" | "model"> = {
  api: CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
  provider: CLAUDE_SUBSCRIPTION_PROVIDER_ID,
  model: model.id,
}): AssistantMessage {
  return {
    role: "assistant",
    content,
    ...source,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: 2,
  };
}

function conversation(text: string): Message[] {
  return [
    { role: "user", content: text, timestamp: 1 },
    assistant([
      { type: "text", text },
      { type: "toolCall", id: "toolu_1", name: "read", arguments: { path: "notes.txt" } },
    ], "toolUse"),
    { role: "toolResult", toolCallId: "toolu_1", toolName: "read", content: [{ type: "text", text }], isError: false, timestamp: 3 },
    { role: "user", content: [{ type: "text", text }], timestamp: 4 },
  ];
}

function sentTexts(messages: ReturnType<typeof convertMessages>): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      texts.push(message.content);
      continue;
    }
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block.type === "text") texts.push(String(block.text));
      if (block.type !== "tool_result") continue;
      const content = block.content;
      if (typeof content === "string") texts.push(content);
      else for (const part of content as Array<Record<string, unknown>>) texts.push(String(part.text));
    }
  }
  return texts;
}

beforeEach(() => {
  resetConvertMessagesMemoForTests();
});

test("valid emoji reach Anthropic intact in user, assistant and tool-result text", () => {
  const texts = sentTexts(convertMessages(conversation(EMOJI_TEXT), model));
  assert.equal(texts.length, 4);
  for (const text of texts) assert.equal(text, EMOJI_TEXT);
});

test("valid emoji survive in foreign thinking replayed as text", () => {
  const messages: Message[] = [
    { role: "user", content: "hi", timestamp: 1 },
    assistant([{ type: "thinking", thinking: EMOJI_TEXT }], "stop", { api: "other-api", provider: "other-provider", model: "other-model" }),
    { role: "user", content: "next", timestamp: 3 },
  ];
  assert.ok(sentTexts(convertMessages(messages, model)).includes(EMOJI_TEXT));
});

test("unpaired surrogates become replacement characters", () => {
  for (const [input, expected] of [
    [LONE_HIGH, `before ${REPLACEMENT} after`],
    [LONE_LOW, `before ${REPLACEMENT} after`],
    [`\uDE00\uD83D`, `${REPLACEMENT}${REPLACEMENT}`],
    [`\u{1F600}\uD83D`, `\u{1F600}${REPLACEMENT}`],
  ] as const) {
    resetConvertMessagesMemoForTests();
    for (const text of sentTexts(convertMessages(conversation(input), model))) assert.equal(text, expected);
  }
});
