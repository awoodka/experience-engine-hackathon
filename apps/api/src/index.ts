import { Hono } from "hono";
import { cors } from "hono/cors";
import { convertToModelMessages, streamText } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";

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
    model: claudeCode("sonnet"),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

export default {
  port: 7892,
  fetch: app.fetch,
};
