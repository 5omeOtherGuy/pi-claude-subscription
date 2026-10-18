import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";

const AUTHORIZATION_HEADER_VALUE = /Authorization\s*:\s*Bearer\s+[^\s,;"]+/gi;
const BEARER_TOKEN_VALUE = /Bearer\s+[^\s,;"]+/gi;
const API_KEY_HEADER_VALUE = /(x-api-key|anthropic-api-key)("?\s*:\s*"?)[^\s,;"]+/gi;
const ANTHROPIC_TOKEN_VALUE = /sk-ant-[A-Za-z0-9_-]{4,}/g;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Redacts credential material from text before this extension surfaces or
 * forwards it: header-shaped secrets, Anthropic token shapes, and the exact
 * secrets of the current request. Upstream text is untrusted and may echo
 * token material outside header syntax.
 */
export function redactSensitiveText(text: string, knownSecrets: readonly string[] = []): string {
  let redacted = text;
  for (const secret of knownSecrets) {
    if (secret.trim().length === 0) continue;
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]");
  }
  return redacted
    .replace(AUTHORIZATION_HEADER_VALUE, "Authorization: Bearer [REDACTED]")
    .replace(BEARER_TOKEN_VALUE, "Bearer [REDACTED]")
    .replace(API_KEY_HEADER_VALUE, (_match, name: string, separator: string) => `${name}${separator}[REDACTED]`)
    .replace(ANTHROPIC_TOKEN_VALUE, "[REDACTED]");
}

/** One redacted line for an error and up to three nested causes. */
export function describeError(error: unknown, knownSecrets: readonly string[] = []): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      parts.push([typeof code === "string" ? code : undefined, current.message].filter(Boolean).join(": "));
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return redactSensitiveText(parts.filter((part) => part.length > 0).join("; cause: "), knownSecrets);
}

/** Extracts Anthropic's `error.type`, a fixed vocabulary, from an error message. */
export function anthropicErrorType(message: string | undefined): string | undefined {
  const match = message ? /"error"\s*:\s*\{[^{}]*"type"\s*:\s*"([A-Za-z0-9_]+)"/.exec(message) : null;
  return match?.[1];
}

export type RequestRecord = {
  startedAt: number;
  provider: string;
  model: string;
  status?: number;
  requestId?: string;
  blocked?: string;
  networkError?: string;
  stopReason?: string;
  errorType?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type RequestRecorder = {
  response(status: number, headers: Headers): void;
  blocked(reason: string): void;
  failed(error: unknown): void;
  finish(message: AssistantMessage): void;
};

/**
 * In-memory, metadata-only record of the latest OAuth request this wrapper
 * handled: no prompt, tool, payload, or credential content is kept.
 */
export class Diagnostics {
  last: RequestRecord | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  begin(model: Model<Api>, knownSecrets: readonly string[]): RequestRecorder {
    const record: RequestRecord = { startedAt: this.now(), provider: model.provider, model: model.id };
    this.last = record;
    return {
      response: (status, headers) => {
        record.status = status;
        const requestId = headers.get("request-id") ?? headers.get("anthropic-request-id");
        if (requestId) record.requestId = redactSensitiveText(requestId, knownSecrets).slice(0, 120);
      },
      blocked: (reason) => {
        record.blocked = reason;
      },
      failed: (error) => {
        record.networkError = describeError(error, knownSecrets).slice(0, 300);
      },
      finish: (message) => {
        record.stopReason = message.stopReason;
        record.errorType = anthropicErrorType(message.errorMessage);
        const { input, output, cacheRead, cacheWrite } = message.usage;
        record.usage = { input, output, cacheRead, cacheWrite };
      },
    };
  }
}

export type StatusInput = {
  extensionVersion: string;
  hostVersion: string;
  wrapperActive: boolean;
  oauthOverridden: boolean;
  authStatus: { configured: boolean; source?: string; label?: string };
  usingOAuth: boolean;
  currentModel?: { provider: string; id: string };
  last?: RequestRecord;
};

export function formatStatus(input: StatusInput): string {
  const lines = [
    `pi-claude-subscription ${input.extensionVersion} on Pi ${input.hostVersion}`,
    input.wrapperActive
      ? "route: provider anthropic (anthropic-messages) -> OAuth gate -> Pi's own Anthropic transport"
      : "route: NOT COVERED - another extension replaced the anthropic transport after this one; its requests bypass this wrapper",
    input.oauthOverridden
      ? "login: an extension overrides anthropic OAuth; /login anthropic is not Pi's built-in flow"
      : "login: Pi built-in (/login anthropic)",
    `anthropic auth: ${input.authStatus.configured ? `${input.usingOAuth ? "OAuth" : "API key or other"} (${input.authStatus.label ?? input.authStatus.source ?? "configured"})` : "not configured"}`,
    `current model: ${input.currentModel ? `${input.currentModel.provider}/${input.currentModel.id}` : "none"}`,
    "not covered: direct compat.streamSimple callers (they bypass registered providers)",
  ];
  const last = input.last;
  if (!last) {
    lines.push("last OAuth request: none in this session");
  } else {
    const parts = [
      new Date(last.startedAt).toISOString(),
      `model=${last.provider}/${last.model}`,
      last.status !== undefined ? `status=${last.status}` : undefined,
      last.requestId ? `request_id=${last.requestId}` : undefined,
      last.stopReason ? `stop=${last.stopReason}` : undefined,
      last.errorType ? `anthropic_error=${last.errorType}` : undefined,
      last.blocked ? `blocked=${last.blocked}` : undefined,
      last.networkError ? `network_error=${last.networkError}` : undefined,
      last.usage
        ? `usage input=${last.usage.input} output=${last.usage.output} cache_read=${last.usage.cacheRead} cache_write=${last.usage.cacheWrite}`
        : undefined,
    ].filter((part): part is string => part !== undefined);
    lines.push(`last OAuth request: ${parts.join(" ")}`);
  }
  return lines.join("\n");
}
