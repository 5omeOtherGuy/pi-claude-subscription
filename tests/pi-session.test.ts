import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs, { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { API_KEY, OAUTH_TOKEN, replies, sseResponse } from "./helpers.ts";

// Loads the extension into real Pi sessions from the installed devDependency, the
// way `pi install` does. Only the network is stubbed (globalThis.fetch, test-only);
// no real credentials are read and nothing leaves the process.

const EXTENSION = fileURLToPath(new URL("../extensions/pi-claude-subscription/index.ts", import.meta.url));
const REFRESHED_TOKEN = ["sk", "ant", "oat01", "refreshed", "fixture"].join("-");

type WireRequest = { url: string; headers: Headers; body: Record<string, any>; redirect?: RequestRedirect };

/** Records any touch of legacy credential locations, including Keychain lookups. */
function guardLegacyCredentials(roots: string[]) {
  const touched: string[] = [];
  const restores: Array<() => void> = [];
  const toPath = (value: unknown) => typeof value === "string" ? value : value instanceof URL ? fileURLToPath(value) : undefined;
  const wrap = (target: Record<string, any>, name: string, check: (args: unknown[]) => string | undefined) => {
    const original = target[name];
    if (typeof original !== "function") return;
    target[name] = function (this: unknown, ...args: unknown[]) {
      const hit = check(args);
      if (hit) touched.push(`${name} ${hit}`);
      return original.apply(this, args);
    };
    restores.push(() => { target[name] = original; });
  };
  const pathCheck = (args: unknown[]) => {
    const path = toPath(args[0]);
    return path && roots.some((root) => resolve(path).startsWith(root)) ? path : undefined;
  };
  for (const name of ["readFileSync", "readFile", "openSync", "open", "existsSync", "statSync", "stat", "lstatSync", "accessSync", "access", "writeFileSync", "writeFile", "renameSync", "rename", "unlinkSync", "unlink", "rmSync", "copyFileSync", "readdirSync", "createReadStream", "createWriteStream", "watch", "watchFile"]) {
    wrap(fs as unknown as Record<string, any>, name, pathCheck);
  }
  for (const name of ["readFile", "open", "stat", "lstat", "access", "writeFile", "rename", "unlink", "rm", "copyFile", "readdir"]) {
    wrap(fs.promises as unknown as Record<string, any>, name, pathCheck);
  }
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
    wrap(childProcess as unknown as Record<string, any>, name, (args) => /\bsecurity\b/.test(String(args[0])) ? String(args[0]) : undefined);
  }
  syncBuiltinESMExports();
  return {
    touched,
    restore() {
      for (const restore of restores.reverse()) restore();
      syncBuiltinESMExports();
    },
  };
}

function snapshot(paths: string[]) {
  return paths.map((path) => ({ path, text: readFileSync(path, "utf8"), mtimeMs: statSync(path).mtimeMs }));
}

type SessionOptions = {
  auth?: Record<string, unknown>;
  env?: Record<string, string>;
  settings?: Record<string, unknown>;
  extensions?: string[];
  tokenResponse?: () => Response;
  reply?: (request: WireRequest, index: number) => Response;
};

