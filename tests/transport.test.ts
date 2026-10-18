import assert from "node:assert/strict";
import test from "node:test";

import * as compat from "@earendil-works/pi-ai/compat";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

import { Diagnostics, describeError, redactSensitiveText } from "../src/diagnostics.ts";
import {
  type AnthropicStreamSimple,
  createOAuthGatedStreamSimple,
  pickHostAnthropicStreamSimple,
} from "../src/transport.ts";
import {
  API_KEY,
  type CapturedRequest,
  OAUTH_TOKEN,
  type Responder,
  bashTool,
  captureFetch,
  readTool,
  replies,
  reviewContext,
  sseResponse,
} from "./helpers.ts";

const native = pickHostAnthropicStreamSimple(compat as unknown as Record<string, unknown>);
const sonnet = getBuiltinModel("anthropic", "claude-sonnet-4-6") as Model<Api>;
const opus = getBuiltinModel("anthropic", "claude-opus-4-8") as Model<Api>;

function wrapper(diagnostics = new Diagnostics()): AnthropicStreamSimple {
  return createOAuthGatedStreamSimple(native, diagnostics);
}

type Run = { events: string[]; result: AssistantMessage; requests: CapturedRequest[] };

async function run(
  transport: AnthropicStreamSimple,
  context: Context,
  options: SimpleStreamOptions,
  responder?: Responder,
  model: Model<Api> = sonnet,
): Promise<Run> {
  const { fetch, requests } = captureFetch(responder);
  const stream = transport(model, compat.normalizeContext(context), { ...options, fetch: options.fetch ?? fetch });
  const events: string[] = [];
  const consumed = (async () => {
    for await (const event of stream) events.push(event.type);
  })();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stream or result() hung")), 5_000).unref());
  const result = await Promise.race([stream.result(), timeout]);
  await Promise.race([consumed, timeout]);
  return { events, result, requests };
}

/** Removes the clock-dependent fields of a final message. */
function stable(message: AssistantMessage): AssistantMessage {
  const { timestamp: _timestamp, durationMs: _durationMs, ...rest } = message;
  return rest as AssistantMessage;
}

function wire(requests: CapturedRequest[]) {
  return requests.map(({ url, headers, body }) => ({ url, headers: Object.fromEntries(headers), body }));
}

const basicContext = (): Context => ({
  systemPrompt: "System prompt.",
  messages: [{ role: "user", content: "Hi", timestamp: 1 }],
  tools: [readTool, bashTool],
});

test("host transport resolution reads the public factory and fails loudly without it", () => {
  assert.equal(typeof native, "function");
  assert.throws(() => pickHostAnthropicStreamSimple({}), /anthropicMessagesApi/);
  assert.throws(() => pickHostAnthropicStreamSimple({ anthropicMessagesApi: () => ({}) }), /unsupported/);
});

test("delegation parity: OAuth requests match unwrapped Pi on the wire across options", async () => {
  const cases: Array<[string, SimpleStreamOptions, Model<Api>]> = [
    ["no reasoning", {}, sonnet],
    ["budget thinking + short cache + session", { reasoning: "high", cacheRetention: "short", sessionId: "session-1" }, sonnet],
    ["adaptive effort + long cache", { reasoning: "xhigh", cacheRetention: "long" }, opus],
    ["no cache + timeout + headers", { cacheRetention: "none", timeoutMs: 12_345, headers: { "x-custom": "kept" } }, sonnet],
    ["metadata + maxTokens", { maxTokens: 777, metadata: { user_id: "user-fixture" } } as SimpleStreamOptions, sonnet],
  ];
  for (const [name, options, model] of cases) {
    const unwrapped = await run(native, basicContext(), { ...options, apiKey: OAUTH_TOKEN }, undefined, model);
    const wrapped = await run(wrapper(), basicContext(), { ...options, apiKey: OAUTH_TOKEN }, undefined, model);
    assert.deepEqual(wire(wrapped.requests), wire(unwrapped.requests), name);
    assert.deepEqual(stable(wrapped.result), stable(unwrapped.result), name);
    assert.equal(wrapped.requests[0]?.redirect, "manual", `${name}: OAuth requests do not follow redirects`);
  }
});

