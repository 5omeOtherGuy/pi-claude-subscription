import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Loads the extension into a real Pi session from the installed devDependency, the
// way `pi install` does, with the Anthropic endpoint stubbed. This catches host API
// drift that the mocked provider tests cannot see, such as Pi 0.87 moving the system
// prompt and tools into transcript system messages.

type Captured = { headers: Headers; body: Record<string, any> };

function sse(events: Array<Record<string, unknown>>): Response {
  const text = events.map((data) => `event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function reply(index: number, model: string, block: Record<string, unknown>, delta: Record<string, unknown>, stop: string) {
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  return sse([
    { type: "message_start", message: { id: `msg_${index}`, type: "message", role: "assistant", model, content: [], stop_reason: null, usage } },
    { type: "content_block_start", index: 0, content_block: block },
    { type: "content_block_delta", index: 0, delta },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stop }, usage },
    { type: "message_stop" },
  ]);
}

test("a real Pi session routes a tool-call round trip through claude-subscription", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-claude-subscription-session-"));
  const agentDir = join(root, "agent");
  const claudeDir = join(root, "claude");
  const cwd = join(root, "work");
  for (const dir of [agentDir, claudeDir, cwd]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, "hello.txt"), "session-file-contents\n");

  const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  const savedFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  process.env.HOME = root;
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const token = ["sk", "ant", "oat01", "session", "test"].join("-");
  writeFileSync(join(claudeDir, ".credentials.json"), JSON.stringify({
    claudeAiOauth: { accessToken: token, refreshToken: "fake-refresh", expiresAt: Date.now() + 3_600_000, scopes: ["user:inference"] },
  }));

  const requests: Captured[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.anthropic.com/v1/messages")) return new Response("{}", { status: 404 });
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    requests.push({ headers: new Headers(init?.headers), body });
    return requests.length === 1
      ? reply(1, body.model, { type: "tool_use", id: "toolu_1", name: "read", input: {} },
        { type: "input_json_delta", partial_json: JSON.stringify({ path: "hello.txt" }) }, "tool_use")
      : reply(2, body.model, { type: "text", text: "" }, { type: "text_delta", text: "done" }, "end_turn");
  }) as typeof fetch;

  const pi = await import("@earendil-works/pi-coding-agent");
  // An untrusted project without context files or skills keeps AGENTS.md files and
  // skills of the machine running the test out of the session.
  const settingsManager = pi.SettingsManager.inMemory(
    { compaction: { enabled: false }, retry: { enabled: false } },
    { projectTrusted: false },
  );
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    noSkills: true,
    additionalExtensionPaths: [fileURLToPath(new URL("../extensions/pi-claude-subscription/index.ts", import.meta.url))],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    sessionManager: pi.SessionManager.inMemory(cwd),
    settingsManager,
    tools: ["read", "bash"],
  });
  t.after(() => session.dispose());
  const model = session.modelRuntime.getModel("claude-subscription", "claude-sonnet-4-6");
  assert.ok(model, "claude-subscription/claude-sonnet-4-6 must be registered");
  await session.setModel(model);
  session.setThinkingLevel("high");

  await session.prompt("Read hello.txt");

  assert.equal(requests.length, 2);
  const [first, second] = requests;
  assert.equal(first.headers.get("authorization"), `Bearer ${token}`);
  assert.equal(first.headers.get("x-api-key"), null);
  assert.equal(first.body.model, "claude-sonnet-4-6");
  assert.deepEqual(first.body.thinking, { type: "enabled", budget_tokens: 20480 });
  assert.match(String(first.body.system[0].text), /^You are Claude Code/);
  // Pi's own system prompt follows the identity block, and its tools are declared.
  assert.match(JSON.stringify(first.body.system.slice(1)), /read/);
  assert.deepEqual(first.body.tools.map((tool: { name: string }) => tool.name), ["read", "bash"]);
  assert.deepEqual(first.body.messages.map((message: { role: string }) => message.role), ["user"]);
  assert.deepEqual(second.body.messages.map((message: { role: string }) => message.role), ["user", "assistant", "user"]);
  assert.match(JSON.stringify(second.body.messages[2]), /session-file-contents/);

  const final = session.messages.at(-1) as { role: string; stopReason?: string; content: Array<{ type: string; text?: string }> };
  assert.equal(final.role, "assistant");
  assert.equal(final.stopReason, "stop");
  assert.equal(final.content.map((block) => block.text ?? "").join(""), "done");
});