async function startSession(t: TestContext, options: SessionOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-claude-subscription-session-"));
  const agentDir = join(root, "agent");
  const claudeDir = join(root, ".claude");
  const legacyState = join(agentDir, "pi-claude-subscription");
  const cwd = join(root, "work");
  for (const dir of [agentDir, claudeDir, legacyState, cwd]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, "hello.txt"), "session-file-contents\n");
  // Legacy credential files from the old provider: they must stay untouched.
  const legacyFiles = [join(claudeDir, ".credentials.json"), join(legacyState, "imported-credentials.json"), join(legacyState, "credential-state.json")];
  for (const file of legacyFiles) writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: "legacy-sentinel", refreshToken: "legacy-sentinel", expiresAt: 1 } }));
  const legacyBefore = snapshot(legacyFiles);
  if (options.auth) writeFileSync(join(agentDir, "auth.json"), JSON.stringify(options.auth));

  const env = { HOME: root, CLAUDE_CONFIG_DIR: claudeDir, PI_CODING_AGENT_DIR: agentDir, ANTHROPIC_API_KEY: "", ANTHROPIC_OAUTH_TOKEN: "", ANTHROPIC_AUTH_TOKEN: "", ...options.env };
  const savedEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  const guard = guardLegacyCredentials([claudeDir, legacyState]);
  let disposed: (() => void) | undefined;
  t.after(() => {
    disposed?.();
    guard.restore();
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  for (const [key, value] of Object.entries(env)) {
    if (value === "") delete process.env[key];
    else process.env[key] = value;
  }

  const requests: WireRequest[] = [];
  const tokenRequests: Array<Record<string, unknown>> = [];
  const otherRequests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://platform.claude.com/v1/oauth/token")) {
      tokenRequests.push(JSON.parse(String(init?.body)));
      return options.tokenResponse?.() ?? new Response("{}", { status: 500 });
    }
    if (!url.startsWith("https://api.anthropic.com/v1/messages")) {
      otherRequests.push(url);
      return new Response("{}", { status: 404 });
    }
    const request = { url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)), redirect: init?.redirect };
    requests.push(request);
    return options.reply?.(request, requests.length - 1) ?? sseResponse(replies.text(), { requestId: `req_session_${requests.length}` });
  }) as typeof fetch;

  const pi = await import("@earendil-works/pi-coding-agent");
  const settingsManager = pi.SettingsManager.inMemory(
    { compaction: { enabled: false }, retry: { enabled: false }, ...options.settings },
    { projectTrusted: false },
  );
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    noSkills: true,
    additionalExtensionPaths: options.extensions ?? [EXTENSION],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager,
    tools: ["read"],
  });
  disposed = () => session.dispose();
  const notices: Array<{ message: string; type?: string }> = [];
  const uiContext = new Proxy({ notify: (message: string, type?: string) => notices.push({ message, type }) }, {
    get: (target, key) => (target as Record<PropertyKey, unknown>)[key] ?? (() => undefined),
  });
  await session.bindExtensions({ uiContext: uiContext as never });

  const useAnthropic = async (id = "claude-sonnet-4-6") => {
    const model = session.modelRuntime.getModel("anthropic", id);
    assert.ok(model, `anthropic/${id} must exist`);
    await session.setModel(model);
    return model;
  };
  const lastAssistant = () => session.messages.filter((message) => message.role === "assistant").at(-1) as
    { stopReason?: string; errorMessage?: string; content: Array<{ type: string; text?: string }> } | undefined;
  const legacyUntouched = () => {
    assert.deepEqual(guard.touched, [], "no legacy credential path or Keychain access");
    assert.deepEqual(snapshot(legacyFiles), legacyBefore, "legacy credential files unchanged");
  };
  return { pi, session, settingsManager, agentDir, requests, tokenRequests, otherRequests, notices, useAnthropic, lastAssistant, legacyUntouched };
}

const fresh = (access = OAUTH_TOKEN, expires = Date.now() + 3_600_000) => ({ anthropic: { type: "oauth", access, refresh: "refresh-fixture", expires } });

async function writeExtension(name: string, source: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), `pi-claude-subscription-${name}-`));
  const path = join(dir, "index.ts");
  writeFileSync(path, source);
  return path;
}