test("delegation parity: caller onPayload runs once, replacements are honored, and hooks and fetch are preserved", async () => {
  const counts = { native: 0, wrapped: 0, responses: [] as number[] };
  const options = (key: "native" | "wrapped"): SimpleStreamOptions => ({
    apiKey: OAUTH_TOKEN,
    onPayload: (payload) => {
      counts[key] += 1;
      return { ...(payload as object), metadata: { user_id: "replaced-by-hook" } };
    },
    onResponse: (response) => {
      counts.responses.push(response.status);
    },
  });
  const unwrapped = await run(native, basicContext(), options("native"));
  const wrapped = await run(wrapper(), basicContext(), options("wrapped"));
  assert.equal(counts.native, 1);
  assert.equal(counts.wrapped, 1);
  assert.deepEqual(counts.responses, [200, 200]);
  assert.deepEqual(wrapped.requests[0]?.body.metadata, { user_id: "replaced-by-hook" });
  assert.deepEqual(wire(wrapped.requests), wire(unwrapped.requests));
  assert.equal(wrapped.requests.length, 1, "the caller's fetch carries the request");
});

test("delegation parity: retry options keep Pi's retry behavior", async () => {
  const flaky: Responder = (_request, index) => index === 0
    ? new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529, headers: { "retry-after-ms": "1" } })
    : sseResponse(replies.text());
  for (const maxRetries of [0, 1]) {
    const unwrapped = await run(native, basicContext(), { apiKey: OAUTH_TOKEN, maxRetries }, flaky);
    const wrapped = await run(wrapper(), basicContext(), { apiKey: OAUTH_TOKEN, maxRetries }, flaky);
    assert.equal(wrapped.requests.length, unwrapped.requests.length);
    assert.equal(wrapped.requests.length, maxRetries + 1);
    assert.deepEqual(stable(wrapped.result), stable(unwrapped.result));
  }
});

test("stream contract: events, result and errors match Pi for each reply shape, with no retry after partial output", async () => {
  const shapes: Array<[string, () => Response]> = [
    ["text", () => sseResponse(replies.text())],
    ["thinking", () => sseResponse(replies.thinking())],
    ["parallel tool calls", () => sseResponse(replies.parallelTools())],
    ["mid-stream error", () => sseResponse(replies.streamError())],
    ["truncated EOF inside a tool call", () => sseResponse(replies.truncated())],
  ];
  for (const [name, respond] of shapes) {
    const unwrapped = await run(native, basicContext(), { apiKey: OAUTH_TOKEN, reasoning: "high", maxRetries: 3 }, respond);
    const wrapped = await run(wrapper(), basicContext(), { apiKey: OAUTH_TOKEN, reasoning: "high", maxRetries: 3 }, respond);
    assert.deepEqual(wrapped.events, unwrapped.events, name);
    assert.deepEqual(stable(wrapped.result), stable(unwrapped.result), name);
    assert.equal(wrapped.requests.length, 1, `${name}: exactly one request`);
  }

  const tools = await run(wrapper(), basicContext(), { apiKey: OAUTH_TOKEN }, () => sseResponse(replies.parallelTools()));
  assert.equal(tools.result.stopReason, "toolUse");
  assert.deepEqual(
    tools.result.content.map((block) => block.type === "toolCall" ? [block.id, block.arguments] : block.type),
    [["toolu_a", { path: "a.txt" }], ["toolu_b", { command: "printf 'x y'" }]],
  );
  // Reproducer E: a body cut inside a tool call. Pi ends the turn as an error, so the agent loop
  // neither runs the call nor replays the message. Pi does keep the repaired partial call in the
  // errored message (upstream observation, see docs/upstream-gaps.md); the wrapper adds no repair.
  const truncated = await run(wrapper(), basicContext(), { apiKey: OAUTH_TOKEN }, () => sseResponse(replies.truncated()));
  assert.equal(truncated.result.stopReason, "error", "a truncated tool call is never a completed turn");
  assert.equal(truncated.result.errorMessage, "Anthropic stream ended before message_stop");
});

