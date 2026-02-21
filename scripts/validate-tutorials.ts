/**
 * Validates all data/tutorials/videos/*.json files against the tutorial schema.
 * Run via: bun scripts/validate-tutorials.ts
 * Also called by `bun run check`.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "..");
const VIDEOS_DIR = resolve(ROOT, "data/tutorials/scripts");

// ─── Schema ───────────────────────────────────────────────────────────────────

const NarrateStep = z.object({
  type: z.literal("narrate"),
  text: z.string().min(1),
});

const PlayStep = z.object({
  type: z.literal("play"),
  video: z.string().min(1),
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  label: z.string().optional(),
});

const Region = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

const PauseStep = z.object({
  type: z.literal("pause"),
  video: z.string().min(1),
  timestampSec: z.number().nonnegative(),
  description: z.string().min(1),
  region: Region.optional(),
  frame: z.string().optional(),
  refs: z.array(z.unknown()).optional(),
});

const TakeawayStep = z.object({
  type: z.literal("takeaway"),
  text: z.string().min(1),
});

const Step = z.discriminatedUnion("type", [
  NarrateStep,
  PlayStep,
  PauseStep,
  TakeawayStep,
]);

const TutorialScript = z.object({
  title: z.string().min(1),
  type: z.literal("tutorial"),
  description: z.string().min(1),
  trade: z.string().min(1).optional(),
  skill: z.string().min(1).optional(),
  generatedAt: z.string().min(1),
  steps: z.array(Step).min(1),
});

// ─── Extra semantic checks ────────────────────────────────────────────────────

function checkSemantics(script: z.infer<typeof TutorialScript>): string[] {
  const errors: string[] = [];

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];

    if (step.type === "play") {
      if (step.endSec <= step.startSec) {
        errors.push(
          `steps[${i}] play: endSec (${step.endSec}) must be greater than startSec (${step.startSec})`,
        );
      }
      const dur = step.endSec - step.startSec;
      if (dur > 120) {
        errors.push(
          `steps[${i}] play: clip duration ${dur.toFixed(1)}s is very long (> 120s) — intentional?`,
        );
      }
    }

    if (step.type === "pause" && step.region) {
      const { x, y, w, h } = step.region;
      if (w < 0.01 || h < 0.01) {
        errors.push(
          `steps[${i}] pause: region is too small (w=${w}, h=${h}). Minimum 0.01.`,
        );
      }
      if (x + w > 1.01 || y + h > 1.01) {
        errors.push(
          `steps[${i}] pause: region extends outside frame (x+w=${x + w}, y+h=${y + h})`,
        );
      }
    }
  }

  return errors;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  let files: string[];
  try {
    files = (await readdir(VIDEOS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    // No tutorials yet — not an error
    console.log("tutorials/videos: no files to validate.");
    process.exit(0);
  }

  if (files.length === 0) {
    console.log("tutorials/videos: no files to validate.");
    process.exit(0);
  }

  let totalErrors = 0;

  for (const file of files.sort()) {
    const filePath = resolve(VIDEOS_DIR, file);
    let raw: unknown;

    try {
      raw = JSON.parse(await readFile(filePath, "utf8"));
    } catch (err) {
      console.error(
        `✖ ${file}: invalid JSON — ${err instanceof Error ? err.message : err}`,
      );
      totalErrors++;
      continue;
    }

    const result = TutorialScript.safeParse(raw);

    if (!result.success) {
      console.error(`✖ ${file}:`);
      for (const issue of result.error.issues) {
        console.error(`    ${issue.path.join(".")} — ${issue.message}`);
      }
      totalErrors += result.error.issues.length;
      continue;
    }

    const semanticErrors = checkSemantics(result.data);
    if (semanticErrors.length > 0) {
      console.error(`✖ ${file}:`);
      for (const err of semanticErrors) {
        console.error(`    ${err}`);
      }
      totalErrors += semanticErrors.length;
      continue;
    }

    console.log(`✔ ${file}`);
  }

  if (totalErrors > 0) {
    console.error(`\n${totalErrors} error(s) found in tutorial scripts.`);
    process.exit(1);
  }
}

await main();
