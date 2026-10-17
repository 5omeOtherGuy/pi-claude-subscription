#!/usr/bin/env node
// Fails when a tracked file contains a credential-shaped string. Quiet on success.
// Tests that need such strings build them from parts, so they never match here.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  ["Anthropic key or OAuth token", /sk-ant-[a-z]{2,6}\d{2}-[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["AWS access key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer token", /\bBearer [A-Za-z0-9._~+/-]{40,}={0,2}/],
];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  if (text.includes("\0")) continue; // binary
  text.split("\n").forEach((line, index) => {
    for (const [label, pattern] of patterns) {
      if (pattern.test(line)) findings.push(`${file}:${index + 1}: ${label}`);
    }
  });
}

if (findings.length > 0) {
  console.error(`secret-scan: ${findings.length} credential-shaped string(s) in tracked files:`);
  for (const finding of findings) console.error(`  ${finding}`);
  console.error("Remove them, or build test fixtures from parts.");
  process.exit(1);
}