test("stream contract: abort mid-stream ends the stream as aborted, like Pi", async () => {
  const hanging = (controller: AbortController): Responder => () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode(
          "event: message_start\ndata: " + JSON.stringify({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } }) + "\n\n",
        ));
        controller.signal.addEventListener("abort", () => stream.error(new DOMException("aborted", "AbortError")), { once: true });
      },
    });
    setTimeout(() => controller.abort(), 20);
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const results: AssistantMessage[] = [];
  for (const transport of [native, wrapper()]) {
    const controller = new AbortController();
    const { result } = await run(transport, basicContext(), { apiKey: OAUTH_TOKEN, signal: controller.signal }, hanging(controller));
    results.push(result);
  }
  assert.equal(results[0]?.stopReason, "aborted");
  assert.deepEqual(stable(results[1]!), stable(results[0]!));
});

test("content fidelity: review reproducers reach the wire exactly as Pi sends them, without mutating caller objects", async () => {
  const context = reviewContext();
  const before = structuredClone(context);
  const options: SimpleStreamOptions = { apiKey: OAUTH_TOKEN, reasoning: "high" };
  const unwrapped = await run(native, context, options);
  const wrapped = await run(wrapper(), context, options);
  assert.deepEqual(context, before, "caller context is not mutated");
  assert.deepEqual(wire(wrapped.requests), wire(unwrapped.requests));

  const body = wrapped.requests[0]!.body;
  const json = JSON.stringify(body.messages);
  // A: valid supplementary-plane text is not replaced with U+FFFD.
  assert.equal(body.messages[0].content, "A 😀 𐐷 Z");
  assert.ok(!json.includes("\uFFFD"));
  // B: the completed tool exchange survives the system patch between call and result;
  // Pi folds the patch into the system blocks because this model has no mid-conversation system messages.
  assert.deepEqual(body.messages.map((message: { role: string }) => message.role), ["user", "assistant", "user", "user"]);
  assert.match(JSON.stringify(body.system), /Effort changed: be brief\./);
  const blocks = body.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content) ? message.content : []);
  assert.ok(blocks.some((block: any) => block.type === "tool_use" && block.id === "t1" && block.input.path === "notes 😀.txt"));
  assert.ok(blocks.some((block: any) => block.type === "tool_result" && block.tool_use_id === "t1"));
  // Signed and redacted thinking replay byte-for-byte for the same model.
  assert.ok(blocks.some((block: any) => block.type === "thinking" && block.signature === "sig_same_model_1"));
  assert.ok(blocks.some((block: any) => block.type === "redacted_thinking" && block.data === "redacted_payload_1"));
  // Full tool schemas, including nested anyOf/enum/additionalProperties.
  const schema = (name: string) => body.tools.find((tool: any) => tool.name.toLowerCase() === name).input_schema;
  assert.deepEqual(schema("read").properties, (readTool.parameters as any).properties);
  assert.deepEqual(schema("bash").properties, (bashTool.parameters as any).properties);
});

function cacheAnchors(body: Record<string, any>): Array<Record<string, unknown>> {
  const anchors: Array<Record<string, unknown>> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "cache_control") anchors.push(child as Record<string, unknown>);
        else visit(child);
      }
    }
  };
  visit(body);
  return anchors;
}