test("native auth ownership: only the anthropic transport is registered; login, refresh, catalog and storage stay Pi's", async (t) => {
  const s = await startSession(t, {
    auth: fresh(OAUTH_TOKEN, Date.now() - 1_000),
    tokenResponse: () => Response.json({ access_token: REFRESHED_TOKEN, refresh_token: "refresh-rotated", expires_in: 3600 }),
  });
  const registered = s.session.modelRuntime.getRegisteredProviderConfig("anthropic");
  assert.deepEqual(Object.keys(registered ?? {}).sort(), ["api", "streamSimple"]);
  assert.equal(s.session.modelRuntime.getRegisteredProviderIds().includes("claude-subscription"), false);
  const provider = s.session.modelRuntime.getProvider("anthropic");
  assert.equal(provider?.auth.oauth?.name, "Anthropic (Claude Pro/Max)");
  assert.ok(provider?.auth.apiKey, "API-key login remains available");
  const builtinIds = (await import("@earendil-works/pi-ai/providers/all")).getBuiltinModels("anthropic").map((model) => model.id).sort();
  assert.deepEqual(s.session.modelRuntime.getModelsOfType("chat", "anthropic").map((model) => model.id).sort(), builtinIds);

  await s.useAnthropic();
  await s.session.prompt("Hi");

  // Pi refreshed the expired token itself, persisted the rotation, and the wrapper used the new token.
  assert.equal(s.tokenRequests.length, 1);
  assert.equal(s.tokenRequests[0]?.grant_type, "refresh_token");
  const stored = JSON.parse(readFileSync(join(s.agentDir, "auth.json"), "utf8"));
  assert.equal(stored.anthropic.access, REFRESHED_TOKEN);
  assert.equal(stored.anthropic.refresh, "refresh-rotated");
  assert.equal(s.requests.length, 1);
  const [request] = s.requests;
  assert.equal(request?.headers.get("authorization"), `Bearer ${REFRESHED_TOKEN}`);
  assert.equal(request?.headers.get("x-api-key"), null);
  assert.equal(request?.redirect, "manual", "the request went through the wrapper");
  assert.equal(request?.body.system[0].text, "You are Claude Code, Anthropic's official CLI for Claude.");
  assert.equal(s.lastAssistant()?.stopReason, "stop");

  await s.session.prompt("/claude-subscription-status");
  const status = s.notices.at(-1)?.message ?? "";
  assert.match(status, /^pi-claude-subscription \S+ on Pi 1\.3\.0/);
  assert.match(status, /route: provider anthropic \(anthropic-messages\) -> OAuth gate -> Pi's own Anthropic transport/);
  assert.match(status, /login: Pi built-in \(\/login anthropic\)/);
  assert.match(status, /anthropic auth: OAuth/);
  assert.match(status, /last OAuth request: .* model=anthropic\/claude-sonnet-4-6 status=200 request_id=req_session_1 stop=stop usage input=11 output=5 cache_read=7 cache_write=3/);
  assert.ok(!status.includes(REFRESHED_TOKEN) && !status.includes("Hi"));
  s.legacyUntouched();
});

test("review cases C/D: an account change in Pi's auth.json is used on the next request; nothing caches the old token", async (t) => {
  const s = await startSession(t, { auth: fresh() });
  await s.useAnthropic();
  await s.session.prompt("Hi");
  const replacement = ["sk", "ant", "oat01", "account", "c"].join("-");
  writeFileSync(join(s.agentDir, "auth.json"), JSON.stringify(fresh(replacement)));
  await s.session.prompt("Again");
  assert.deepEqual(s.requests.map((request) => request.headers.get("authorization")), [`Bearer ${OAUTH_TOKEN}`, `Bearer ${replacement}`]);
  s.legacyUntouched();
});

test("a failed stored-OAuth refresh does not become an API-key request (Pi 1.3.0 host contract)", async (t) => {
  const s = await startSession(t, {
    auth: fresh(OAUTH_TOKEN, Date.now() - 1_000),
    env: { ANTHROPIC_API_KEY: API_KEY },
    tokenResponse: () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
  });
  await s.useAnthropic();
  await s.session.prompt("Hi");
  assert.equal(s.tokenRequests.length, 1);
  assert.equal(s.requests.length, 0, "no Messages request at all, so no API-key retry");
  assert.equal(s.lastAssistant()?.stopReason, "error");
  assert.match(s.lastAssistant()?.errorMessage ?? "", /OAuth refresh failed for anthropic/);
  assert.ok(!(s.lastAssistant()?.errorMessage ?? "").includes(API_KEY));
  s.legacyUntouched();
});

test("API-key users are unaffected: requests pass through the wrapper untouched", async (t) => {
  const s = await startSession(t, { env: { ANTHROPIC_API_KEY: API_KEY } });
  await s.useAnthropic();
  await s.session.prompt("Hi");
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0]?.headers.get("x-api-key"), API_KEY);
  assert.equal(s.requests[0]?.headers.get("authorization"), null);
  assert.equal(s.requests[0]?.redirect, undefined, "no OAuth fetch boundary on API-key traffic");
  assert.equal(s.lastAssistant()?.stopReason, "stop");
  s.legacyUntouched();
});

