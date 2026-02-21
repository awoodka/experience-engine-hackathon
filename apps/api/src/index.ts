import { Hono } from "hono";
import { cors } from "hono/cors";
import { consumeStream, convertToModelMessages, streamText } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { resolve } from "node:path";
import {
  CLAUDE_CODE_MODEL,
  CLAUDE_CODE_PERMISSION_MODE,
  CLAUDE_CODE_SETTING_SOURCES,
  CLAUDE_CODE_SYSTEM_PROMPT_APPEND,
} from "./claude-profile";

const projectRoot = resolve(import.meta.dirname, "../../..");

// Keep this API model aligned with scripts/agent.ts via ./claude-profile.ts.
const model = claudeCode(CLAUDE_CODE_MODEL, {
  cwd: projectRoot,
  settingSources: [...CLAUDE_CODE_SETTING_SOURCES],
  permissionMode: CLAUDE_CODE_PERMISSION_MODE,
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: CLAUDE_CODE_SYSTEM_PROMPT_APPEND,
  },
});

const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:7891"],
    allowHeaders: ["Content-Type"],
    allowMethods: ["POST", "OPTIONS"],
  }),
);

app.post("/api/chat", async (c) => {
  const { messages } = await c.req.json();

  const result = streamText({
    model,
    messages: await convertToModelMessages(messages),
    abortSignal: c.req.raw.signal,
    onError: ({ error }) => {
      console.error("[chat error]", error);
    },
  });

  return result.toUIMessageStreamResponse({
    sendError: true,
    sendReasoning: true,
    consumeSseStream: consumeStream,
  });
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

export default {
  port: 7892,
  idleTimeout: 255,
  fetch: app.fetch,
};