test("caching: first and repeat turns keep Pi's anchors and retention policy, including native tool changes", async () => {
  const first = basicContext();
  const assistantTurn = (await run(native, first, { apiKey: OAUTH_TOKEN })).result;
  const repeat: Context = {
    ...first,
    messages: [
      ...first.messages,
      assistantTurn,
      { role: "system", content: "", toolsAdded: [{ name: "grep", description: "Search", parameters: { type: "object", properties: {} } as any }], timestamp: 3 } as any,
      { role: "user", content: "Again", timestamp: 4 },
    ],
  };
  for (const cacheRetention of ["none", "short", "long"] as const) {
    for (const context of [first, repeat]) {
      const unwrapped = await run(native, context, { apiKey: OAUTH_TOKEN, cacheRetention });
      const wrapped = await run(wrapper(), context, { apiKey: OAUTH_TOKEN, cacheRetention });
      assert.deepEqual(wire(wrapped.requests), wire(unwrapped.requests), cacheRetention);
      const anchors = cacheAnchors(wrapped.requests[0]!.body);
      if (cacheRetention === "none") assert.equal(anchors.length, 0);
      else assert.ok(anchors.length > 0 && anchors.every((anchor) => anchor.type === "ephemeral"));
      if (cacheRetention === "long") assert.ok(anchors.every((anchor) => anchor.ttl === "1h"));
      if (cacheRetention === "short") assert.ok(anchors.every((anchor) => anchor.ttl === undefined));
    }
  }

  const diagnostics = new Diagnostics();
  await run(wrapper(diagnostics), first, { apiKey: OAUTH_TOKEN });
  assert.deepEqual(diagnostics.last?.usage, { input: 11, output: 5, cacheRead: 7, cacheWrite: 3 });
  assert.equal(diagnostics.last?.requestId, "req_fixture_1");
  assert.equal(diagnostics.last?.status, 200);
});

test("API-key traffic passes through untouched: same options object, custom endpoints allowed, nothing recorded", async () => {
  const diagnostics = new Diagnostics();
  let seen: SimpleStreamOptions | undefined;
  const spy: AnthropicStreamSimple = (model, context, options) => {
    seen = options;
    return native(model, context, options);
  };
  const options: SimpleStreamOptions = { apiKey: API_KEY, fetch: captureFetch().fetch };
  await (createOAuthGatedStreamSimple(spy, diagnostics)(sonnet, compat.normalizeContext(basicContext()), options)).result();
  assert.equal(seen, options);
  assert.equal(diagnostics.last, undefined);

  const custom = { ...sonnet, baseUrl: "https://llm-gateway.example.test/anthropic" };
  const unwrapped = await run(native, basicContext(), { apiKey: API_KEY }, undefined, custom);
  const wrapped = await run(wrapper(), basicContext(), { apiKey: API_KEY }, undefined, custom);
  assert.deepEqual(wire(wrapped.requests), wire(unwrapped.requests));
  assert.match(wrapped.requests[0]!.url, /^https:\/\/llm-gateway\.example\.test\//);
  assert.equal(wrapped.requests[0]!.headers.get("x-api-key"), API_KEY);
  assert.equal(wrapped.result.stopReason, "stop");
});

test("security: OAuth requests to another destination or with conflicting auth are blocked before sending", async () => {
  const cases: Array<[string, Model<Api>, SimpleStreamOptions, string]> = [
    ["custom endpoint", { ...sonnet, baseUrl: "https://proxy.example.test" }, {}, "destination"],
    ["credentials in URL", { ...sonnet, baseUrl: "https://user:pass@api.anthropic.com" }, {}, "destination"],
    ["plain http", { ...sonnet, baseUrl: "http://api.anthropic.com" }, {}, "destination"],
    ["x-api-key alongside OAuth", sonnet, { headers: { "x-api-key": API_KEY } }, "wire_auth"],
    ["different Authorization", sonnet, { headers: { authorization: "Bearer someone-else" } }, "wire_auth"],
  ];
  for (const [name, model, options, reason] of cases) {
    const diagnostics = new Diagnostics();
    const result = await run(wrapper(diagnostics), reviewContext(), { ...options, apiKey: OAUTH_TOKEN, maxRetries: 3 }, undefined, model);
    assert.equal(result.requests.length, 0, `${name}: nothing reaches the network`);
    assert.equal(result.result.stopReason, "error", name);
    assert.match(result.result.errorMessage ?? "", /pi-claude-subscription blocked/, name);
    for (const secret of [OAUTH_TOKEN, API_KEY, "A 😀 𐐷 Z", "notes 😀.txt", "pass"]) {
      assert.ok(!(result.result.errorMessage ?? "").includes(secret), `${name}: error does not expose ${secret}`);
    }
    assert.equal(diagnostics.last?.blocked, reason, name);
  }
});

test("security: redirects are not followed", async () => {
  const diagnostics = new Diagnostics();
  const redirect: Responder = () => new Response(null, { status: 307, headers: { location: "https://evil.example.test/v1/messages" } });
  const result = await run(wrapper(diagnostics), basicContext(), { apiKey: OAUTH_TOKEN, maxRetries: 3 }, redirect);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.redirect, "manual");
  assert.match(result.result.errorMessage ?? "", /redirect \(HTTP 307\)/);
  assert.equal(diagnostics.last?.blocked, "redirect");
});

