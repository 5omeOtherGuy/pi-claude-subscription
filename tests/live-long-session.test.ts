import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Opt-in live evidence for long sessions over the Claude Code OAuth subscription
// lane. It drives the real pi CLI through a read-only, many-turn review of this
// repository, so it spends subscription quota. Skipped unless explicitly enabled.
// Runbook: docs/prompt-cache-live-verification.md.

const ENABLED = process.env.PI_LIVE_CLAUDE_LONG_SESSION_TEST === "1";
const SKIP_REASON = ENABLED ? false : "set PI_LIVE_CLAUDE_LONG_SESSION_TEST=1 to run a long live session that spends subscription quota";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDER_ID = "claude-subscription";
const MODEL_ID = process.env.PI_LIVE_CLAUDE_LONG_SESSION_MODEL ?? "claude-opus-5-5";
const THINKING = process.env.PI_LIVE_CLAUDE_LONG_SESSION_THINKING ?? "high";
const PI_BIN = process.env.PI_LIVE_PI_BIN ?? join(REPO_ROOT, "node_modules", ".bin", "pi");
const RESULTS_DIR = join(REPO_ROOT, ".local", "live-long-session");
const PHASE_TIMEOUT_MS = 60 * 60_000;
const IDLE_MS = Number(process.env.PI_LIVE_CLAUDE_LONG_SESSION_IDLE_SECONDS ?? 330) * 1000;
const MIN_LONG_TURNS = 50;
const MIN_HIT_RATIO = 0.8;
const MIN_CONTEXT_REUSE = 0.9;
const EMOJI_SENTINEL = "\u{1F600} \u{10437} ok";

// Only quota headers are kept: no prompts, tool output, account ids or tokens.
const OBSERVER_EXTENSION = `import { appendFileSync } from "node:fs";
export default function (pi) {
  pi.on("after_provider_response", (event) => {
    const quota = Object.fromEntries(Object.entries(event.headers).filter(([name]) => name.toLowerCase().startsWith("anthropic-ratelimit-")));
    appendFileSync(process.env.PI_LIVE_RESPONSE_LOG, JSON.stringify({ status: event.status, quota }) + "\\n");
  });
}
`;

type Turn = { input: number; output: number; cacheRead: number; cacheWrite: number; stopReason: string; servedModel: string; provider: string };
type Phase = { name: string; turns: Turn[]; stdout: string; exitCode: number | null };
type QuotaSample = { status: number; quota: Record<string, string> };

function repositoryFiles(): string[] {
  const list = (directory: string, extension: string) => readdirSync(join(REPO_ROOT, directory))
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => `${directory}/${name}`);
  return [...list("src", ".ts"), ...list("extensions/minimalcc-pi", ".ts"), ...list("docs", ".md"), ...list("tests", ".ts")];
}

function longTask(files: string[]): string {
  return [
    "Review this repository one file at a time.",
    `Use the read tool on exactly one file per turn, in this order: ${files.join(", ")}.`,
    "After each read, write one sentence about that file before reading the next one.",
    "Never read two files in one turn, never skip a file, never page through a truncated file, and use no other tool.",
    "After the last file, reply with a line containing only DONE.",
  ].join(" ");
}