test("main loop, tool round trip, compaction and model-registry background calls all reach the wrapper once; bare compat does not", async (t) => {
  const background = await writeExtension("background", `
    export default function (pi) {
      pi.on("session_start", (_event, ctx) => { globalThis.__backgroundRegistry = ctx.modelRegistry; });
    }
  `);
  const s = await startSession(t, {
    auth: fresh(),
    extensions: [EXTENSION, background],
    settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
    reply: (request, index) => index === 0
      ? sseResponse(replies.toolCall("toolu_1", "Read", { path: "hello.txt" }))
      : sseResponse(replies.text(), { requestId: `req_${request.body.messages.length}` }),
  });
  const model = await s.useAnthropic();
  await s.session.prompt("Read hello.txt");
  assert.equal(s.requests.length, 2, "tool call, then the follow-up turn");
  assert.match(JSON.stringify(s.requests[1]?.body.messages), /session-file-contents/);

  await s.session.compact();
  assert.equal(s.requests.length, 3, "compaction made one summarization request");

  const registry = (globalThis as { __backgroundRegistry?: { streamSimple: Function } }).__backgroundRegistry;
  delete (globalThis as { __backgroundRegistry?: unknown }).__backgroundRegistry;
  const result = await registry!.streamSimple(model, { messages: [{ role: "user", content: "background", timestamp: 1 }] }).result();
  assert.equal(result.stopReason, "stop");
  assert.equal(s.requests.length, 4);
  assert.deepEqual(s.requests.map((request) => request.redirect), ["manual", "manual", "manual", "manual"], "every call path was gated exactly once");

  // Documented limitation: pi-ai's compat dispatch bypasses registered providers.
  const compat = await import("@earendil-works/pi-ai/compat");
  await compat.streamSimple(model, { messages: [{ role: "user", content: "bare", timestamp: 1 }] }, { apiKey: OAUTH_TOKEN }).result();
  assert.equal(s.requests.length, 5);
  assert.equal(s.requests[4]?.redirect, undefined, "bare compat.streamSimple is not covered");
  s.legacyUntouched();
});

test("/reload replaces the wrapper without stacking, and another extension's anthropic override is reported, not removed", async (t) => {
  const s = await startSession(t, { auth: fresh() });
  const before = s.session.modelRuntime.getRegisteredProviderConfig("anthropic")?.streamSimple;
  await s.session.reload();
  const after = s.session.modelRuntime.getRegisteredProviderConfig("anthropic")?.streamSimple;
  assert.ok(before && after && before !== after);
  await s.useAnthropic();
  await s.session.prompt("Hi");
  assert.equal(s.requests.length, 1, "one wire request: no recursive dispatch after reload");
  assert.equal(s.requests[0]?.redirect, "manual");
  assert.equal(s.notices.filter((notice) => notice.message.includes("another extension")).length, 0);

  const later = await writeExtension("later", `
    import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";
    export default function (pi) {
      pi.registerProvider("anthropic", { api: "anthropic-messages", streamSimple: (m, c, o) => anthropicMessagesApi().streamSimple(m, c, o) });
    }
  `);
  const earlier = await writeExtension("earlier", `
    export default function (pi) {
      pi.registerProvider("anthropic", { oauth: { name: "Someone else's OAuth", login: async () => { throw new Error("x"); }, refresh: async (c) => c, getApiKey: (c) => c.access } });
    }
  `);
  const t2 = await startSession(t, { auth: fresh(), extensions: [earlier, EXTENSION, later] });
  assert.ok(t2.notices.some((notice) => notice.type === "warning" && /another extension replaced the anthropic transport/.test(notice.message)));
  await t2.session.prompt("/claude-subscription-status");
  const status = t2.notices.at(-1)?.message ?? "";
  assert.match(status, /route: NOT COVERED/);
  assert.match(status, /login: an extension overrides anthropic OAuth/);
  assert.equal(t2.session.modelRuntime.getRegisteredProviderConfig("anthropic")?.oauth?.name, "Someone else's OAuth", "the other override was not removed");
});

