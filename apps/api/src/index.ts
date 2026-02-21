import { Hono } from "hono";
import { cors } from "hono/cors";
import { convertToModelMessages, streamText } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../../..");

const model = claudeCode("sonnet", {
  cwd: projectRoot,
  settingSources: ["project"],
  permissionMode: "bypassPermissions",
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append:
      "You are Experience Engine. Use the ee skill to answer questions about worker behavior and job site video. Never use web search.",
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
    onError: ({ error }) => {
      console.error("[chat error]", error);
    },
  });

  return result.toUIMessageStreamResponse({
    sendError: true,
  });
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

export default {
  port: 7892,
  idleTimeout: 300,
  fetch: app.fetch,
};