function readTurns(sessionDir: string): Turn[] {
  const turns: Turn[] = [];
  const files = readdirSync(sessionDir, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".jsonl"));
  for (const file of files) {
    for (const line of readFileSync(join(sessionDir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      const message = entry.message;
      if (entry.type !== "message" || message?.role !== "assistant") continue;
      turns.push({
        input: message.usage?.input ?? 0,
        output: message.usage?.output ?? 0,
        cacheRead: message.usage?.cacheRead ?? 0,
        cacheWrite: message.usage?.cacheWrite ?? 0,
        stopReason: message.stopReason,
        servedModel: message.responseModel ?? message.model,
        provider: message.provider,
      });
    }
  }
  return turns;
}

function contextTokens(turn: Turn | undefined): number {
  return turn ? turn.input + turn.cacheRead + turn.cacheWrite : 0;
}

function distinct(samples: QuotaSample[], header: string): string[] {
  return [...new Set(samples.map((sample) => sample.quota[`anthropic-ratelimit-unified-${header}`] ?? "absent"))];
}

function hitRatio(turns: Turn[]): number {
  const cacheRead = turns.reduce((sum, turn) => sum + turn.cacheRead, 0);
  const total = turns.reduce((sum, turn) => sum + turn.input + turn.cacheRead + turn.cacheWrite, 0);
  return total === 0 ? 0 : cacheRead / total;
}

function runPi(args: string[], environment: NodeJS.ProcessEnv): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(PI_BIN, args, { cwd: REPO_ROOT, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stdout += String(chunk); });
    const timer = setTimeout(() => child.kill("SIGTERM"), PHASE_TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ stdout, exitCode });
    });
  });
}