test("two installed copies of this extension gate each request once, and the shadowed copy says so", async (t) => {
  const copy = mkdtempSync(join(tmpdir(), "pi-claude-subscription-copy-"));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL("..", import.meta.url));
  for (const entry of ["extensions", "src", "package.json"]) cpSync(join(repo, entry), join(copy, entry), { recursive: true });
  const s = await startSession(t, { auth: fresh(), extensions: [EXTENSION, join(copy, "extensions", "pi-claude-subscription", "index.ts")] });
  assert.equal(s.notices.filter((notice) => /another extension replaced the anthropic transport/.test(notice.message)).length, 1);
  await s.useAnthropic();
  await s.session.prompt("Hi");
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0]?.redirect, "manual");
});

test("migration: a saved claude-subscription selection gets a notice and is left exactly as it was", async (t) => {
  const settings = { defaultProvider: "claude-subscription", defaultModel: "claude-sonnet-4-6", enabledModels: ["claude-subscription/*"] };
  const s = await startSession(t, { auth: fresh(), settings });
  const notice = s.notices.find((entry) => entry.message.includes("no longer registers"));
  assert.equal(notice?.type, "warning");
  assert.match(notice?.message ?? "", /settings defaultProvider, settings enabledModels/);
  assert.match(notice?.message ?? "", /\/login anthropic/);
  assert.equal(s.settingsManager.getDefaultProvider(), "claude-subscription");
  assert.deepEqual(s.settingsManager.getEnabledModels?.(), ["claude-subscription/*"]);
  assert.equal(s.requests.length, 0);
  s.legacyUntouched();
  // The fallback model is Pi's own choice: identical without this extension.
  const control = await startSession(t, { auth: fresh(), settings, extensions: [] });
  assert.equal(`${s.session.model?.provider}/${s.session.model?.id}`, `${control.session.model?.provider}/${control.session.model?.id}`);
});

test("loader seam: the host's pi-ai is used even when a private copy sits next to the extension", async (t) => {
  const pkg = mkdtempSync(join(tmpdir(), "pi-claude-subscription-pkg-"));
  t.after(() => rmSync(pkg, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL("..", import.meta.url));
  for (const entry of ["extensions", "src", "package.json"]) cpSync(join(repo, entry), join(pkg, entry), { recursive: true });
  const fake = join(pkg, "node_modules", "@earendil-works", "pi-ai");
  mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "@earendil-works/pi-ai", version: "0.0.0-private", type: "module", exports: { ".": "./index.js", "./compat": "./index.js" } }));
  writeFileSync(join(fake, "index.js"), "globalThis.__privatePiAiLoaded = true; export const anthropicMessagesApi = () => { throw new Error('private copy'); };\n");
  // Plain Node resolution from the extension would pick the private copy; only Pi's loader alias avoids it.
  assert.equal(createRequire(join(pkg, "src", "transport.ts")).resolve("@earendil-works/pi-ai/compat"), join(fake, "index.js"));

  const s = await startSession(t, { auth: fresh(), extensions: [join(pkg, "extensions", "pi-claude-subscription", "index.ts")] });
  await s.useAnthropic();
  await s.session.prompt("Hi");
  assert.equal((globalThis as { __privatePiAiLoaded?: boolean }).__privatePiAiLoaded, undefined);
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0]?.redirect, "manual");
  assert.equal(s.lastAssistant()?.stopReason, "stop");
});
