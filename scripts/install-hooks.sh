#!/bin/sh
# Copies the pre-push hook from origin/main into Git's shared hooks directory.
# This repository does not use core.hooksPath, because Git would then run hooks
# from whichever branch is checked out, and an untrusted branch could add its own.
# Run this once per clone, and again after the hook changes on main. Linked
# worktrees share the installed hook.
set -eu

if git config --global --get core.hooksPath >/dev/null; then
  echo "hooks: a global core.hooksPath is set, so Git would ignore the installed hook" >&2
  exit 1
fi

hooks_dir="$(git rev-parse --git-common-dir)/hooks"
mkdir -p "$hooks_dir"
git show refs/remotes/origin/main:.githooks/pre-push > "$hooks_dir/pre-push.tmp"
chmod 755 "$hooks_dir/pre-push.tmp"
mv "$hooks_dir/pre-push.tmp" "$hooks_dir/pre-push"

if git config --local --get core.hooksPath >/dev/null; then
  git config --local --unset core.hooksPath
fi
echo "hooks: installed pre-push from origin/main"
