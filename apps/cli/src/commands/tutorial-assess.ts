/**
 * tutorial-assess command: evaluates whether a tutorial teaches experience.
 *
 * Usage: ee tutorial-assess <slug>
 *
 * Reads data/tutorials/<slug>/config.json and data/tutorials/<slug>/video.mp4,
 * then asks Gemini one question: does this video teach experience?
 *
 * A tutorial teaches experience if a novice watching it understands not just
 * what went wrong, but what habit or mental model to change. Returns a
 * structured pass/fail with specific, actionable issues and suggestions.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateObject, jsonSchema } from "ai";
import { google } from "@ai-sdk/google";
import { env } from "../env.js";
import { TUTORIALS_DIR } from "../paths.js";

const ASSESS_SCHEMA = {
  type: "object",
  properties: {
    teachesExperience: {
      type: "boolean",
      description:
        "True only if a novice watching this video would clearly understand both what went wrong AND what habit or mental model to change. False if the video only shows what not to do without conveying what right looks like.",
    },
    issues: {
      type: "array",
      items: { type: "string" },
      description:
        "Specific problems with narration, bounding boxes, root-cause text, or takeaway that reduce effectiveness. Empty array if teachesExperience is true.",
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete changes to config.json — specific rewrites of narration text, root-cause text, takeaway text, or bounding box adjustments — that would fix each issue.",
    },
    summary: {
      type: "string",
      description:
        "One or two sentences: what the tutorial does well and what is missing.",
    },
  },
  required: ["teachesExperience", "issues", "suggestions", "summary"],
};

function buildPrompt(configJson: string): string {
  return `You are a senior construction trainer. Your job is to evaluate whether this short training video teaches experience — the tacit knowledge that separates a novice from a skilled tradesperson.

This is NOT a technical review. The clips, text, and bounding boxes have already been verified for accuracy. Your only question is: would a novice watching this video understand what habit or mental model to change?

INTENDED SCRIPT:
${configJson}

Watch the video and evaluate against these five criteria:

1. FAILURE RECOGNITION — Does the narration name the failure in terms a worker can immediately recognize from their own work? Not "the task sequence reveals hesitation" but "he loads the trowel, scrapes back the excess, and wastes the move." The worker should see themselves in the description.

2. EXPERT MENTAL MODEL — Does the root-cause card reveal a specific habit or decision the expert makes differently — not just "do it better" or "be more efficient"? An experienced worker has a concrete reason they don't make this mistake. Does the card convey that reason?

3. BOUNDING BOX CLARITY — Does the pause frame and its bounding box make the failure moment visually unambiguous? Does the box land on exactly the right element — the hand, the tool, the moment of hesitation? Would a novice immediately understand what they're looking at?

4. ACTIONABLE TAKEAWAY — Is the takeaway one concrete behavior the viewer can try tomorrow? Not a principle — a physical action. "Gauge the load before the trowel touches the wall" is actionable. "Be more deliberate" is not.

5. OVERALL — After watching this, does a novice know WHAT to change AND HOW? If they can only answer the first question, return teachesExperience=false.

Return teachesExperience=true only if all five criteria are clearly met.
For each criterion that fails, write a specific issue (what is missing or wrong) and a concrete suggestion (the exact rewrite or change that would fix it).`;
}

export default async function tutorialAssess(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) {
    console.error("Usage: ee tutorial-assess <slug>");
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
    schema: jsonSchema(ASSESS_SCHEMA),
    messages,
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "low" } },
    },
  });

  console.log(JSON.stringify(object, null, 2));
}
