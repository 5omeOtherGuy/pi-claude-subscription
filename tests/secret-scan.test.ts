import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/secret-scan.mjs", import.meta.url));

function scan(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "secret-scan-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    spawnSync("git", ["add", "."], { cwd: dir });
    return spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("secret scan reports tracked credential-shaped strings and passes a clean tree quietly", () => {
  const oauthToken = ["sk", "ant", "oat01", "A".repeat(40)].join("-");
  const flagged = scan({ "clean.ts": "const ok = 1;\n", "leak.ts": `const token = "${oauthToken}";\n` });
  assert.equal(flagged.status, 1);
  assert.match(flagged.stderr, /leak\.ts:1: Anthropic key or OAuth token/);
  assert.doesNotMatch(flagged.stderr, /clean\.ts/);

  const clean = scan({ "clean.ts": `const header = "Bearer short"; const prefix = "sk-ant-";\n` });
  assert.equal(clean.status, 0);
  assert.equal(clean.stdout + clean.stderr, "");
});
