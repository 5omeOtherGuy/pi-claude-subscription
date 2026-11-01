import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../.githooks/pre-push", import.meta.url));
const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function git(cwd: string, ...args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: environment });
}

// A repository with the hook enabled, a bare remote, and a linked worktree, which
// is how AGENTS.md requires agents to work. The gate records the GIT_DIR it inherits.
function linkedWorktree(root: string) {
  const repo = join(root, "repo");
  const worktree = join(root, "worktree");
  const remote = join(root, "remote.git");
  mkdirSync(join(repo, ".githooks"), { recursive: true });
  copyFileSync(hook, join(repo, ".githooks", "pre-push"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({
    scripts: { check: "node -e \"require('fs').writeFileSync('gate-git-dir.txt', process.env.GIT_DIR ?? 'unset')\"" },
  }));
  git(repo, "init", "-q", "-b", "main");
  git(root, "init", "-q", "--bare", remote);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "initial");
  git(repo, "config", "core.hooksPath", ".githooks");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "worktree", "add", "-q", worktree, "-b", "feature");
  return { repo, worktree };
}

test("the gate runs without Git's hook variables when pushing from a linked worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  try {
    const { repo, worktree } = linkedWorktree(root);
    const push = git(worktree, "push", "-q", "origin", "feature");
    assert.equal(push.status, 0, push.stderr);
    assert.equal(readFileSync(join(worktree, "gate-git-dir.txt"), "utf8"), "unset");
    assert.equal(git(repo, "config", "core.bare").stdout.trim(), "false");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the hook refuses a push to main from a linked worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  try {
    const { worktree } = linkedWorktree(root);
    const push = git(worktree, "push", "-q", "origin", "feature:main");
    assert.notEqual(push.status, 0);
    assert.match(push.stderr, /direct pushes to main are not allowed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
