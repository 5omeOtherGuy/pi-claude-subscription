import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { loadActiveClaudeCodeCredentials } from "./credential-accounts.ts";
import { buildNativeHeaders } from "./native-headers.ts";
import {
  type AnthropicCompat,
  CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
  type ClaudeModelConfig,
  MODELS,
} from "./models.ts";
import { isRecord } from "./type-guards.ts";

export const CLAUDE_MODELS_URL = "https://api.anthropic.com/v1/models";
const TIMEOUT_MS = 5_000;
const MAX_PAGES = 10;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type LoadToken = () => Promise<string>;

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function supported(value: unknown): boolean {
  return isRecord(value) && value.supported === true;
}

function mapModel(raw: unknown): ClaudeModelConfig | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id.startsWith("claude-") ||
    typeof raw.display_name !== "string" || !raw.display_name.trim() || raw.lifecycle === "retired") return;
  const known = MODELS.find((model) => model.id === raw.id);
  const contextWindow = positiveInteger(raw.max_input_tokens) ?? known?.contextWindow;
  const maxTokens = positiveInteger(raw.max_tokens) ?? known?.maxTokens;
  if (!contextWindow || !maxTokens) return;
  const capabilities = isRecord(raw.capabilities) ? raw.capabilities : undefined;
  if (!known && !capabilities) return;
  const thinking = capabilities && isRecord(capabilities.thinking) ? capabilities.thinking : undefined;
  const types = thinking && isRecord(thinking.types) ? thinking.types : undefined;
  const adaptive = supported(types?.adaptive);
  // Native request handling for new models is known only for adaptive thinking.
  if (!known && !adaptive) return;
  const effort = capabilities && isRecord(capabilities.effort) ? capabilities.effort : undefined;
  if (!known && !effort) return;
  const supportedEffort = (level: string) => supported(effort?.[level]);
  const adaptiveMap = adaptive ? {
    ...(!supported(types?.disabled) ? { off: null } : {}),
    minimal: supportedEffort("low") ? "low" : null,
    low: supportedEffort("low") ? "low" : null,
    medium: supportedEffort("medium") ? "medium" : null,
    high: supportedEffort("high") ? "high" : null,
    xhigh: supportedEffort("xhigh") ? "xhigh" : null,
    max: supportedEffort("max") ? "max" : null,
  } as const : undefined;
  if (!known && adaptiveMap?.high !== "high") return;
  const reasoning = known?.reasoning ?? true;
  const thinkingLevelMap = known?.thinkingLevelMap ?? adaptiveMap;
  return {
    id: raw.id,
    api: CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
    name: `${raw.display_name} (Claude Code subscription)`,
    reasoning,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    // Known models keep their tested request settings, whatever else the API offers.
    ...(known ? (known.compat ? { compat: known.compat } : {}) : { compat: { forceAdaptiveThinking: true } }),
    input: capabilities && capabilities.image_input !== undefined
      ? (supported(capabilities.image_input) ? ["text", "image"] : ["text"])
      : known ? [...known.input] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(maxTokens, contextWindow),
  };
}

function buildCatalog(entries: readonly unknown[]): ClaudeModelConfig[] {
  const models: ClaudeModelConfig[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const mapped = mapModel(entry);
    if (mapped && !ids.has(mapped.id)) { models.push(mapped); ids.add(mapped.id); }
  }
  if (models.length === 0) return [...MODELS];
  // Keep local names for models the API lists under another id: selection aliases
  // and undated names such as claude-haiku-4-5 for claude-haiku-4-5-20251001.
  const advertisedIds = entries.flatMap((entry) => (isRecord(entry) && typeof entry.id === "string" ? [entry.id] : []));
  for (const local of MODELS) {
    if (ids.has(local.id)) continue;
    const nativeId = (local.compat as AnthropicCompat | undefined)?.nativeModelId;
    const isDatedName = (id: string) => id.startsWith(`${local.id}-`) && /^\d{8}$/.test(id.slice(local.id.length + 1));
    if ((nativeId && ids.has(nativeId)) || advertisedIds.some(isDatedName)) models.push(local);
  }
  return models;
}

async function fetchCatalogEntries(fetchImpl: FetchLike, loadToken: LoadToken, parent: AbortSignal): Promise<unknown[] | undefined> {
  try {
    const token = await loadToken();
    const signal = AbortSignal.any([parent, AbortSignal.timeout(TIMEOUT_MS)]);
    const entries: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(CLAUDE_MODELS_URL);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("after_id", cursor);
      const response = await fetchImpl(url.href, { headers: buildNativeHeaders(token), signal });
      if (!response.ok) return undefined;
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.data) || typeof payload.has_more !== "boolean") return undefined;
      entries.push(...payload.data);
      if (!payload.has_more) return entries;
      if (typeof payload.last_id !== "string" || !payload.last_id || payload.last_id === cursor) return undefined;
      cursor = payload.last_id;
    }
  } catch {
    // Missing Claude Code login, OAuth denial, timeout, malformed JSON, or network failure.
  }
  return undefined;
}

async function readSavedEntries(path: string): Promise<unknown[] | undefined> {
  try {
    const saved: unknown = JSON.parse(await readFile(path, "utf8"));
    return isRecord(saved) && Array.isArray(saved.data) ? saved.data : undefined;
  } catch {
    return undefined;
  }
}

async function saveEntries(path: string, entries: readonly unknown[]): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ fetchedAt: new Date().toISOString(), data: entries }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  } catch {
    // The saved list only speeds up later runs, so a failed write must not fail the refresh.
  }
}

export function getDefaultModelCatalogPath(): string {
  return join(getAgentDir(), "pi-claude-subscription", "model-catalog.json");
}

// Pi also refreshes offline, and each result replaces the live list. Returning the
// last good list here keeps API models across those refreshes and across restarts.
export function createClaudeModelCatalog(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  loadToken: LoadToken = loadActiveClaudeCodeCredentials,
  catalogPath?: string,
) {
  const lastGoodList = async (): Promise<ClaudeModelConfig[]> => {
    const saved = await readSavedEntries(catalogPath ?? getDefaultModelCatalogPath());
    return saved ? buildCatalog(saved) : [...MODELS];
  };
  return async (context: RefreshModelsContext): Promise<ClaudeModelConfig[]> => {
    if (!context.allowNetwork || context.signal.aborted) return lastGoodList();
    const entries = await fetchCatalogEntries(fetchImpl, loadToken, context.signal);
    if (!entries?.some((entry) => mapModel(entry) !== undefined)) return lastGoodList();
    await saveEntries(catalogPath ?? getDefaultModelCatalogPath(), entries);
    return buildCatalog(entries);
  };
}

export const refreshClaudeModels = createClaudeModelCatalog();
