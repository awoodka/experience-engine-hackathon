/**
 * tutorial-review command: reviews a rendered tutorial video against its config.json.
 *
 * Usage: ee tutorial-review <slug>
 *
 * Reads data/tutorials/<slug>/config.json and data/tutorials/<slug>/video.mp4,
 * then asks Gemini to verify each step in the rendered video matches the intent.
 * Returns a structured pass/fail report to stdout.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateObject, jsonSchema } from "ai";
import { google } from "@ai-sdk/google";
import { env } from "../env.js";
import { TUTORIALS_DIR } from "../paths.js";

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    pass: {
      type: "boolean",
      description:
        "True if all steps match their intent with no significant issues.",
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stepIndex: { type: "number", description: "0-based step index" },
          stepType: {
            type: "string",
            enum: [
              "narrate",
              "play",
              "pause",
              "takeaway",
              "root-cause",
              "impact",
            ],
          },
          ok: {
            type: "boolean",
            description: "True if this step looks correct.",
          },
          issue: {
            type: "string",
            description:
              "If not ok, describe exactly what is wrong. Empty string if ok.",
          },
        },
        required: ["stepIndex", "stepType", "ok", "issue"],
      },
    },
    summary: {
      type: "string",
      description:
        "One or two sentences summarizing the overall quality. If there are issues, list them briefly.",
    },
  },
  required: ["pass", "steps", "summary"],
};

function buildPrompt(configJson: string): string {
  return `You are a quality reviewer for a rendered tutorial video.

Below is the INTENDED script (config.json). Watch the video and verify that each step matches its intent exactly.

INTENDED SCRIPT:
${configJson}

Evaluate every step in the order they appear in the "steps" array (0-indexed).

NARRATE steps (dark navy blue background, white text):
- The text shown on screen must match the "text" field exactly.
- Check that it is readable and well-centered on a dark navy blue background.

TAKEAWAY steps (deep orange background, white text):
- The text shown on screen must match the "text" field exactly.
- Check that it is readable and well-centered on a deep orange background.

ROOT-CAUSE steps (dark red background, yellow text):
- The text must match the "text" field exactly and be legible on a dark red background with yellow text.
- This card explains WHY the problem happened — verify the text is analytical, not descriptive.

IMPACT steps (dark teal background, light cyan text):
- The text must match the "text" field exactly and be legible on a dark teal background with light cyan text.
- This card quantifies the cost of the behavior — verify numbers or concrete estimates are present and legible.

PLAY steps:
- The clip must show what the "description" field says it should show.
- If there is a "label", verify it is visible in the lower-left of the clip.
- The correct section of the correct video file must be playing.
- VISUAL CLARITY: The described action must be the clear focal point of the clip — close enough to see, centered or prominent in frame. If the action is technically present but small, in the background, or not obviously the subject of the shot, mark ok=false and explain what a viewer would actually see.
- NARRATIVE CONTINUITY: Consider how this clip fits with the steps immediately before and after it. If the tutorial is making a comparison (e.g. "here is the problem" followed by "here is the expert"), both clips must visually show the same type of task at comparable scale and framing so the contrast is clear to a viewer. If a clip would feel disconnected or confusing given the surrounding steps, mark ok=false.

PAUSE steps:
- The frame must be a still image (not moving) from approximately "timestampSec".
- If there is a "region", the red bounding box must highlight exactly what "description" says.
- The "description" text must be legible at the bottom of the frame.

Be strict. If a bounding box is slightly off, say so. If a clip shows the wrong moment, say so. If text is cut off or hard to read, say so. If a clip is technically correct but visually unclear or narratively disconnected, say so. Only mark a step as ok=true if it clearly and correctly matches its intent AND makes sense in context.`;
}

export default async function tutorialReview(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) {
    console.error("Usage: ee tutorial-review <slug>");
    process.exit(1);
  }

  const configPath = resolve(TUTORIALS_DIR, slug, "config.json");
  const videoPath = resolve(TUTORIALS_DIR, slug, "video.mp4");

  if (!existsSync(configPath)) {
    console.error(`Config not found: data/tutorials/${slug}/config.json`);
    process.exit(1);
  }
  if (!existsSync(videoPath)) {
    console.error(
      `Video not found: data/tutorials/${slug}/video.mp4 — run tutorial-render first`,
    );
    process.exit(1);
  }

  const configRaw = await readFile(configPath, "utf8");
  const videoBytes = await readFile(videoPath);
  const prompt = buildPrompt(configRaw);

  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: prompt },
        {
          type: "file" as const,
          data: videoBytes,
          mediaType: "video/mp4" as const,
          filename: "video.mp4",
        },
      ],
    },
  ];

  const { object } = await generateObject({
    model: google(env.EE_GEMINI_MODEL),
    schema: jsonSchema(REVIEW_SCHEMA),
    messages,
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "minimal" } },
    },
  });

  console.log(JSON.stringify(object, null, 2));
}
