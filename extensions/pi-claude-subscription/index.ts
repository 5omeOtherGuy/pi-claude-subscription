import { readFileSync } from "node:fs";

import { type ExtensionAPI, VERSION } from "@earendil-works/pi-coding-agent";

import { Diagnostics, formatStatus } from "../../src/diagnostics.ts";
import { createOAuthGatedStreamSimple, resolveHostAnthropicStreamSimple } from "../../src/transport.ts";

const PROVIDER_ID = "anthropic";
const LEGACY_PROVIDER_ID = "claude-subscription";

function extensionVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Where a saved `claude-subscription` selection still lives, without changing it. */
function legacySelections(
  settings: { defaultProvider?: string; enabledModels?: string[] },
  branch: ReadonlyArray<{ type: string; provider?: string }>,
): string[] {
  const found: string[] = [];
  if (settings.defaultProvider === LEGACY_PROVIDER_ID) found.push("settings defaultProvider");
  if (settings.enabledModels?.some((pattern) => pattern.startsWith(`${LEGACY_PROVIDER_ID}/`))) found.push("settings enabledModels");
  if (branch.some((entry) => entry.type === "model_change" && entry.provider === LEGACY_PROVIDER_ID)) found.push("this session");
  return found;
}

function migrationNotice(places: string[]): string {
  return [
    `pi-claude-subscription no longer registers the '${LEGACY_PROVIDER_ID}' provider (found in: ${places.join(", ")}).`,
    "Run /login anthropic and choose Claude Pro/Max, then pick an anthropic/<model> with /model.",
    "Saved selections, models, and credentials were not changed; old Claude Code credential files are left untouched.",
  ].join(" ");
}

export default async function claudeSubscriptionExtension(pi: ExtensionAPI): Promise<void> {
  // Resolve before registering so no Anthropic request can run without the wrapper.
  const delegate = await resolveHostAnthropicStreamSimple();
  const diagnostics = new Diagnostics();
  const streamSimple = createOAuthGatedStreamSimple(delegate, diagnostics);

  // Only the transport is replaced. Login, refresh, credential storage, the
  // model catalog, and API-key auth stay Pi's built-in anthropic provider.
  pi.registerProvider(PROVIDER_ID, { api: "anthropic-messages", streamSimple });

  pi.on("session_start", (_event, ctx) => {
    const places = legacySelections(pi.getSettings(), ctx.sessionManager.getBranch());
    if (places.length > 0) ctx.ui.notify(migrationNotice(places), "warning");
    if (ctx.modelRegistry.getRegisteredProviderConfig(PROVIDER_ID)?.streamSimple !== streamSimple) {
      ctx.ui.notify(
        "pi-claude-subscription: another extension replaced the anthropic transport; this extension's OAuth checks are not active. Load only one Anthropic transport extension.",
        "warning",
      );
    }
  });

  pi.registerCommand("claude-subscription-status", {
    description: "Show pi-claude-subscription route, auth kind, and the last OAuth request's status, request id, and cache usage",
    handler: async (_args, ctx) => {
      const registered = ctx.modelRegistry.getRegisteredProviderConfig(PROVIDER_ID);
      const wrapperActive = registered?.streamSimple === streamSimple;
      const anthropicModel = ctx.model?.provider === PROVIDER_ID
        ? ctx.model
        : ctx.modelRegistry.getAll().find((model) => model.provider === PROVIDER_ID);
      const message = formatStatus({
        extensionVersion: extensionVersion(),
        hostVersion: VERSION,
        wrapperActive,
        oauthOverridden: registered?.oauth !== undefined,
        authStatus: ctx.modelRegistry.getProviderAuthStatus(PROVIDER_ID),
        usingOAuth: anthropicModel ? ctx.modelRegistry.isUsingOAuth(anthropicModel) : false,
        currentModel: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
        last: diagnostics.last,
      });
      ctx.ui.notify(message, wrapperActive ? "info" : "warning");
    },
  });
}
