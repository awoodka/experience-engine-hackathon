/**
 * Validates all data/tutorials/<id>/config.json files against the tutorial schema.
 * Run via: bun scripts/validate-tutorials.ts
 * Also called by `bun run check`.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "..");
const TUTORIALS_DIR = resolve(ROOT, "data/tutorials");

// ─── Schema ───────────────────────────────────────────────────────────────────

const NarrateStep = z.object({
  type: z.literal("narrate"),
  text: z.string().min(1),
  durationSec: z.number().positive().optional(),
});

const PlayStep = z.object({
  type: z.literal("play"),
  video: z.string().min(1),
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  label: z.string().optional(),
  durationSec: z.number().positive().optional(),
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
  durationSec: z.number().positive().optional(),
});

const TakeawayStep = z.object({
  type: z.literal("takeaway"),
  text: z.string().min(1),
  durationSec: z.number().positive().optional(),
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

const TutorialMeta = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  trade: z.string().min(1),
  skill: z.string().min(1),
  description: z.string().min(1),
  generatedAt: z.string().min(1),
  videoPath: z.string().min(1),
  thumbnailPath: z.string().min(1),
  configHash: z.string().min(1).optional(),
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
      if (dur > 20) {
        errors.push(
          `steps[${i}] play: clip duration ${dur.toFixed(1)}s exceeds 20s limit`,
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
  let entries: import("node:fs").Dirent[];
  try {
    entries = (await readdir(TUTORIALS_DIR, { withFileTypes: true })).filter(
      (e) => e.isDirectory(),
    );
  } catch {
    // No tutorials yet — not an error
    console.log("tutorials: no directories to validate.");
    process.exit(0);
  }

  if (entries.length === 0) {
    console.log("tutorials: no directories to validate.");
    process.exit(0);
  }

  let totalErrors = 0;

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filePath = resolve(TUTORIALS_DIR, entry.name, "config.json");
    const label = `${entry.name}/config.json`;
    let raw: unknown;

    try {
      raw = JSON.parse(await readFile(filePath, "utf8"));
    } catch (err) {
      console.error(
        `✖ ${label}: invalid JSON — ${err instanceof Error ? err.message : err}`,
      );
      totalErrors++;
      continue;
    }

    const result = TutorialScript.safeParse(raw);

    if (!result.success) {
      console.error(`✖ ${label}:`);
      for (const issue of result.error.issues) {
        console.error(`    ${issue.path.join(".")} — ${issue.message}`);
      }
      totalErrors += result.error.issues.length;
      continue;
    }

    const semanticErrors = checkSemantics(result.data);
    if (semanticErrors.length > 0) {
      console.error(`✖ ${label}:`);
      for (const err of semanticErrors) {
        console.error(`    ${err}`);
      }
      totalErrors += semanticErrors.length;
      continue;
    }

    console.log(`✔ ${label}`);
  }

  // ── Validate meta.json in each tutorial subdirectory ─────────────────────
  for (const entry of entries) {
    const metaPath = resolve(TUTORIALS_DIR, entry.name, "meta.json");
    const label = `${entry.name}/meta.json`;
    let raw: unknown;

    try {
      raw = JSON.parse(await readFile(metaPath, "utf8"));
    } catch {
      // meta.json is only created after rendering — skip if missing
      continue;
    }

    const result = TutorialMeta.safeParse(raw);

    if (!result.success) {
      console.error(`✖ ${label}:`);
      for (const issue of result.error.issues) {
        console.error(`    ${issue.path.join(".")} — ${issue.message}`);
      }
      totalErrors += result.error.issues.length;
      continue;
    }

    console.log(`✔ ${label}`);
  }

  if (totalErrors > 0) {
    console.error(`\n${totalErrors} error(s) found in tutorial files.`);
    process.exit(1);
  }
}

await main();
