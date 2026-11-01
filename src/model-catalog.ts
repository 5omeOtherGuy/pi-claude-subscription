import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  // The API decides whether a known model exists. Its tested settings and limits stay as shipped.
  const known = MODELS.find((model) => model.id === raw.id);
  if (known) return known;
  const contextWindow = positiveInteger(raw.max_input_tokens);
  const maxTokens = positiveInteger(raw.max_tokens);
  if (!contextWindow || !maxTokens) return;
  const capabilities = isRecord(raw.capabilities) ? raw.capabilities : undefined;
  if (!capabilities) return;
  const thinking = isRecord(capabilities.thinking) ? capabilities.thinking : undefined;
  const types = thinking && isRecord(thinking.types) ? thinking.types : undefined;
  const adaptive = supported(types?.adaptive);
  // Native request handling for new models is known only for adaptive thinking.
  if (!adaptive) return;
  const effort = isRecord(capabilities.effort) ? capabilities.effort : undefined;
  if (!effort) return;
  const supportedEffort = (level: string) => supported(effort?.[level]);
  const thinkingLevelMap = {
    ...(!supported(types?.disabled) ? { off: null } : {}),
    minimal: supportedEffort("low") ? "low" : null,
    low: supportedEffort("low") ? "low" : null,
    medium: supportedEffort("medium") ? "medium" : null,
    high: supportedEffort("high") ? "high" : null,
    xhigh: supportedEffort("xhigh") ? "xhigh" : null,
    max: supportedEffort("max") ? "max" : null,
  } as const;
  if (thinkingLevelMap.high !== "high") return;
  return {
    id: raw.id,
    api: CLAUDE_SUBSCRIPTION_NATIVE_API_ID,
    name: `${raw.display_name} (Claude Code subscription)`,
    reasoning: true,
    thinkingLevelMap,
    compat: { forceAdaptiveThinking: true },
    input: supported(capabilities.image_input) ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(maxTokens, contextWindow),
  };
}

function buildCatalog(entries: readonly unknown[]): ClaudeModelConfig[] | undefined {
  const models: ClaudeModelConfig[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const mapped = mapModel(entry);
    if (mapped && !ids.has(mapped.id)) { models.push(mapped); ids.add(mapped.id); }
  }
  if (models.length === 0) return undefined;
  // Keep local names for models the API lists under another id: selection aliases
  // and undated names such as claude-haiku-4-5 for claude-haiku-4-5-20251001.
  const advertisedIds = entries.flatMap((entry) => (isRecord(entry) && typeof entry.id === "string" && entry.lifecycle !== "retired" ? [entry.id] : []));
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

type SavedCatalog = { entries: unknown[]; builtInIds: unknown[] };

async function readSavedCatalog(path: string): Promise<SavedCatalog | undefined> {
  try {
    const saved: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(saved) || !Array.isArray(saved.data)) return undefined;
    return { entries: saved.data, builtInIds: Array.isArray(saved.builtInIds) ? saved.builtInIds : [] };
  } catch {
    return undefined;
  }
}

// Only the fields that mapping reads reach the disk.
function savedEntry(entry: unknown): unknown {
  if (!isRecord(entry)) return entry;
  const { id, display_name, lifecycle, max_input_tokens, max_tokens, capabilities } = entry;
  return { id, display_name, lifecycle, max_input_tokens, max_tokens, capabilities };
}

async function saveEntries(path: string, entries: readonly unknown[]): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const saved = { fetchedAt: new Date().toISOString(), builtInIds: MODELS.map((model) => model.id), data: entries.map(savedEntry) };
    await writeFile(temporaryPath, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  } catch {
    // The saved list only keeps later runs current, so a failed write must not fail the refresh.
    await rm(temporaryPath, { force: true }).catch(() => {});
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
    const saved = await readSavedCatalog(catalogPath ?? getDefaultModelCatalogPath());
    if (!saved) return [...MODELS];
    // Built-in models from a newer package version than the saved list must still appear.
    const added = MODELS.filter((model) => !saved.builtInIds.includes(model.id));
    const list = buildCatalog(saved.entries);
    return list === undefined ? [...MODELS] : [...list, ...added.filter((model) => !list.some((entry) => entry.id === model.id))];
  };
  return async (context: RefreshModelsContext): Promise<ClaudeModelConfig[]> => {
    if (!context.allowNetwork || context.signal.aborted) return lastGoodList();
    const entries = await fetchCatalogEntries(fetchImpl, loadToken, context.signal);
    const list = entries && buildCatalog(entries);
    if (!entries || !list) return lastGoodList();
    await saveEntries(catalogPath ?? getDefaultModelCatalogPath(), entries);
    return list;
  };
}

export const refreshClaudeModels = createClaudeModelCatalog();
