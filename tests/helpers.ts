// Synthetic fixtures shared by the tests. Nothing here is a real credential;
// token-shaped strings are assembled from parts so the secret scan stays clean.
import type { AssistantMessage, Context, Message, Tool } from "@earendil-works/pi-ai";

export const OAUTH_TOKEN = ["sk", "ant", "oat01", "fixture", "token", "abcdef"].join("-");
export const API_KEY = ["sk", "ant", "api03", "fixture", "key", "abcdef"].join("-");

export type CapturedRequest = { url: string; headers: Headers; body: Record<string, any>; redirect?: RequestRedirect };

type Event = Record<string, unknown> & { type: string };

export function sseText(events: Event[]): string {
  return events.map((data) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

export function sseResponse(events: Event[] | string, init: { requestId?: string } = {}): Response {
  return new Response(typeof events === "string" ? events : sseText(events), {
    status: 200,
    headers: { "content-type": "text/event-stream", "request-id": init.requestId ?? "req_fixture_1" },
  });
}

const usage = (output = 5) => ({
  input_tokens: 11,
  output_tokens: output,
  cache_read_input_tokens: 7,
  cache_creation_input_tokens: 3,
});

export function messageStart(model = "claude-sonnet-4-6"): Event {
  return { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: usage(1) } };
}

export function messageEnd(stopReason: string): Event[] {
  return [
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: usage() },
    { type: "message_stop" },
  ];
}

export function textBlock(index: number, text: string): Event[] {
  return [
    { type: "content_block_start", index, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index },
  ];
}

export function thinkingBlock(index: number, thinking: string, signature: string): Event[] {
  return [
    { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking } },
    { type: "content_block_delta", index, delta: { type: "signature_delta", signature } },
    { type: "content_block_stop", index },
  ];
}

export function toolUseBlock(index: number, id: string, name: string, input: unknown): Event[] {
  const json = JSON.stringify(input);
  const half = Math.floor(json.length / 2);
  return [
    { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(0, half) } },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(half) } },
    { type: "content_block_stop", index },
  ];
}

export const replies = {
  text: (): Event[] => [messageStart(), ...textBlock(0, "Hello 😀 𐐷"), ...messageEnd("end_turn")],
  thinking: (): Event[] => [
    messageStart(),
    ...thinkingBlock(0, "Considering.", "sig_fixture_1"),
    ...textBlock(1, "Answer."),
    ...messageEnd("end_turn"),
  ],
  parallelTools: (): Event[] => [
    messageStart(),
    ...toolUseBlock(0, "toolu_a", "read", { path: "a.txt" }),
    ...toolUseBlock(1, "toolu_b", "bash", { command: "printf 'x y'" }),
    ...messageEnd("tool_use"),
  ],
  toolCall: (id: string, name: string, input: unknown): Event[] => [messageStart(), ...toolUseBlock(0, id, name, input), ...messageEnd("tool_use")],
  // Anthropic's mid-stream error event after partial text.
  streamError: (): Event[] => [
    messageStart(),
    ...textBlock(0, "partial"),
    { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
  ],
  // Body ends inside a tool call: no content_block_stop or message_stop.
  truncated: (): string => sseText([
    messageStart(),
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_t", name: "bash", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"command\":\"rm -rf /tmp/x" } },
  ]),
};

export type Responder = (request: CapturedRequest, index: number) => Response | Promise<Response>;

/** A recording fetch. It is passed per request; nothing global is replaced. */
export function captureFetch(responder: Responder = () => sseResponse(replies.text())) {
  const requests: CapturedRequest[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const request: CapturedRequest = {
      url,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : {},
      redirect: init?.redirect,
    };
    requests.push(request);
    return responder(request, requests.length - 1);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

export const readTool: Tool = {
  name: "read",
  description: "Read a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to read" },
      offset: { type: "integer", minimum: 1 },
      encoding: { type: "string", enum: ["utf8", "base64"] },
    },
    required: ["path"],
    additionalProperties: false,
  } as unknown as Tool["parameters"],
};

export const bashTool: Tool = {
  name: "bash",
  description: "Run a command",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout: { anyOf: [{ type: "number" }, { type: "null" }] },
      env: { type: "object", additionalProperties: { type: "string" } },
    },
    required: ["command"],
  } as unknown as Tool["parameters"],
};

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"], model = "claude-sonnet-4-6"): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: 2,
  };
}

/**
 * The review reproducers in one conversation:
 * A: supplementary-plane text the old converter turned into replacement characters;
 * B: assistant toolCall(t1), then a system patch, then toolResult(t1);
 * plus signed and redacted thinking replayed from the same model, and full tool schemas.
 */
export function reviewContext(): Context {
  const messages: Message[] = [
    { role: "user", content: "A 😀 𐐷 Z", timestamp: 1 },
    assistant([
      { type: "thinking", thinking: "Need the file.", thinkingSignature: "sig_same_model_1" },
      { type: "thinking", thinking: "", thinkingSignature: "redacted_payload_1", redacted: true },
      { type: "toolCall", id: "t1", name: "read", arguments: { path: "notes 😀.txt" } },
    ], "toolUse"),
    { role: "system", content: "Effort changed: be brief.", timestamp: 3 } as Message,
    { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "contents 𐐷" }], isError: false, timestamp: 4 } as Message,
    { role: "user", content: "Continue", timestamp: 5 },
  ];
  return { systemPrompt: "You are a coding agent.", messages, tools: [readTool, bashTool] };
}
