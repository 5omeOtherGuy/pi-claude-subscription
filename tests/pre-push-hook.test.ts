import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../.githooks/pre-push", import.meta.url));
const installer = fileURLToPath(new URL("../scripts/install-hooks.sh", import.meta.url));
const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd: string, ...args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: environment });
}

function installHooks(cwd: string) {
  const install = spawnSync("sh", [installer], { cwd, encoding: "utf8", env: environment });
  assert.equal(install.status, 0, install.stderr);
}

// A repository with the hook installed, a bare remote, and a linked worktree, which
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
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main");
  installHooks(repo);
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
    writeFileSync(join(worktree, "change.txt"), "change\n");
    git(worktree, "add", "change.txt");
    git(worktree, "commit", "-q", "-m", "change");
    const push = git(worktree, "push", "-q", "origin", "feature:main");
    assert.notEqual(push.status, 0);
    assert.match(push.stderr, /direct pushes to main are not allowed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hooks added on a branch do not run on checkout or push", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  try {
    const { repo, worktree } = linkedWorktree(root);
    const marker = join(root, "branch-hook-ran");
    const script = `#!/bin/sh\ntouch "${marker}"\n`;
    for (const name of ["post-checkout", "pre-push"]) {
      writeFileSync(join(worktree, ".githooks", name), script);
      chmodSync(join(worktree, ".githooks", name), 0o755);
    }
    git(worktree, "add", ".githooks");
    git(worktree, "commit", "-q", "-m", "hostile hooks");
    git(repo, "switch", "-q", "-c", "review", "feature");
    git(worktree, "push", "-q", "origin", "feature");
    assert.equal(existsSync(marker), false, "a hook from the branch must never run");
    assert.equal(git(repo, "config", "--get", "core.hooksPath").stdout.trim(), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installing from a linked worktree reaches the shared hooks directory", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  try {
    const { repo, worktree } = linkedWorktree(root);
    rmSync(join(repo, ".git", "hooks", "pre-push"));
    installHooks(worktree);
    assert.equal(readFileSync(join(repo, ".git", "hooks", "pre-push"), "utf8"), readFileSync(hook, "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installing refuses when a global core.hooksPath would hide the hook", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  try {
    const { repo } = linkedWorktree(root);
    const globalConfig = join(root, "gitconfig");
    writeFileSync(globalConfig, "[core]\n\thooksPath = /tmp/elsewhere\n");
    const install = spawnSync("sh", [installer], { cwd: repo, encoding: "utf8", env: { ...environment, GIT_CONFIG_GLOBAL: globalConfig } });
    assert.notEqual(install.status, 0);
    assert.match(install.stderr, /global core\.hooksPath/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed install keeps an existing core.hooksPath setting", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  try {
    const { repo } = linkedWorktree(root);
    git(repo, "config", "core.hooksPath", ".githooks");
    git(repo, "update-ref", "-d", "refs/remotes/origin/main");
    const install = spawnSync("sh", [installer], { cwd: repo, encoding: "utf8", env: environment });
    assert.notEqual(install.status, 0);
    assert.equal(git(repo, "config", "--get", "core.hooksPath").stdout.trim(), ".githooks");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installing ignores a local branch named origin/main", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  try {
    const { repo } = linkedWorktree(root);
    writeFileSync(join(repo, ".githooks", "pre-push"), "#!/bin/sh\n# planted\n");
    git(repo, "switch", "-q", "-c", "origin/main");
    git(repo, "add", ".githooks/pre-push");
    git(repo, "commit", "-q", "-m", "planted hook");
    installHooks(repo);
    assert.equal(readFileSync(join(repo, ".git", "hooks", "pre-push"), "utf8"), readFileSync(hook, "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installing removes an old core.hooksPath setting and uses the hook from origin/main", () => {
  const root = mkdtempSync(join(tmpdir(), "pre-push-hook-"));
  try {
    const { repo } = linkedWorktree(root);
    git(repo, "config", "core.hooksPath", ".githooks");
    writeFileSync(join(repo, ".githooks", "pre-push"), "#!/bin/sh\n# changed locally\n");
    installHooks(repo);
    assert.equal(git(repo, "config", "--get", "core.hooksPath").stdout.trim(), "");
    assert.equal(readFileSync(join(repo, ".git", "hooks", "pre-push"), "utf8"), readFileSync(hook, "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
