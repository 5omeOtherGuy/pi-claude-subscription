import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";

import { type Diagnostics, type RequestRecorder, redactSensitiveText } from "./diagnostics.ts";

/** Pi's provider `streamSimple` signature. */
export type AnthropicStreamSimple = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

type FetchFunction = NonNullable<SimpleStreamOptions["fetch"]>;

/** The marker Pi's Anthropic transport itself uses to pick its OAuth client. */
const OAUTH_TOKEN_MARKER = "sk-ant-oat";
const ANTHROPIC_ORIGIN = "https://api.anthropic.com";
const MESSAGES_PATH = "/v1/messages";

/**
 * Reads Pi's Anthropic transport from a pi-ai namespace through the public
 * `anthropicMessagesApi()` factory, never from the shared api registry, so
 * the delegate cannot be another extension's override or this wrapper itself.
 */
export function pickHostAnthropicStreamSimple(namespace: Record<string, unknown>): AnthropicStreamSimple {
  const factory = namespace.anthropicMessagesApi;
  const streamSimple = typeof factory === "function"
    ? (factory as () => { streamSimple?: unknown })().streamSimple
    : undefined;
  if (typeof streamSimple !== "function") {
    throw new Error(
      "pi-claude-subscription: @earendil-works/pi-ai/compat exports no anthropicMessagesApi().streamSimple; this Pi version is unsupported.",
    );
  }
  return streamSimple as AnthropicStreamSimple;
}

/**
 * Resolves the host's transport. Pi's extension loader maps this specifier
 * to the pi-ai copy Pi itself runs, not one installed next to the extension.
 */
export async function resolveHostAnthropicStreamSimple(): Promise<AnthropicStreamSimple> {
  return pickHostAnthropicStreamSimple(await import("@earendil-works/pi-ai/compat") as Record<string, unknown>);
}

export function isAnthropicOAuthToken(apiKey: unknown): apiKey is string {
  return typeof apiKey === "string" && apiKey.includes(OAUTH_TOKEN_MARKER);
}

/**
 * Pi's transport returns HTTP errors to its caller as `errorMessage` text and
 * does not retry 4xx responses marked `x-should-retry: false`. A local block
 * therefore surfaces with its reason instead of a generic connection error.
 */
function blockedResponse(reason: string): Response {
  const message = `pi-claude-subscription blocked this Anthropic OAuth request: ${reason}`;
  return new Response(JSON.stringify({ type: "error", error: { type: "pi_claude_subscription_blocked", message } }), {
    status: 400,
    headers: { "content-type": "application/json", "x-should-retry": "false" },
  });
}

function requestHeaders(input: Parameters<FetchFunction>[0], init: Parameters<FetchFunction>[1]): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
  return headers;
}

function destinationProblem(url: URL): string | undefined {
  if (url.origin === ANTHROPIC_ORIGIN && !url.username && !url.password && url.pathname === MESSAGES_PATH) return undefined;
  return `the OAuth token is only sent to ${ANTHROPIC_ORIGIN}${MESSAGES_PATH}, not ${url.origin}${url.pathname}. Nothing was sent. Use an API key for custom Anthropic endpoints.`;
}

function wireAuthProblem(headers: Headers, token: string): string | undefined {
  if (headers.get("authorization") === `Bearer ${token}` && !headers.has("x-api-key")) return undefined;
  return "the request carried conflicting authentication headers (x-api-key or a different Authorization value). Nothing was sent.";
}

async function redactedErrorResponse(response: Response, secrets: readonly string[]): Promise<Response> {
  const text = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(redactSensitiveText(text, secrets), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Composes the caller's fetch (or the global fetch at call time) with the
 * OAuth boundary: official endpoint only, exactly one Bearer credential,
 * no redirects, and redacted error bodies.
 */
function createOAuthFetch(callerFetch: FetchFunction | undefined, token: string, record: RequestRecorder): FetchFunction {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const destination = destinationProblem(url);
    if (destination) {
      record.blocked("destination");
      return blockedResponse(destination);
    }
    const auth = wireAuthProblem(requestHeaders(input, init), token);
    if (auth) {
      record.blocked("wire_auth");
      return blockedResponse(auth);
    }

    let response: Response;
    try {
      response = await (callerFetch ?? globalThis.fetch)(input, { ...init, redirect: "manual" });
    } catch (error) {
      record.failed(error);
      throw error;
    }
    if ((response.status >= 300 && response.status < 400) || response.type === "opaqueredirect" || response.redirected) {
      await response.body?.cancel().catch(() => {});
      record.blocked("redirect");
      return blockedResponse(`Anthropic answered with a redirect (HTTP ${response.status}); it was not followed.`);
    }
    record.response(response.status, response.headers);
    return response.ok ? response : redactedErrorResponse(response, [token]);
  };
}

/**
 * Wraps Pi's Anthropic transport. API-key, header-auth, and federation
 * requests are passed through untouched; OAuth requests get the fetch
 * boundary above. Payload, hooks, retries, and the returned stream are Pi's.
 */
export function createOAuthGatedStreamSimple(delegate: AnthropicStreamSimple, diagnostics: Diagnostics): AnthropicStreamSimple {
  return (model, context, options) => {
    const token = options?.apiKey;
    if (!isAnthropicOAuthToken(token)) return delegate(model, context, options);

    const record = diagnostics.begin(model, [token]);
    const stream = delegate(model, context, { ...options, fetch: createOAuthFetch(options?.fetch, token, record) });
    void stream.result().then(record.finish);
    return stream;
  };
}
