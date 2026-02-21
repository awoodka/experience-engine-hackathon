import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
} from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { resolve } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import {
  CLAUDE_CODE_MODEL,
  CLAUDE_CODE_PERMISSION_MODE,
  CLAUDE_CODE_SETTING_SOURCES,
  CLAUDE_CODE_SYSTEM_PROMPT_APPEND,
} from "./claude-profile";
import { createMediaTransform } from "./media-transform";

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
    allowMethods: ["GET", "POST", "OPTIONS"],
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

  const stream = result
    .toUIMessageStream({ sendError: true, sendReasoning: true })
    .pipeThrough(createMediaTransform());

  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: consumeStream,
  });
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

const tutorialsDir = resolve(projectRoot, "data/tutorials/videos");

app.get("/api/tutorials", async (c) => {
  try {
    const files = await readdir(tutorialsDir);
    const metaFiles = files.filter((f) => f.endsWith(".meta.json"));
    const metas = await Promise.all(
      metaFiles.map(async (f) => {
        const raw = await readFile(resolve(tutorialsDir, f), "utf8");
        return JSON.parse(raw) as {
          id: string;
          generatedAt: string;
          [key: string]: unknown;
        };
      }),
    );
    metas.sort(
      (a, b) =>
        new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
    );
    return c.json(metas);
  } catch {
    return c.json([]);
  }
});

export default {
  port: 7892,
  idleTimeout: 255,
  fetch: app.fetch,
};
