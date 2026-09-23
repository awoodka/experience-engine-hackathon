/**
 * video-analyze command: sends a video file to Gemini with an arbitrary prompt.
 *
 * Without --schema: returns raw text (generateText).
 * With --schema '<json-schema>': enforces structured output (generateObject).
 *
 * To analyze a specific section, extract a clip first with video-clip and pass
 * the resulting mp4 to this command.
 */
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { generateObject, generateText, jsonSchema } from "ai";
import { google } from "@ai-sdk/google";
import { env } from "../env";
import { getFlag, getPositionals } from "../args.js";
import { PROJECT_ROOT } from "../paths.js";

export default async function videoAnalyze(args: string[]): Promise<void> {
  const validThinkLevels = new Set(["low", "medium", "high"]);
  const rawThinkValue = getFlag(args, "think");
  const hasThinkFlag = args.includes("--think");
  const thinkHasValue =
    rawThinkValue !== undefined && validThinkLevels.has(rawThinkValue);
  const positionals = getPositionals(
    args,
    hasThinkFlag && !thinkHasValue ? ["--think"] : [],
  );
  const filePath = positionals[0];
  const prompt = positionals[1];
  const modelId = getFlag(args, "model") ?? env.EE_GEMINI_MODEL;
  const schemaJson = getFlag(args, "schema");
  const thinkingConfig = {
    thinkingLevel: hasThinkFlag
      ? thinkHasValue
        ? rawThinkValue
        : "high"
      : "low",
  };

  if (!filePath || !prompt) {
    console.error(
      "Usage: ee video-analyze <file> \"<prompt>\" [--model <id>] [--schema '<json-schema>'] [--think [low|medium|high]]",
    );
    process.exit(1);
  }

  const absolutePath = filePath.startsWith("/")
    ? filePath
    : resolve(PROJECT_ROOT, filePath);

  let videoBytes: Buffer;
  try {
    videoBytes = await readFile(absolutePath);
  } catch {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const mediaType = mediaTypeFromPath(absolutePath);

  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: prompt },
        {
          type: "file" as const,
          data: videoBytes,
          mediaType,
          filename: basename(absolutePath),
        },
      ],
    },
  ];

  if (schemaJson) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(schemaJson);
    } catch {
      console.error("--schema must be valid JSON Schema.");
      process.exit(1);
    }

    const { object } = await generateObject({
      model: google(modelId),
      schema: jsonSchema(parsed),
      messages,
      providerOptions: {
        google: {
          thinkingConfig,
        },
      },
    });

    console.log(JSON.stringify(object, null, 2));
  } else {
    const { text } = await generateText({
      model: google(modelId),
      messages,
      providerOptions: {
        google: {
          thinkingConfig,
        },
      },
    });

    console.log(text);
  }
}

function mediaTypeFromPath(path: string): string {
  const ext = extname(path).toLowerCase();

  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".avi") return "video/x-msvideo";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mpeg" || ext === ".mpg") return "video/mpeg";
  return "video/mp4";
}
