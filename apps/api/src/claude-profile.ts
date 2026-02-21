// Shared Claude Code profile for web API and terminal launcher.
// Keep this in sync with scripts/agent.ts.
export const CLAUDE_CODE_MODEL = "sonnet";
export const CLAUDE_CODE_SETTING_SOURCES = ["project"] as const;
export const CLAUDE_CODE_PERMISSION_MODE = "bypassPermissions";
export const CLAUDE_CODE_SYSTEM_PROMPT_APPEND =
  "You are Experience Engine. Use the ee skill to answer questions about worker behavior and job site video. You can generate video scripts and render them into MP4s. Never use web search.";