test("security: echoed secrets in Anthropic error bodies are redacted while status and request id stay", async () => {
  const echo: Responder = () => new Response(
    JSON.stringify({ type: "error", error: { type: "authentication_error", message: `bad token ${OAUTH_TOKEN} (Authorization: Bearer ${OAUTH_TOKEN})` } }),
    { status: 401, headers: { "content-type": "application/json", "request-id": "req_011CXfixture" } },
  );
  const unwrapped = await run(native, basicContext(), { apiKey: OAUTH_TOKEN }, echo);
  assert.ok(unwrapped.result.errorMessage?.includes(OAUTH_TOKEN), "reproducer: Pi alone surfaces the echoed token");

  const diagnostics = new Diagnostics();
  const wrapped = await run(wrapper(diagnostics), basicContext(), { apiKey: OAUTH_TOKEN }, echo);
  assert.ok(!wrapped.result.errorMessage?.includes(OAUTH_TOKEN));
  assert.match(wrapped.result.errorMessage ?? "", /^401 .*authentication_error/);
  assert.equal(wrapped.requests.length, 1, "no retry or credential fallback after 401");
  assert.equal(diagnostics.last?.status, 401);
  assert.equal(diagnostics.last?.requestId, "req_011CXfixture");
  assert.equal(diagnostics.last?.errorType, "authentication_error");
});

test("security: network errors with nested causes are recorded redacted", async () => {
  const diagnostics = new Diagnostics();
  const failing = (async () => {
    const cause = Object.assign(new Error(`socket reset while sending Bearer ${OAUTH_TOKEN}`), { code: "ECONNRESET" });
    throw new TypeError("fetch failed", { cause });
  }) as typeof fetch;
  const result = await run(wrapper(diagnostics), basicContext(), { apiKey: OAUTH_TOKEN, fetch: failing });
  assert.equal(result.result.stopReason, "error");
  assert.match(diagnostics.last?.networkError ?? "", /fetch failed; cause: ECONNRESET: socket reset/);
  assert.ok(!diagnostics.last?.networkError?.includes(OAUTH_TOKEN));
  assert.ok(!(result.result.errorMessage ?? "").includes(OAUTH_TOKEN));
});

test("redaction covers header shapes, token shapes, known secrets and nested causes but keeps ids", () => {
  const secret = "opaque-secret-value";
  const text = redactSensitiveText(
    `Authorization: Bearer ${OAUTH_TOKEN} x-api-key: ${API_KEY} "x-api-key":"${API_KEY}" raw ${OAUTH_TOKEN} known ${secret} request_id=req_011CXabc status=401`,
    [secret],
  );
  for (const leaked of [OAUTH_TOKEN, API_KEY, secret]) assert.ok(!text.includes(leaked), leaked);
  assert.match(text, /request_id=req_011CXabc status=401/);

  const nested = new Error("outer", { cause: new Error(`middle ${secret}`, { cause: `inner ${OAUTH_TOKEN}` }) });
  assert.equal(describeError(nested, [secret]), "outer; cause: middle [REDACTED]; cause: inner [REDACTED]");
});
