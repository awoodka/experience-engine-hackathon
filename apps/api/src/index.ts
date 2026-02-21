import { Hono } from "hono";
import { cors } from "hono/cors";
import { sValidator } from "@hono/standard-validator";
import superjson from "superjson";
import { z } from "zod";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
} from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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

const chatsDir = resolve(projectRoot, "data/chats");
const tutorialsDir = resolve(projectRoot, "data/tutorials");

const CHAT_ID_RE = /^[a-zA-Z0-9_-]+$/;

const app = new Hono()
  .use(
    "/api/*",
    cors({
      origin: ["http://localhost:7891"],
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  )

  .post(
    "/api/chat",
    sValidator(
      "json",
      z.object({ messages: z.array(z.record(z.string(), z.any())) }),
    ),
    async (c) => {
      const { messages } = c.req.valid("json");

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
    },
  )

  .get("/api/health", (c) => {
    return c.json({ status: "ok" });
  })

  // ---- Chat persistence (data/chats/<id>.json, superjson format) ----

  .get("/api/chats/:id", async (c) => {
    const id = c.req.param("id");
    if (!CHAT_ID_RE.test(id)) return c.json({ error: "invalid id" }, 400);
    const file = resolve(chatsDir, `${id}.json`);
    if (!existsSync(file)) return c.json(superjson.serialize({ messages: [] }));
    try {
      const raw = await readFile(file, "utf8");
      return c.json(JSON.parse(raw));
    } catch {
      return c.json(superjson.serialize({ messages: [] }));
    }
  })

  .post(
    "/api/chats/:id",
    sValidator(
      "json",
      z.object({ json: z.unknown(), meta: z.unknown().optional() }),
    ),
    async (c) => {
      const id = c.req.param("id");
      if (!CHAT_ID_RE.test(id)) return c.json({ error: "invalid id" }, 400);
      const body = c.req.valid("json");
      await mkdir(chatsDir, { recursive: true });
      const file = resolve(chatsDir, `${id}.json`);
      await writeFile(file, JSON.stringify(body));
      return c.json({ ok: true });
    },
  )

  // ---- Tutorials ----

  .get("/api/tutorials", async (c) => {
    try {
      const entries = await readdir(tutorialsDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());
      const metas: Array<{
        id: string;
        generatedAt: string;
        [key: string]: unknown;
      }> = [];
      for (const dir of dirs) {
        const metaPath = resolve(tutorialsDir, dir.name, "meta.json");
        try {
          const raw = await readFile(metaPath, "utf8");
          metas.push(JSON.parse(raw));
        } catch {
          // No meta.json yet — skip
        }
      }
      metas.sort(
        (a, b) =>
          new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
      );
      return c.json(metas);
    } catch {
      return c.json([]);
    }
  });

export type AppType = typeof app;

export default {
  port: 7892,
  idleTimeout: 255,
  fetch: app.fetch,
};
