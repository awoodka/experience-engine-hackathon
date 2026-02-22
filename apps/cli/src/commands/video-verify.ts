/**
 * video-verify command: checks whether a video clip contains a specific visible activity.
 *
 * Usage: ee video-verify <file> "<what to look for>" [--start <sec>] [--end <sec>]
 *
 * Extracts the clip (if --start/--end given, max 15s) and asks Gemini whether
 * the described activity is clearly visible as the main subject of the clip.
 *
 * Returns: { found, confidence, reason }
 *
 * Use this BEFORE writing any play step into a tutorial config. If found is false
 * or confidence is "low", discard that timestamp and try a different one.
 */
import { readFile, unlink } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { generateObject, jsonSchema } from "ai";
import { google } from "@ai-sdk/google";
import { env } from "../env.js";
import { getFlag, getPositionals } from "../args.js";
import { PROJECT_ROOT, TMP_DIR } from "../paths.js";

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    found: {
      type: "boolean",
      description:
        "True only if the described activity is clearly visible and obviously the main subject of this clip. False if it is absent, in the background, barely visible, or requires inference.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "high = you are certain; medium = visible but partially obstructed or brief; low = you are guessing.",
    },
    reason: {
      type: "string",
      description:
        "One sentence: what you actually see in the clip and why found is true or false.",
    },
  },
  required: ["found", "confidence", "reason"],
};

export default async function videoVerify(args: string[]): Promise<void> {
  const positionals = getPositionals(args);
  const filePath = positionals[0];
  const activity = positionals[1];
  const startRaw = getFlag(args, "start");
  const endRaw = getFlag(args, "end");

  if (!filePath || !activity) {
    console.error(
      'Usage: ee video-verify <file> "<what to look for>" [--start <sec>] [--end <sec>]',
    );
    process.exit(1);
  }

  const absolutePath = filePath.startsWith("/")
    ? filePath
    : resolve(PROJECT_ROOT, filePath);

  const startSec = startRaw != null ? parseFloat(startRaw) : undefined;
  // Cap clip duration at 15s — enough to confirm activity, avoids oversized payloads
  const endSec =
    endRaw != null
      ? parseFloat(endRaw)
      : startSec != null
        ? startSec + 15
        : undefined;

  let videoPath = absolutePath;
  let tmpPath: string | null = null;

  if (startSec != null) {
    await mkdir(TMP_DIR, { recursive: true });
    tmpPath = resolve(TMP_DIR, `verify_${Date.now()}.mp4`);
    const duration = endSec != null ? Math.min(endSec - startSec, 15) : 15;
    const ffArgs = [
      "ffmpeg",
      "-y",
      "-ss",
      String(startSec),
      "-i",
      absolutePath,
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-an",
      tmpPath,
    ];
    const proc = Bun.spawn(ffArgs, { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error(`ffmpeg failed: ${stderr.trim().split("\n").pop()}`);
      process.exit(1);
    }
    videoPath = tmpPath;
  }

  const videoBytes = await readFile(videoPath);

  const prompt = `You are verifying whether a construction site video clip contains a specific visible activity.

ACTIVITY TO VERIFY: "${activity}"

Watch the clip carefully. Is this activity clearly visible and obviously the main subject of this clip?

Be strict:
- Answer found=true ONLY if a viewer would immediately recognize this as the main action in the clip.
- Answer found=false if the activity is absent, happening in the background, barely visible, or if you have to infer it from context rather than see it directly.
- Confidence "high" = you are certain of your answer.
- Confidence "medium" = the activity is present but brief, partially obstructed, or the framing makes it hard to see clearly.
- Confidence "low" = you are guessing.`;

  const { object } = await generateObject({
    model: google(env.EE_GEMINI_MODEL),
    schema: jsonSchema(VERIFY_SCHEMA),
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          {
            type: "file" as const,
            data: videoBytes,
            mediaType: "video/mp4" as const,
            filename: "clip.mp4",
          },
        ],
      },
    ],
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "minimal" } },
    },
  });

  if (tmpPath) {
    await unlink(tmpPath).catch(() => {});
  }

  console.log(JSON.stringify(object, null, 2));
}