test("live long session stays on the plan, keeps its cache warm and round-trips emoji", { skip: SKIP_REASON, timeout: 4 * PHASE_TIMEOUT_MS + IDLE_MS }, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "pi-live-long-session-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));

  const observer = join(scratch, "observer.mjs");
  const responseLog = join(scratch, "responses.jsonl");
  const longSessions = join(scratch, "sessions-long");
  const retentionSessions = join(scratch, "sessions-retention");
  const freshSessions = join(scratch, "sessions-fresh");
  writeFileSync(observer, OBSERVER_EXTENSION);
  writeFileSync(responseLog, "");
  mkdirSync(longSessions);
  mkdirSync(retentionSessions);
  mkdirSync(freshSessions);

  const environment = {
    ...process.env,
    PI_CODING_AGENT_DIR: join(scratch, "agent"),
    PI_OFFLINE: "1",
    PI_LIVE_RESPONSE_LOG: responseLog,
  };
  const baseArgs = [
    "--no-extensions", "--extension", REPO_ROOT, "--extension", observer,
    "--no-skills", "--provider", PROVIDER_ID, "--model", MODEL_ID, "--thinking", THINKING,
    "--tools", "read,grep,find,ls",
  ];
  const files = repositoryFiles();
  const startedAt = new Date().toISOString();
  const phases: Phase[] = [];

  // Stop at the first failed phase so a broken run does not keep spending quota.
  async function phase(name: string, sessionDir: string, extraArgs: string[], prompt: string, phaseEnvironment: NodeJS.ProcessEnv = environment): Promise<Phase> {
    const before = readTurns(sessionDir).length;
    const { stdout, exitCode } = await runPi([...baseArgs, "--session-dir", sessionDir, ...extraArgs, "--print", prompt], phaseEnvironment);
    const result = { name, turns: readTurns(sessionDir).slice(before), stdout, exitCode };
    phases.push(result);
    assert.equal(exitCode, 0, `${name} exited ${exitCode}: ${stdout.slice(-400)}`);
    assert.ok(result.turns.length > 0, `${name} recorded no turns`);
    for (const turn of result.turns) assert.notEqual(turn.stopReason, "error", `${name} ended a turn in error`);
    return result;
  }

  const long = await phase("long", longSessions, [], longTask(files));
  const resumed = await phase("resumed", longSessions, ["--continue"], "Read package.json, then AGENTS.md, one per turn with one sentence each, then reply with a line containing only DONE.");
  const longRetention = { ...environment, PI_CACHE_RETENTION: "long" };
  const retentionStart = await phase("one-hour-start", retentionSessions, [], "Read LICENSE, then reply with a line containing only DONE.", longRetention);
  await new Promise((resolveIdle) => setTimeout(resolveIdle, IDLE_MS));
  const retentionAfterIdle = await phase("one-hour-after-idle", retentionSessions, ["--continue"], "Reply with a line containing only DONE.", longRetention);
  const idle = await phase("after-idle", longSessions, ["--continue"], "Read LICENSE, then reply with a line containing only DONE.");
  const fresh = await phase("fresh", freshSessions, [], `Reply with exactly these characters and nothing else: ${EMOJI_SENTINEL}`);

  const quota = readFileSync(responseLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as QuotaSample);
  const allTurns = phases.flatMap((entry) => entry.turns);
  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    model: MODEL_ID,
    thinking: THINKING,
    piVersion: execFileSync(PI_BIN, ["--version"], { encoding: "utf8" }).trim(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
    filesReviewed: files.length,
    idleSeconds: IDLE_MS / 1000,
    phases: phases.map(({ name, turns, exitCode }) => ({ name, exitCode, turnCount: turns.length, hitRatio: hitRatio(turns), turns })),
    totals: {
      turns: allTurns.length,
      input: allTurns.reduce((sum, turn) => sum + turn.input, 0),
      output: allTurns.reduce((sum, turn) => sum + turn.output, 0),
      cacheRead: allTurns.reduce((sum, turn) => sum + turn.cacheRead, 0),
      cacheWrite: allTurns.reduce((sum, turn) => sum + turn.cacheWrite, 0),
      hitRatio: hitRatio(allTurns),
    },
    firstQuota: quota[0],
    lastQuota: quota.at(-1),
    responses: quota.length,
    statuses: [...new Set(quota.map((sample) => sample.status))],
    planStatuses: distinct(quota, "status"),
    overageStatuses: distinct(quota, "overage-status"),
    overageDisabledReasons: distinct(quota, "overage-disabled-reason"),
    emojiRoundTrip: fresh.stdout.includes(EMOJI_SENTINEL),
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const resultPath = join(RESULTS_DIR, `${startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(resultPath, `${JSON.stringify(summary, null, 2)}\n`);
  t.diagnostic(`results: ${resultPath}`);
  t.diagnostic(JSON.stringify(summary.totals));

  assert.equal(quota.length, allTurns.length, "every turn must report its plan status");
  assert.deepEqual(summary.statuses, [200]);
  assert.deepEqual(summary.planStatuses, ["allowed"], "every response must stay within plan limits");
  assert.ok(!summary.overageStatuses.includes("allowed"), "no response may draw on extra usage");
  assert.ok(allTurns.every((turn) => turn.provider === PROVIDER_ID), "every turn must use the subscription provider");
  assert.ok(allTurns.every((turn) => turn.servedModel === MODEL_ID || turn.servedModel.startsWith(`${MODEL_ID}-`)), `every turn must be served by ${MODEL_ID}`);
  assert.ok(long.turns.length >= MIN_LONG_TURNS, `long session took only ${long.turns.length} turns`);
  long.turns.slice(1).forEach((turn, index) => {
    assert.ok(turn.cacheRead >= MIN_CONTEXT_REUSE * contextTokens(long.turns[index]), `long-session turn ${index + 1} lost its cache`);
  });
  assert.ok(hitRatio(long.turns) >= MIN_HIT_RATIO, `long-session hit ratio ${hitRatio(long.turns)}`);
  assert.ok(resumed.turns[0].cacheRead >= MIN_CONTEXT_REUSE * contextTokens(long.turns.at(-1)), "a resumed process must reuse the session's prompt cache");
  assert.ok(retentionAfterIdle.turns[0].cacheRead >= MIN_CONTEXT_REUSE * contextTokens(retentionStart.turns.at(-1)), "the one-hour cache must outlive the five-minute lifetime");
  assert.ok(idle.turns.length > 0, "the session must continue after its cache expires");
  assert.ok(fresh.turns[0].cacheRead > 0, "a fresh session must reuse the shared tools and system prefix");
  assert.ok(fresh.stdout.includes(EMOJI_SENTINEL), "emoji must survive the round trip through Claude");
});
