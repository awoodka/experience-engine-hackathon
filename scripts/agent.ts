#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_CODE_MODEL,
  CLAUDE_CODE_PERMISSION_MODE,
  CLAUDE_CODE_SETTING_SOURCES,
  CLAUDE_CODE_SYSTEM_PROMPT_APPEND,
} from "../apps/api/src/claude-profile";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const localClaudeBin = resolve(homedir(), ".local/bin/claude");
const claudeBin = existsSync(localClaudeBin) ? localClaudeBin : "claude";

// Keep this launcher aligned with apps/api/src/index.ts via apps/api/src/claude-profile.ts.
const args = [
  "--model",
  CLAUDE_CODE_MODEL,
  "--setting-sources",
  CLAUDE_CODE_SETTING_SOURCES.join(","),
  "--permission-mode",
  CLAUDE_CODE_PERMISSION_MODE,
  "--append-system-prompt",
  CLAUDE_CODE_SYSTEM_PROMPT_APPEND,
  ...Bun.argv.slice(2),
];

const child = spawn(claudeBin, args, {
  cwd: projectRoot,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to launch ${claudeBin}:`, error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
